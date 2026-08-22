<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Limite;
use App\Core\Request;
use App\Core\Response;
use App\Rufe\Archivos;
use App\Rufe\Catalogos;
use App\Rufe\Radicado;
use App\Rufe\Validador;
use Throwable;

/**
 * Captura del formulario RUFE por parte de un funcionario en campo.
 *
 * Todas las rutas de este controlador exigen sesión y rol de escritura
 * (Administrador o Gestor); el router lo aplica, así que estos métodos ya pueden
 * dar por hecho que hay un funcionario autorizado detrás.
 *
 * Los límites de tasa se cuentan por usuario y no por IP: una brigada entera
 * puede estar compartiendo la misma conexión del municipio, y contar por IP
 * dejaría fuera a todos menos al primero.
 */
final class RufeCapturaController
{
    /**
     * Reportes por funcionario y hora. Un censador en jornada intensa levanta
     * varias decenas de fichas al día; el tope está para frenar un script
     * desbocado, no para estorbar el trabajo.
     */
    private const MAX_ENVIOS_HORA = 40;

    /** Reportes por funcionario y día. */
    private const MAX_ENVIOS_DIA = 250;

    private const MAX_CARGAS_HORA = 80;

    private const MAX_ARCHIVOS_HORA = 400;

    /** Ventana en la que dos reportes idénticos se consideran el mismo. */
    private const HORAS_DUPLICADO = 24;

    /**
     * Tope amplio de peticiones al endpoint de envío, incluidos los reintentos
     * que no crean nada. Es lo único que se cobra antes de comprobar si el envío
     * ya entró, para que un teléfono sin señal no agote su cuota reintentando.
     */
    private const MAX_INTENTOS_HORA = 600;

    // ── Catálogos ────────────────────────────────────────────────────────────

    /**
     * Fuente única de los catálogos del formato: el frontend los pide aquí en vez
     * de duplicarlos en TypeScript, donde tarde o temprano se desincronizarían.
     *
     * La caché es privada porque la ruta ya exige sesión: con `public` un proxy
     * intermedio podría guardar la respuesta y servirla a quien no la pidió.
     */
    public function catalogos(Request $req): void
    {
        header('Cache-Control: private, max-age=3600');

        Response::ok(Catalogos::paraApi());
    }

    // ── Cargas de evidencias ─────────────────────────────────────────────────

    /**
     * Abre una carga y devuelve su token.
     *
     * El token no se guarda en ninguna tabla: solo su SHA-256 acompaña a cada
     * archivo subido. Quien no tenga el token no puede ver, borrar ni adjuntar a
     * esa carga, y adivinarlo exige acertar 256 bits.
     */
    public function abrirCarga(Request $req): void
    {
        Limite::consumir('rufe.carga', $this->clave($req), self::MAX_CARGAS_HORA, 3600);

        // Sin cron, la limpieza de cargas abandonadas viaja con el tráfico.
        Archivos::purgarCargasCaducadas();

        $token = bin2hex(random_bytes(32));

        Response::json([
            'ok' => true,
            'data' => [
                'carga' => $token,
                'expira_en' => date('c', time() + Archivos::HORAS_CARGA * 3600),
                'maximo_archivos' => Catalogos::MAX_EVIDENCIAS,
                'maximo_bytes' => Catalogos::MAX_BYTES_ARCHIVO,
            ],
        ], 201);
    }

    /** Un archivo por petición: así el cliente puede mostrar progreso y reintentar solo el que falló. */
    public function subirArchivo(Request $req): void
    {
        Limite::consumir('rufe.archivo', $this->clave($req), self::MAX_ARCHIVOS_HORA, 3600);

        $hash = Archivos::hashDeCarga($req->param('carga'));

        $archivo = $req->archivo('archivo');
        if ($archivo === null) {
            throw HttpError::validacion(['archivo' => 'No se recibió ningún archivo.']);
        }

        // Sin tipo se asume foto del daño: es el caso mayoritario y evita que un
        // cliente viejo deje de funcionar por un campo que antes no existía.
        //
        // La descripción es el «FOTOGRAFIA DE:» del numeral 11 de la inspección.
        // En el RUFE no existe y llega vacía, que es lo correcto: ahí las fotos
        // no llevan pie.
        $guardado = Archivos::guardarEnCarga(
            $archivo,
            $hash,
            $req->campo('tipo', 'DANO'),
            $req->campo('descripcion', '')
        );

        Response::json(['ok' => true, 'data' => ['archivo' => $guardado]], 201);
    }

    public function listarArchivos(Request $req): void
    {
        $hash = Archivos::hashDeCarga($req->param('carga'));

        Response::ok(['archivos' => Archivos::listarCarga($hash)]);
    }

    /** El «FOTOGRAFIA DE:» del numeral 11, que se escribe tras tomar la foto. */
    public function describirArchivo(Request $req): void
    {
        $hash = Archivos::hashDeCarga($req->param('carga'));

        $id = (int) $req->param('id');
        if ($id <= 0) {
            throw HttpError::noEncontrado('El archivo no existe.');
        }

        Archivos::describirEnCarga($hash, $id, $req->texto('descripcion'));

        Response::sinContenido();
    }

    public function eliminarArchivo(Request $req): void
    {
        $hash = Archivos::hashDeCarga($req->param('carga'));

        $id = (int) $req->param('id');
        if ($id <= 0) {
            throw HttpError::noEncontrado('El archivo no existe.');
        }

        Archivos::eliminarDeCarga($hash, $id);

        Response::sinContenido();
    }

    // ── Envío del reporte ────────────────────────────────────────────────────

    public function crear(Request $req): void
    {
        $this->revisarTamanoDelCuerpo();

        Limite::consumir(
            'rufe.intento',
            $this->clave($req),
            self::MAX_INTENTOS_HORA,
            3600,
            'Demasiadas peticiones. Espere unos minutos e intente de nuevo.'
        );

        // Reintento de un envío que ya entró. Ocurre cuando el reporte llegó al
        // servidor pero la respuesta se perdió por falta de cobertura: el
        // teléfono no sabe que lo logró y lo vuelve a mandar. Se devuelve el
        // radicado original en vez de registrar dos veces al mismo hogar.
        $envioId = $this->envioId($req);
        if ($envioId !== null) {
            $previo = Db::first(
                'SELECT radicado, creado_en FROM rufe_reportes WHERE envio_id = :e',
                ['e' => $envioId]
            );

            if ($previo !== null) {
                Response::ok([
                    'radicado' => $previo['radicado'],
                    'recibido_en' => date('c', strtotime((string) $previo['creado_en'])),
                    'reintento' => true,
                ]);

                return;
            }
        }

        Limite::consumir('rufe.enviar', $this->clave($req), self::MAX_ENVIOS_HORA, 3600);
        Limite::consumir('rufe.enviar.dia', $this->clave($req), self::MAX_ENVIOS_DIA, 86400);

        // Trampa para robots: el campo está oculto por CSS y una persona nunca lo
        // ve. Se responde como si todo hubiera salido bien, con un radicado que no
        // existe, para no enseñarle al autor del robot qué lo delató.
        if ($req->texto('sitio_web') !== '') {
            Auditoria::registrar(
                $req, 'rufe.reporte_descartado', Auth::usuario($req), 'rufe_reportes', null, 'honeypot'
            );

            Response::json([
                'ok' => true,
                'data' => ['radicado' => Radicado::componer(), 'recibido_en' => date('c')],
            ], 201);

            return;
        }

        ['errores' => $errores, 'datos' => $datos] = Validador::reporte($req->todo());

        if ($errores !== []) {
            throw HttpError::validacion($errores, 'Revise los datos marcados y vuelva a intentarlo.');
        }

        $documentoJefe = $this->documentoDelJefe($datos['personas']);
        $huella = Radicado::huella($datos['fecha_evento'], $datos['direccion'], $documentoJefe);

        $this->revisarDuplicado($req, $huella);

        $actor = Auth::exigirUsuario($req);
        $radicado = $this->guardar($req, $datos, $huella, $envioId, $actor);

        Auditoria::registrar(
            $req,
            'rufe.reporte_registrado',
            $actor,
            'rufe_reportes',
            $radicado,
            sprintf(
                '%s en %s, %d persona(s)',
                $datos['evento'],
                $datos['zona'] === 'RURAL' ? 'zona rural' : 'zona urbana',
                count($datos['personas'])
            )
        );

        // Respuesta deliberadamente escueta: ni id interno, ni eco de los datos.
        Response::json([
            'ok' => true,
            'data' => ['radicado' => $radicado, 'recibido_en' => date('c')],
        ], 201);
    }

    // ── Apoyo ────────────────────────────────────────────────────────────────

    /**
     * Inserta cabecera, personas, renglones agropecuarios y evidencias en una
     * sola transacción: un reporte a medias es peor que ninguno, porque nadie
     * sabría a quién le falta información.
     *
     * @param  array<string,mixed>  $datos
     * @return string radicado
     */
    private function guardar(
        Request $req,
        array $datos,
        string $huella,
        ?string $envioId,
        array $actor
    ): string {
        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            $radicado = Radicado::generar();

            Db::exec(
                'INSERT INTO rufe_reportes
                    (radicado, envio_id, formato_version, estado, origen, departamento, municipio, evento,
                     fecha_evento, fecha_rufe, zona, corregimiento, vereda_sector_barrio, direccion,
                     latitud, longitud, precision_m, alojamiento, alojamiento_direccion,
                     forma_tenencia, estado_bien, tipo_bien, observaciones, contacto_telefono,
                     contacto_correo, autoriza_datos, autoriza_sensibles, autorizacion_en,
                     autorizacion_texto, revision_prioritaria, huella, ip_hash, user_agent,
                     creado_por_usuario_id)
                 VALUES
                    (:radicado, :envio_id, :formato_version, :estado, :origen, :departamento, :municipio, :evento,
                     :fecha_evento, :fecha_rufe, :zona, :corregimiento, :vereda_sector_barrio, :direccion,
                     :latitud, :longitud, :precision_m, :alojamiento, :alojamiento_direccion,
                     :forma_tenencia, :estado_bien, :tipo_bien, :observaciones, :contacto_telefono,
                     :contacto_correo, :autoriza_datos, :autoriza_sensibles, :autorizacion_en,
                     :autorizacion_texto, :revision_prioritaria, :huella, :ip_hash, :user_agent,
                     :creado_por)',
                [
                    'radicado' => $radicado,
                    'envio_id' => $envioId,
                    'formato_version' => $datos['formato_version'],
                    'estado' => 'RECIBIDO',
                    'origen' => 'INTERNO',
                    'departamento' => $datos['departamento'],
                    'municipio' => $datos['municipio'],
                    'evento' => $datos['evento'],
                    'fecha_evento' => $datos['fecha_evento'],
                    'fecha_rufe' => $datos['fecha_rufe'],
                    'zona' => $datos['zona'],
                    'corregimiento' => $datos['corregimiento'],
                    'vereda_sector_barrio' => $datos['vereda_sector_barrio'],
                    'direccion' => $datos['direccion'],
                    'latitud' => $datos['latitud'],
                    'longitud' => $datos['longitud'],
                    'precision_m' => $datos['precision_m'],
                    'alojamiento' => $datos['alojamiento'],
                    'alojamiento_direccion' => $datos['alojamiento_direccion'],
                    'forma_tenencia' => $datos['forma_tenencia'],
                    'estado_bien' => $datos['estado_bien'],
                    'tipo_bien' => $datos['tipo_bien'],
                    'observaciones' => $datos['observaciones'],
                    'contacto_telefono' => $datos['contacto_telefono'],
                    'contacto_correo' => $datos['contacto_correo'],
                    'autoriza_datos' => $datos['autoriza_datos'],
                    'autoriza_sensibles' => $datos['autoriza_sensibles'],
                    'autorizacion_en' => $datos['autorizacion_en'],
                    'autorizacion_texto' => $datos['autorizacion_texto'],
                    // La heurística de "se llenó demasiado rápido" no aplica a un
                    // funcionario: diligenciar rápido es justo lo que se espera de
                    // alguien entrenado, y marcaría todas las fichas.
                    'revision_prioritaria' => 0,
                    'huella' => $huella,
                    // La IP se guarda derivada: sirve para investigar abuso sin
                    // conservar un dato personal que la atención no necesita.
                    'ip_hash' => hash('sha256', $req->ip().'|'.Config::get('rufe.sal', '')),
                    'user_agent' => $req->userAgent(),
                    'creado_por' => $actor['id'],
                ]
            );

            $reporteId = Db::lastId();

            foreach ($datos['personas'] as $p) {
                Db::exec(
                    'INSERT INTO rufe_personas
                        (reporte_id, orden, nombres, apellidos, tipo_documento, numero_documento,
                         documento_otro, parentesco, genero, fecha_nacimiento, pertenencia_etnica, telefono)
                     VALUES (:r, :o, :n, :a, :td, :nd, :do, :pa, :ge, :fn, :pe, :te)',
                    [
                        'r' => $reporteId,
                        'o' => $p['orden'],
                        'n' => $p['nombres'],
                        'a' => $p['apellidos'],
                        'td' => $p['tipo_documento'],
                        'nd' => $p['numero_documento'],
                        'do' => $p['documento_otro'],
                        'pa' => $p['parentesco'],
                        'ge' => $p['genero'],
                        'fn' => $p['fecha_nacimiento'],
                        'pe' => $p['pertenencia_etnica'],
                        'te' => $p['telefono'],
                    ]
                );
            }

            foreach ($datos['agropecuario'] as $a) {
                Db::exec(
                    'INSERT INTO rufe_agropecuario
                        (reporte_id, orden, tipo_cultivo, unidad_medida, area_cantidad,
                         especie_pecuaria, cantidad_unidades)
                     VALUES (:r, :o, :tc, :um, :ac, :ep, :cu)',
                    [
                        'r' => $reporteId,
                        'o' => $a['orden'],
                        'tc' => $a['tipo_cultivo'],
                        'um' => $a['unidad_medida'],
                        'ac' => $a['area_cantidad'],
                        'ep' => $a['especie_pecuaria'],
                        'cu' => $a['cantidad_unidades'],
                    ]
                );
            }

            $carga = (string) ($req->input('carga') ?? '');
            if ($carga !== '') {
                Archivos::adoptar(Archivos::hashDeCarga($carga), $reporteId);
            }

            Db::exec(
                'INSERT INTO rufe_historial (reporte_id, estado_anterior, estado_nuevo, nota)
                 VALUES (:r, NULL, :e, :n)',
                [
                    'r' => $reporteId,
                    'e' => 'RECIBIDO',
                    'n' => 'Ficha levantada en campo por '.$actor['email'].'.',
                ]
            );

            $pdo->commit();

            return $radicado;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Un reenvío por doble pulsación o por recargar la página no debe crear un
     * segundo registro del mismo hogar. Se devuelve el radicado original solo si
     * la IP coincide: si no, confirmar que "ya existe un reporte con estos datos"
     * convertiría el endpoint en una forma de averiguar quién reportó qué.
     */
    /**
     * Un reenvío por doble pulsación o por recargar la página no debe crear un
     * segundo registro del mismo hogar.
     *
     * A diferencia del reintento por `envio_id`, aquí se trata de dos capturas
     * distintas que describen lo mismo: puede ser un error, o dos funcionarios
     * que visitaron la misma casa sin saberlo. Se corta y se dice cuál es el
     * radicado que ya existe, porque quien pregunta está autorizado a saberlo.
     */
    private function revisarDuplicado(Request $req, string $huella): void
    {
        // La ventana se interpola porque es una constante de clase, no entrada del
        // usuario: MySQL no admite un marcador en la posición de INTERVAL.
        $previo = Db::first(
            'SELECT radicado FROM rufe_reportes
              WHERE huella = :h AND creado_en > (NOW() - INTERVAL '.self::HORAS_DUPLICADO.' HOUR)
              ORDER BY id DESC LIMIT 1',
            ['h' => $huella]
        );

        if ($previo === null) {
            return;
        }

        Auditoria::registrar(
            $req, 'rufe.reporte_duplicado', Auth::usuario($req), 'rufe_reportes', (string) $previo['radicado']
        );

        throw new HttpError(
            'Ya existe un reporte para este inmueble y este evento, con radicado '
            .$previo['radicado'].'. Si es una ficha distinta, verifique la dirección y el documento del jefe de hogar.',
            409
        );
    }

    /** @param list<array<string,mixed>> $personas */
    private function documentoDelJefe(array $personas): ?string
    {
        foreach ($personas as $p) {
            if (($p['parentesco'] ?? null) === Catalogos::PARENTESCO_JEFE) {
                return $p['numero_documento'] ?? null;
            }
        }

        return null;
    }

    /**
     * Identificador de envío que genera el navegador. Se valida el formato para
     * que no entre basura en una columna con índice único.
     */
    private function envioId(Request $req): ?string
    {
        $valor = $req->texto('envio_id');

        return preg_match('/^[a-f0-9-]{36}$/i', $valor) === 1 ? strtolower($valor) : null;
    }

    /**
     * Clave con la que se cuenta el consumo: el usuario, no la IP. Una brigada
     * completa puede salir a campo con la misma conexión, y contar por IP dejaría
     * fuera a todos menos al primero que reporte.
     */
    private function clave(Request $req): string
    {
        $usuario = Auth::usuario($req);

        return $usuario !== null ? 'u'.$usuario['id'] : $req->ip();
    }

    /**
     * Se corta antes de parsear: un JSON de decenas de megabytes agota la memoria
     * del proceso PHP mucho antes de que la validación pueda opinar.
     */
    private function revisarTamanoDelCuerpo(): void
    {
        $longitud = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);

        if ($longitud > Catalogos::MAX_BYTES_CUERPO) {
            throw new HttpError('El reporte enviado es demasiado extenso.', 413);
        }
    }
}
