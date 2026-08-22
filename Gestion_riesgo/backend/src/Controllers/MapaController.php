<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Request;
use App\Core\Response;
use App\Rufe\Catalogos;
use App\Rufe\Geocodificador;

/**
 * Ubicaciones para la sección Mapas.
 *
 * El navegador nunca habla con un servicio de geocodificación: pide aquí las
 * direcciones que necesita y recibe las que ya están resueltas. Las que no,
 * quedan anotadas como pendientes y las procesa un administrador por lotes.
 *
 * El reparto es deliberado. Geocodificar tiene cupo por segundo, a veces cuesta
 * dinero y necesita una clave que no puede viajar al navegador; y sobre todo, el
 * resultado es el mismo para todos, así que resolverlo una vez y guardarlo es lo
 * único sensato. Que sea por lotes y a mano es consecuencia del hosting: no hay
 * cron ni procesos en segundo plano.
 */
final class MapaController
{
    /** Cuántas direcciones acepta consultar de una vez. */
    private const MAX_CONSULTA = 3000;

    /** Cuántas se geocodifican por llamada, para no agotar el tiempo de PHP. */
    private const LOTE = 10;

    /**
     * Devuelve las coordenadas conocidas de una lista de direcciones y apunta
     * las desconocidas para geocodificarlas después.
     */
    public function ubicaciones(Request $req): void
    {
        $direcciones = $req->input('direcciones');

        if (! is_array($direcciones)) {
            throw HttpError::validacion(
                ['direcciones' => 'Envíe la lista de direcciones a ubicar.'],
                'Faltan las direcciones.'
            );
        }

        if (count($direcciones) > self::MAX_CONSULTA) {
            throw HttpError::validacion(
                ['direcciones' => 'Máximo '.self::MAX_CONSULTA.' direcciones por consulta.'],
                'Demasiadas direcciones.'
            );
        }

        // Una misma dirección escrita de diez formas distintas es una sola
        // consulta: la clave se calcula sobre la versión normalizada.
        //
        // Se guarda además qué texto original produjo cada clave, porque la
        // respuesta va indexada por el texto que envió el navegador. Si fuera
        // por clave, el frontend tendría que repetir esta normalización en
        // TypeScript, y este proyecto ya pagó una vez el precio de tener el
        // mismo algoritmo escrito dos veces.
        $porClave = [];
        $originales = [];

        foreach ($direcciones as $direccion) {
            if (! is_string($direccion) || ! Geocodificador::utilizable($direccion)) {
                continue;
            }
            $clave = Geocodificador::clave($direccion);
            $porClave[$clave] = Geocodificador::normalizar($direccion);
            $originales[$clave][] = $direccion;
        }

        if ($porClave === []) {
            Response::ok(['ubicaciones' => [], 'pendientes' => 0, 'descartadas' => count($direcciones)]);

            return;
        }

        $conocidas = $this->buscarPorClaves(array_keys($porClave));

        // Las que no estaban se anotan para el próximo lote. Se insertan sin
        // coordenadas: existir en la tabla es justamente lo que las marca como
        // pendientes.
        $nuevas = array_diff_key($porClave, $conocidas);
        foreach ($nuevas as $clave => $normalizada) {
            Db::exec(
                "INSERT INTO rufe_geocodificacion (clave, direccion, precision_geo)
                      VALUES (:c, :d, 'FALLIDA')
                 ON DUPLICATE KEY UPDATE clave = clave",
                ['c' => $clave, 'd' => $normalizada]
            );
        }

        $ubicaciones = [];
        $resueltas = 0;

        foreach ($conocidas as $clave => $fila) {
            if ($fila['latitud'] === null || ! Geocodificador::pintable((string) $fila['precision_geo'])) {
                continue;
            }

            $resueltas++;
            $punto = [
                'lat' => (float) $fila['latitud'],
                'lon' => (float) $fila['longitud'],
                'precision' => $fila['precision_geo'],
                'fuente' => $fila['fuente'],
            ];

            foreach ($originales[$clave] ?? [] as $textoOriginal) {
                $ubicaciones[$textoOriginal] = $punto;
            }
        }

        Response::ok([
            'ubicaciones' => $ubicaciones,
            'consultadas' => count($porClave),
            'pendientes' => count($porClave) - $resueltas,
            'descartadas' => count($direcciones) - count($porClave),
        ]);
    }

    /**
     * Las fichas del sistema, listas para dibujar.
     *
     * El mapa nacía leyendo solo las hojas de cálculo, que es donde está el censo
     * en papel digitalizado. Pero las fichas levantadas con el formulario viven
     * en esta base y no aparecían en ninguna parte: se registraba una casa en
     * campo y el mapa seguía sin saber de ella.
     *
     * Muchas traen coordenadas exactas —las que el censador capturó con el botón
     * de ubicación—, y ésas no necesitan geocodificarse: son el dato más preciso
     * que puede haber, mejor que cualquier dirección escrita.
     *
     * Solo salen datos de ubicación y de estado del bien. Ni nombres, ni
     * documentos, ni teléfonos: para pintar un punto no hacen falta, y esta
     * respuesta la recibe cualquier usuario con sesión.
     */
    public function fichas(Request $req): void
    {
        Auth::exigirUsuario($req);

        // Se excluyen las rechazadas y archivadas —no representan afectación
        // vigente— y las anonimizadas, cuya dirección ya se borró a propósito.
        $filas = Db::all(
            "SELECT r.radicado, r.zona, r.corregimiento, r.vereda_sector_barrio,
                    r.direccion, r.estado, r.estado_bien, r.tipo_bien,
                    r.latitud, r.longitud, r.precision_m,
                    (SELECT COUNT(*) FROM rufe_personas p WHERE p.reporte_id = r.id) AS personas
               FROM rufe_reportes r
              WHERE r.estado NOT IN ('RECHAZADO', 'ARCHIVADO')
                AND r.anonimizado_en IS NULL
              ORDER BY r.id"
        );

        $fichas = [];
        foreach ($filas as $f) {
            $fichas[] = [
                'radicado' => $f['radicado'],
                'zona' => $f['zona'] === 'RURAL' ? 'Rural' : 'Urbana',
                'barrio' => $f['vereda_sector_barrio'] ?: ($f['corregimiento'] ?: 'Sin especificar'),
                'direccion' => $f['direccion'],
                // Se devuelven por separado para poder intentar ubicar la ficha
                // por su sector cuando la dirección no baste: «Caseta comunal 200
                // metros» no la encuentra ningún geocodificador, pero «El cabullo,
                // Jamundí» sí sitúa la vereda.
                'corregimiento' => $f['corregimiento'] ?: '',
                'vereda' => $f['vereda_sector_barrio'] ?: '',
                'personas' => (int) $f['personas'],
                'estado' => Catalogos::ESTADOS_REPORTE[$f['estado']] ?? $f['estado'],
                'estado_bien' => Catalogos::ESTADOS_BIEN[$f['estado_bien']] ?? 'No informa',
                'tipo_bien' => Catalogos::TIPOS_BIEN[$f['tipo_bien']] ?? '',
                // Coordenadas del censador, cuando las tomó. Son las buenas.
                'latitud' => $f['latitud'] === null ? null : (float) $f['latitud'],
                'longitud' => $f['longitud'] === null ? null : (float) $f['longitud'],
                'precision_m' => $f['precision_m'] === null ? null : (int) $f['precision_m'],
            ];
        }

        Response::ok(['fichas' => $fichas]);
    }

    /** Cuántas direcciones hay resueltas, pendientes y fallidas. */
    public function estado(Request $req): void
    {
        Auth::exigirUsuario($req);

        $filas = Db::all(
            'SELECT precision_geo, COUNT(*) AS total FROM rufe_geocodificacion GROUP BY precision_geo'
        );

        $porPrecision = [];
        foreach ($filas as $f) {
            $porPrecision[(string) $f['precision_geo']] = (int) $f['total'];
        }

        $pendientes = (int) (Db::first(
            'SELECT COUNT(*) AS t FROM rufe_geocodificacion
              WHERE latitud IS NULL AND intentos < :max',
            ['max' => Geocodificador::MAX_INTENTOS]
        )['t'] ?? 0);

        Response::ok([
            'por_precision' => $porPrecision,
            'pendientes' => $pendientes,
            'lote' => self::LOTE,
            'google_activo' => Geocodificador::hayGoogle(),
            'segundos_por_direccion' => Geocodificador::PAUSA_SEGUNDOS,
        ]);
    }

    /**
     * Geocodifica un lote de direcciones pendientes.
     *
     * Se llama repetidamente desde la pantalla de administración hasta que no
     * queden pendientes. El lote es pequeño a propósito: entre el segundo de
     * pausa que exige OpenStreetMap y el límite de ejecución de PHP en hosting
     * compartido, pedir más de una decena arriesga que el proceso se corte a la
     * mitad.
     */
    public function geocodificar(Request $req): void
    {
        $usuario = Auth::exigirUsuario($req);

        $pendientes = Db::all(
            'SELECT clave, direccion FROM rufe_geocodificacion
              WHERE latitud IS NULL AND intentos < :max
              ORDER BY intentos ASC, creado_en ASC
              LIMIT '.self::LOTE,
            ['max' => Geocodificador::MAX_INTENTOS]
        );

        $resueltas = 0;
        $fallidas = 0;

        foreach ($pendientes as $i => $fila) {
            // La política de OpenStreetMap exige no pasar de una petición por
            // segundo. La pausa va antes de cada consulta menos la primera.
            if ($i > 0) {
                sleep(Geocodificador::PAUSA_SEGUNDOS);
            }

            $punto = Geocodificador::resolver((string) $fila['direccion']);

            if ($punto === null) {
                Db::exec(
                    'UPDATE rufe_geocodificacion
                        SET intentos = intentos + 1, ultimo_intento = NOW()
                      WHERE clave = :c',
                    ['c' => $fila['clave']]
                );
                $fallidas++;

                continue;
            }

            Db::exec(
                'UPDATE rufe_geocodificacion
                    SET latitud = :lat, longitud = :lon, precision_geo = :p, fuente = :f,
                        etiqueta = :e, intentos = intentos + 1, ultimo_intento = NOW()
                  WHERE clave = :c',
                [
                    'lat' => $punto['lat'],
                    'lon' => $punto['lon'],
                    'p' => $punto['precision'],
                    'f' => $punto['fuente'],
                    'e' => $punto['etiqueta'],
                    'c' => $fila['clave'],
                ]
            );

            Geocodificador::pintable($punto['precision']) ? $resueltas++ : $fallidas++;
        }

        $quedan = (int) (Db::first(
            'SELECT COUNT(*) AS t FROM rufe_geocodificacion
              WHERE latitud IS NULL AND intentos < :max',
            ['max' => Geocodificador::MAX_INTENTOS]
        )['t'] ?? 0);

        // Queda constancia de la operación y de su tamaño, nunca de las
        // direcciones: son datos de ubicación de personas damnificadas.
        Auditoria::registrar(
            $req,
            'mapa.geocodificacion_ejecutada',
            $usuario,
            'rufe_geocodificacion',
            null,
            count($pendientes).' procesadas, '.$resueltas.' ubicadas'
        );

        Response::ok([
            'procesadas' => count($pendientes),
            'ubicadas' => $resueltas,
            'sin_ubicar' => $fallidas,
            'pendientes' => $quedan,
        ]);
    }

    /**
     * Vuelve a poner en cola todas las direcciones para ubicarlas otra vez.
     *
     * Hace falta cuando el geocodificador mejora: lo ya guardado se calculó con
     * las reglas viejas y no se recalcula solo, porque la caché existe justamente
     * para no volver a preguntar. Sin esto, una corrección del buscador no arregla
     * ni uno solo de los puntos que ya están mal.
     *
     * Las corregidas a mano NO se tocan. Son trabajo de una persona que miró el
     * mapa y movió el punto al sitio correcto; volver a preguntarle al servicio lo
     * desharía, y en ese caso el servicio ya demostró que se equivocaba.
     *
     * Las filas no se borran: se les quitan las coordenadas y se pone el contador
     * de intentos a cero. Así se conserva el texto de la dirección y no hay que
     * volver a recogerlo del censo.
     */
    public function reubicar(Request $req): void
    {
        $usuario = Auth::exigirUsuario($req);

        $manuales = (int) (Db::first(
            "SELECT COUNT(*) AS t FROM rufe_geocodificacion WHERE fuente = 'MANUAL'"
        )['t'] ?? 0);

        $afectadas = Db::exec(
            "UPDATE rufe_geocodificacion
                SET latitud = NULL, longitud = NULL, precision_geo = 'FALLIDA',
                    fuente = NULL, etiqueta = NULL, intentos = 0, ultimo_intento = NULL
              WHERE fuente IS NULL OR fuente <> 'MANUAL'"
        );

        Auditoria::registrar(
            $req,
            'mapa.ubicaciones_reencoladas',
            $usuario,
            'rufe_geocodificacion',
            null,
            $afectadas.' reencoladas, '.$manuales.' corregidas a mano conservadas'
        );

        Response::ok(['reencoladas' => $afectadas, 'conservadas' => $manuales]);
    }

    /**
     * Corrige a mano un punto mal ubicado.
     *
     * Con direcciones de censo escritas a la carrera esto no es un caso raro
     * sino la mitad del trabajo, así que tiene que poder hacerse sin tocar la
     * base de datos por fuera.
     */
    public function corregir(Request $req): void
    {
        $usuario = Auth::exigirUsuario($req);
        $clave = $req->param('clave');

        $fila = Db::first('SELECT clave FROM rufe_geocodificacion WHERE clave = :c', ['c' => $clave]);
        if ($fila === null) {
            throw HttpError::noEncontrado('Esa dirección no está registrada.');
        }

        $lat = $req->input('latitud');
        $lon = $req->input('longitud');
        $errores = [];

        if (! is_numeric($lat) || ! is_numeric($lon)) {
            $errores['latitud'] = 'Indique la latitud y la longitud del punto.';
        } elseif (! Geocodificador::dentroDeJamundi((float) $lat, (float) $lon)) {
            $errores['latitud'] = 'Ese punto queda fuera de Jamundí.';
        }

        if ($errores !== []) {
            throw HttpError::validacion($errores, 'Revise el punto indicado.');
        }

        Db::exec(
            "UPDATE rufe_geocodificacion
                SET latitud = :lat, longitud = :lon, precision_geo = 'EXACTA',
                    fuente = 'MANUAL', ultimo_intento = NOW()
              WHERE clave = :c",
            ['lat' => (float) $lat, 'lon' => (float) $lon, 'c' => $clave]
        );

        Auditoria::registrar(
            $req,
            'mapa.ubicacion_corregida',
            $usuario,
            'rufe_geocodificacion',
            $clave
        );

        Response::ok(['clave' => $clave, 'precision' => 'EXACTA', 'fuente' => 'MANUAL']);
    }

    /**
     * Las filas ya guardadas de un conjunto de claves.
     *
     * Se consulta por bloques porque una lista de mil marcadores en un `IN`
     * revienta el límite de parámetros de la sentencia preparada.
     *
     * @param  list<string>  $claves
     * @return array<string, array<string,mixed>>
     */
    private function buscarPorClaves(array $claves): array
    {
        $encontradas = [];

        foreach (array_chunk($claves, 200) as $bloque) {
            $marcadores = [];
            $params = [];

            foreach ($bloque as $i => $clave) {
                $marcadores[] = ':k'.$i;
                $params['k'.$i] = $clave;
            }

            $filas = Db::all(
                'SELECT clave, latitud, longitud, precision_geo, fuente
                   FROM rufe_geocodificacion
                  WHERE clave IN ('.implode(',', $marcadores).')',
                $params
            );

            foreach ($filas as $fila) {
                $encontradas[(string) $fila['clave']] = $fila;
            }
        }

        return $encontradas;
    }
}
