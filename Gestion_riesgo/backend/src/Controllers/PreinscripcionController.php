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
use App\Preinscripcion\Radicado;
use App\Preinscripcion\Senales;
use App\Preinscripcion\Validador;
use App\Preinscripcion\Videos;
use App\Rufe\Archivos;
use App\Rufe\Catalogos as Rufe;
use Throwable;

/**
 * Pre-inscripción ciudadana para la inspección de viviendas afectadas.
 *
 * `crear()` y `catalogos()` son las ÚNICAS rutas de escritura y lectura de este
 * sistema que no exigen sesión, aparte del login. Eso las convierte en la
 * superficie más expuesta que existe aquí, y por eso llevan encima todo lo que
 * el censo aplica a un funcionario y algo más:
 *
 *  • Límite de tasa por IP —no por usuario, que aquí no lo hay—.
 *  • Trampa antirrobot: el campo `sitio_web` está oculto por CSS y una persona
 *    nunca lo ve. Se responde como si todo hubiera ido bien, con un radicado
 *    que no existe, para no enseñarle al autor del robot qué lo delató.
 *  • Idempotencia por `envio_id`: reintentar sin señal no duplica el hogar.
 *  • Autorización de datos obligatoria, con la versión del aviso guardada.
 *
 * Y una ausencia deliberada: NO hay ninguna ruta pública que devuelva
 * pre-inscripciones. Consultar por radicado sería un buscador de damnificados
 * para cualquiera que probara combinaciones.
 */
final class PreinscripcionController
{
    /** Solicitudes por IP y hora. Una familia manda una; un robot, miles. */
    private const MAX_ENVIOS_HORA = 5;

    /** Tope amplio de peticiones, incluidos los reintentos que no crean nada. */
    private const MAX_INTENTOS_HORA = 60;

    private const MAX_CARGAS_HORA = 10;

    /** Cuatro fotos por solicitud, con margen para reintentos por mala señal. */
    private const MAX_ARCHIVOS_HORA = 30;

    private const MAX_VIDEOS_HORA = 20;

    /** Ocho videos de ocho trozos, con margen de reintento por mala señal. */
    private const MAX_TROZOS_HORA = 300;

    // ── Público ──────────────────────────────────────────────────────────────

    /**
     * Lo que el formulario ciudadano necesita para dibujarse.
     *
     * Solo catálogos: corregimientos, límites de archivo y la versión vigente
     * del aviso de privacidad. Nada que identifique a nadie.
     */
    public function catalogos(Request $req): void
    {
        header('Cache-Control: public, max-age=3600');

        Response::ok([
            'corregimientos' => Rufe::CORREGIMIENTOS,
            'zonas'          => Validador::ZONAS,
            // Las señales de daño que el ciudadano puede reconocer a ojo. Van
            // en el catálogo y no escritas en la pantalla para que el servidor
            // y el formulario no puedan discrepar sobre qué códigos existen.
            'senales'        => Senales::paraApi(),
            'aviso_version'  => Rufe::AVISO_VERSION,
            // Las categorías ACTIVAS, en su orden. El formulario las cachea en
            // el teléfono para que el checklist funcione también sin señal.
            'categorias_video' => array_map(
                static fn (array $c): array => [
                    'id' => (int) $c['id'],
                    'nombre' => $c['nombre'],
                    'instruccion' => $c['instruccion'],
                    'obligatoria' => (bool) $c['obligatoria'],
                    'segundos_min' => (int) $c['segundos_min'],
                    'segundos_max' => (int) $c['segundos_max'],
                ],
                Db::all('SELECT * FROM categorias_video WHERE activa = 1 ORDER BY orden ASC, id ASC')
            ),
            'video' => [
                'bytes_trozo' => Videos::BYTES_TROZO,
                'max_bytes'   => Videos::MAX_BYTES_VIDEO,
                'max_videos'  => Videos::MAX_VIDEOS_POR_CARGA,
            ],
            'limites'        => [
                'fotos_dano'       => Rufe::MAX_FOTOS_PREINSCRIPCION,
                'fotos_cedula'     => 1,
                'bytes_archivo'    => Rufe::MAX_BYTES_ARCHIVO,
                'bytes_carga'      => Rufe::MAX_BYTES_CARGA,
                'objetivo_bytes_foto' => Rufe::OBJETIVO_BYTES_FOTO,
                'extensiones'      => array_keys(Rufe::EXTENSIONES),
            ],
        ]);
    }

    /**
     * Abre una carga para las fotos de una solicitud, sin sesión.
     *
     * El token no se guarda en ninguna tabla: solo su SHA-256 acompaña a cada
     * archivo. Quien no lo tenga no puede ver ni adjuntar nada a esa carga, y
     * adivinarlo exige acertar 256 bits.
     *
     * Las cargas abandonadas caducan en dos horas y se purgan con el tráfico.
     * Sin eso, un endpoint público de subida es alojamiento gratuito.
     */
    public function abrirCarga(Request $req): void
    {
        Limite::consumir(
            'preinscripcion.carga',
            $req->ip(),
            self::MAX_CARGAS_HORA,
            3600,
            'Demasiados intentos desde esta conexión. Espere unos minutos.'
        );

        Archivos::purgarCargasCaducadas();

        Response::json([
            'ok' => true,
            'data' => [
                'carga' => bin2hex(random_bytes(32)),
                'maximo_archivos' => Rufe::MAX_FOTOS_PREINSCRIPCION + 1,
                'maximo_bytes' => Rufe::MAX_BYTES_ARCHIVO,
            ],
        ], 201);
    }

    /** Una foto por petición, para poder mostrar progreso y reintentar solo la que falló. */
    public function subirArchivo(Request $req): void
    {
        Limite::consumir(
            'preinscripcion.archivo',
            $req->ip(),
            self::MAX_ARCHIVOS_HORA,
            3600,
            'Demasiadas fotos desde esta conexión. Espere unos minutos.'
        );

        $archivo = $req->archivo('archivo');
        if ($archivo === null) {
            throw HttpError::validacion(['archivo' => 'No se recibió ninguna foto.']);
        }

        // El tipo llega del cliente pero se filtra contra una lista blanca: sin
        // ella, una solicitud ciudadana podría reclamar el cupo de diez fotos
        // del registro fotográfico de una inspección.
        $tipo = $req->campo('tipo', 'PRE_DANO');
        if (! in_array($tipo, Rufe::TIPOS_PREINSCRIPCION, true)) {
            throw HttpError::validacion(['archivo' => 'Tipo de archivo no reconocido.']);
        }

        $guardado = Archivos::guardarEnCarga($archivo, Archivos::hashDeCarga($req->param('carga')), $tipo);

        Response::json(['ok' => true, 'data' => ['archivo' => $guardado]], 201);
    }

    public function eliminarArchivo(Request $req): void
    {
        $id = (int) $req->param('id');
        if ($id <= 0) {
            throw HttpError::noEncontrado('El archivo no existe.');
        }

        Archivos::eliminarDeCarga(Archivos::hashDeCarga($req->param('carga')), $id);

        Response::sinContenido();
    }

    /** Reserva un video y devuelve cuántos trozos hay que mandar. */
    public function iniciarVideo(Request $req): void
    {
        Limite::consumir(
            'preinscripcion.video',
            $req->ip(),
            self::MAX_VIDEOS_HORA,
            3600,
            'Demasiados videos desde esta conexión. Espere unos minutos.'
        );

        Videos::purgarCaducados();

        $categoria = (int) $req->texto('categoria_id');

        Response::json([
            'ok' => true,
            'data' => Videos::iniciar(
                Archivos::hashDeCarga($req->param('carga')),
                $categoria > 0 ? $categoria : null,
                $req->texto('mime'),
                (int) $req->texto('bytes'),
                (int) $req->texto('segundos')
            ),
        ], 201);
    }

    /** Un trozo del video. Llegan en orden y se pegan al final del archivo. */
    public function subirTrozo(Request $req): void
    {
        Limite::consumir(
            'preinscripcion.trozo',
            $req->ip(),
            self::MAX_TROZOS_HORA,
            3600,
            'Demasiadas peticiones desde esta conexión. Espere unos minutos.'
        );

        $trozo = $req->archivo('trozo');
        if ($trozo === null) {
            throw HttpError::validacion(['video' => 'No se recibió el trozo del video.']);
        }

        Response::ok(Videos::recibirTrozo(
            Archivos::hashDeCarga($req->param('carga')),
            (int) $req->param('id'),
            (int) $req->campo('indice', '-1'),
            $trozo
        ));
    }

    public function crear(Request $req): void
    {
        Limite::consumir(
            'preinscripcion.intento',
            $req->ip(),
            self::MAX_INTENTOS_HORA,
            3600,
            'Demasiadas solicitudes desde esta conexión. Espere unos minutos.'
        );

        $envioId = $this->envioId($req);

        // Se lee aquí y no al final porque los dos atajos de más abajo
        // —reintento y duplicada— también tienen que adoptar los archivos.
        $carga = $req->texto('carga');
        $carga = $carga === '' ? null : $carga;

        // Reintento de un envío que ya entró: ocurre cuando la solicitud llegó
        // pero la respuesta se perdió por falta de cobertura. Se devuelve el
        // radicado original en vez de inscribir dos veces al mismo hogar.
        if ($envioId !== null) {
            $previo = Db::first(
                'SELECT id, radicado, creado_en FROM preinscripciones WHERE envio_id = :e',
                ['e' => $envioId]
            );

            if ($previo !== null) {
                Response::ok([
                    'radicado'    => $previo['radicado'],
                    'recibido_en' => date('c', strtotime((string) $previo['creado_en'])),
                    'reintento'   => true,
                    // Un reintento suele traer la misma carga ya adoptada, y
                    // entonces esto no encuentra nada y devuelve cero. Pero si
                    // el teléfono perdió la señal a mitad y volvió a subir las
                    // fotos con otra carga, aquí es donde entran.
                    'archivos_agregados' => $this->adjuntarA((int) $previo['id'], $carga),
                ]);

                return;
            }
        }

        // Trampa para robots. Se responde 201 con un radicado inventado: quien
        // lo llenó no es una persona, y decirle «te descubrí» solo sirve para
        // que afine el robot.
        if ($req->texto('sitio_web') !== '') {
            Response::json([
                'ok'   => true,
                'data' => ['radicado' => Radicado::componer(), 'recibido_en' => date('c')],
            ], 201);

            return;
        }

        Limite::consumir('preinscripcion.enviar', $req->ip(), self::MAX_ENVIOS_HORA, 3600);

        $revision = Validador::revisar($req->todo());
        if ($revision['errores'] !== []) {
            throw HttpError::validacion($revision['errores']);
        }

        $datos = $revision['datos'];
        $huella = Radicado::huella($datos['direccion'], $datos['documento']);

        // Ya existe una solicitud de esta misma vivienda: se devuelve la suya en
        // vez de crear otra. Que la familia se inscriba tres veces por nervios
        // no puede convertirse en tres turnos.
        $duplicada = Db::first(
            'SELECT id, radicado, creado_en FROM preinscripciones
              WHERE huella = :h AND estado <> :d
              ORDER BY id DESC LIMIT 1',
            ['h' => $huella, 'd' => 'DESCARTADA']
        );

        if ($duplicada !== null) {
            Response::ok([
                'radicado'    => $duplicada['radicado'],
                'recibido_en' => date('c', strtotime((string) $duplicada['creado_en'])),
                'duplicada'   => true,
                // Lo nuevo se SUMA a la solicitud que ya existía. Antes se
                // tiraba: quien volvía a inscribirse justamente porque esta vez
                // sí había podido grabar el video recibía «ya estaba
                // registrada» y perdía el video, sin enterarse.
                'archivos_agregados' => $this->adjuntarA((int) $duplicada['id'], $carga),
            ]);

            return;
        }

        $radicado = $this->guardar($datos, $huella, $envioId, $req, $carga);

        Response::json([
            'ok'   => true,
            'data' => ['radicado' => $radicado, 'recibido_en' => date('c')],
        ], 201);
    }

    /**
     * Suma a una solicitud que ya existe los archivos de un reenvío.
     *
     * Antes esto no existía y los dos atajos de `crear()` —el reintento sin
     * señal y la solicitud duplicada— devolvían el radicado y se marchaban sin
     * tocar la carga. Las fotos y los videos recién subidos se quedaban
     * huérfanos en `temporal/` y la purga se los llevaba dos horas después.
     *
     * El caso que lo hace grave: una familia se inscribe, y días más tarde
     * vuelve a inscribirse porque esta vez sí consiguió grabar el video del
     * daño. El servidor le contestaba «su vivienda ya estaba registrada» —con
     * razón— y le tiraba el video, sin decírselo. Justo la evidencia que valía
     * la pena.
     *
     * Devuelve cuántos archivos se sumaron, para poder decírselo en pantalla.
     */
    private function adjuntarA(int $preinscripcionId, ?string $carga): int
    {
        if ($carga === null) {
            return 0;
        }

        $hash = Archivos::hashDeCarga($carga);

        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            $sumados = Archivos::adoptarPreinscripcion($hash, $preinscripcionId)
                + Videos::adoptar($hash, $preinscripcionId);

            // Que quede constancia de que la ficha creció después de recibida:
            // quien la revisó ayer y la vio sin videos tiene que poder entender
            // por qué hoy tiene dos.
            if ($sumados > 0) {
                Db::exec(
                    'INSERT INTO preinscripcion_historial (preinscripcion_id, estado, nota)
                     SELECT id, estado, :n FROM preinscripciones WHERE id = :i',
                    [
                        'n' => $sumados === 1
                            ? 'El ciudadano volvió a enviar el formulario y se agregó 1 archivo.'
                            : "El ciudadano volvió a enviar el formulario y se agregaron {$sumados} archivos.",
                        'i' => $preinscripcionId,
                    ]
                );
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();

            throw $e;
        }

        return $sumados;
    }

    /**
     * @param  array<string,mixed>  $datos
     */
    private function guardar(
        array $datos,
        string $huella,
        ?string $envioId,
        Request $req,
        ?string $carga
    ): string {
        $radicado = Radicado::generar();

        // En una transacción: sin ella, un fallo al adoptar las fotos dejaría la
        // solicitud escrita y sus fotos huérfanas hasta caducar, y la familia
        // creería que mandó las evidencias.
        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            Db::exec(
                'INSERT INTO preinscripciones
                    (radicado, envio_id, nombre_completo, documento, telefono, correo,
                     direccion, zona, corregimiento, vereda, latitud, longitud, precision_m,
                     descripcion_dano, autoriza_datos, aviso_version, autorizacion_en,
                     huella, estado, origen_hash)
                 VALUES
                    (:radicado, :envio_id, :nombre, :documento, :telefono, :correo,
                     :direccion, :zona, :corregimiento, :vereda, :latitud, :longitud, :precision_m,
                     :descripcion, :autoriza, :aviso, NOW(),
                     :huella, :estado, :origen)',
                [
                    'radicado'      => $radicado,
                    'envio_id'      => $envioId ?? bin2hex(random_bytes(18)),
                    'nombre'        => $datos['nombre_completo'],
                    'documento'     => $datos['documento'],
                    'telefono'      => $datos['telefono'],
                    'correo'        => $datos['correo'],
                    'direccion'     => $datos['direccion'],
                    'zona'          => $datos['zona'],
                    'corregimiento' => $datos['corregimiento'],
                    'vereda'        => $datos['vereda'],
                    'latitud'       => $datos['latitud'],
                    'longitud'      => $datos['longitud'],
                    'precision_m'   => $datos['precision_m'],
                    'descripcion'   => $datos['descripcion_dano'],
                    'autoriza'      => $datos['autoriza_datos'],
                    'aviso'         => $datos['aviso_version'],
                    'huella'        => $huella,
                    'estado'        => 'RECIBIDA',
                    // La IP no se guarda: solo su hash con sal, que basta para
                    // contar abusos y no conserva un dato que la atención no
                    // necesita.
                    'origen'        => hash('sha256', $req->ip().'|'.Config::get('rufe.sal', '')),
                ]
            );

            $id = Db::lastId();

            // La etiqueta se copia tal como se le mostró a la persona: si algún
            // día se reescribe un texto del catálogo, el expediente tiene que
            // seguir diciendo qué fue lo que marcó.
            foreach ($datos['senales'] as $codigo) {
                Db::exec(
                    'INSERT INTO preinscripcion_senales (preinscripcion_id, codigo, etiqueta)
                     VALUES (:p, :c, :e)',
                    ['p' => $id, 'c' => $codigo, 'e' => Senales::etiqueta($codigo)]
                );
            }

            if ($carga !== null) {
                $hash = Archivos::hashDeCarga($carga);
                Archivos::adoptarPreinscripcion($hash, $id);
                Videos::adoptar($hash, $id);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();

            throw $e;
        }

        return $radicado;
    }

    // ── Interno (con sesión) ─────────────────────────────────────────────────

    public function listar(Request $req): void
    {
        // Mantenimiento montado en el tráfico, igual que la purga de cargas
        // caducadas: aquí no hay consola ni tareas programadas. Recoloca los
        // videos que quedaron en `temporal/` de cuando la adopción no los movía.
        // Con tope, para que abrir la bandeja no se vuelva un trabajo largo.
        Videos::reubicarPendientes();

        $estado = strtoupper($req->query('estado', '') ?? '');
        $where = '';
        $filtros = [];

        if (in_array($estado, ['RECIBIDA', 'EN_REVISION', 'CONVERTIDA', 'DESCARTADA'], true)) {
            $where = ' WHERE estado = :estado';
            $filtros['estado'] = $estado;
        }

        $pagina = max(1, (int) ($req->query('pagina', '1') ?? 1));
        $porPagina = 25;
        $desde = ($pagina - 1) * $porPagina;

        $total = (int) (Db::first("SELECT COUNT(*) AS n FROM preinscripciones{$where}", $filtros)['n'] ?? 0);

        $filas = Db::all(
            "SELECT id, radicado, nombre_completo, documento, telefono, correo, direccion,
                    zona, corregimiento, vereda, latitud, longitud, estado, inspeccion_id,
                    creado_en
               FROM preinscripciones{$where}
              ORDER BY id DESC
              LIMIT {$porPagina} OFFSET {$desde}",
            $filtros
        );

        Response::ok([
            'preinscripciones' => $this->conLoQueMandaron($filas),
            'total'            => $total,
            'pagina'           => $pagina,
            'por_pagina'       => $porPagina,
        ]);
    }

    /**
     * Añade a cada fila del listado lo que el ciudadano adjuntó.
     *
     * Quien abre la bandeja está decidiendo a qué casa ir primero, y esa
     * decisión cambia por completo según lo que venga con la solicitud: no es
     * lo mismo un renglón de texto que uno con cuatro señales de daño, foto de
     * la cédula, tres fotos del muro y un video. Antes había que entrar una por
     * una para saberlo.
     *
     * Son TRES consultas para toda la página, no tres por fila. Con 25 filas la
     * versión ingenua son 75 consultas por pantalla, y esto corre en un hosting
     * compartido: no es una optimización prematura, es la diferencia entre que
     * la bandeja abra o que caduque. Medido: la página entera se sirve con el
     * mismo número de consultas tenga 1 fila o 25.
     *
     * @param  list<array<string,mixed>>  $filas
     * @return list<array<string,mixed>>
     */
    private function conLoQueMandaron(array $filas): array
    {
        if ($filas === []) {
            return [];
        }

        // Vienen de la base de datos y se fuerzan a entero: no hay forma de que
        // llegue aquí nada que no sea un número.
        $ids = array_map(static fn (array $f): int => (int) $f['id'], $filas);
        $lista = implode(',', $ids);

        $senales = [];
        foreach (Db::all("SELECT preinscripcion_id, codigo, etiqueta
                            FROM preinscripcion_senales
                           WHERE preinscripcion_id IN ({$lista})
                           ORDER BY id") as $s) {
            $senales[(int) $s['preinscripcion_id']][] = [
                'codigo' => $s['codigo'],
                'etiqueta' => $s['etiqueta'],
                // El dibujo se resuelve contra el catálogo de hoy; la etiqueta
                // es la que se guardó y no se toca. Ver `Senales::icono`.
                'icono' => Senales::icono((string) $s['codigo']),
            ];
        }

        // Fotos y videos en una sola pasada. La cédula se cuenta aparte porque
        // es la que dice si la solicitud se puede verificar.
        $adjuntos = [];
        foreach (Db::all("SELECT preinscripcion_id,
                                 SUM(tipo = 'PRE_CEDULA') AS cedulas,
                                 SUM(tipo <> 'PRE_CEDULA') AS fotos
                            FROM rufe_evidencias
                           WHERE preinscripcion_id IN ({$lista})
                           GROUP BY preinscripcion_id") as $a) {
            $adjuntos[(int) $a['preinscripcion_id']] = [
                'cedula' => (int) $a['cedulas'] > 0,
                'fotos'  => (int) $a['fotos'],
            ];
        }

        $videos = [];
        foreach (Db::all("SELECT preinscripcion_id, COUNT(*) AS n
                            FROM preinscripcion_videos
                           WHERE preinscripcion_id IN ({$lista})
                             AND ruta_relativa <> ''
                           GROUP BY preinscripcion_id") as $v) {
            // Solo los que conservan archivo: anunciar «2 videos» de una
            // solicitud cuyos videos ya se purgaron mandaría a alguien a
            // abrirla para no encontrar nada.
            $videos[(int) $v['preinscripcion_id']] = (int) $v['n'];
        }

        foreach ($filas as $i => $fila) {
            $id = (int) $fila['id'];

            $filas[$i]['senales'] = $senales[$id] ?? [];
            $filas[$i]['fotos'] = $adjuntos[$id]['fotos'] ?? 0;
            $filas[$i]['cedula'] = $adjuntos[$id]['cedula'] ?? false;
            $filas[$i]['videos'] = $videos[$id] ?? 0;
            // Que exista el punto GPS, no cuál es: en un listado no hace falta
            // y son las coordenadas de la casa de una familia.
            $filas[$i]['ubicada'] = $fila['latitud'] !== null && $fila['longitud'] !== null;

            unset($filas[$i]['latitud'], $filas[$i]['longitud']);
        }

        return $filas;
    }

    public function ver(Request $req): void
    {
        $id = (int) $req->param('id');
        $ficha = Db::first('SELECT * FROM preinscripciones WHERE id = :i', ['i' => $id]);

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa pre-inscripción.');
        }

        // El hash de origen no sale nunca: no le sirve a nadie en pantalla y es
        // lo más cercano a un dato de conexión que guardamos.
        unset($ficha['origen_hash']);

        Response::ok([
            'preinscripcion' => $ficha,
            'fotos' => Db::all(
                'SELECT id, nombre_original, extension, tamano_bytes, mime
                   FROM rufe_evidencias WHERE preinscripcion_id = :i ORDER BY id',
                ['i' => $id]
            ),
            'senales' => array_map(
                static fn (array $s): array => [
                    'codigo' => $s['codigo'],
                    'etiqueta' => $s['etiqueta'],
                    'icono' => Senales::icono((string) $s['codigo']),
                ],
                Db::all(
                    'SELECT codigo, etiqueta FROM preinscripcion_senales
                      WHERE preinscripcion_id = :i ORDER BY id',
                    ['i' => $id]
                )
            ),
            'videos' => Videos::deSolicitud($id),
            'historial' => Db::all(
                'SELECT estado, nota, usuario_email, creado_en FROM preinscripcion_historial
                  WHERE preinscripcion_id = :i ORDER BY id',
                ['i' => $id]
            ),
        ]);
    }

    /** Una foto de la solicitud. Vive fuera del docroot y exige sesión. */
    public function descargarFoto(Request $req): void
    {
        $id = (int) $req->param('id');
        $ficha = Db::first('SELECT id, radicado FROM preinscripciones WHERE id = :i', ['i' => $id]);

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa pre-inscripción.');
        }

        // Se exige que la foto sea DE ESTA solicitud, no solo que exista: sin
        // esa condición el identificador de una foto ajena bastaría para verla.
        $fila = Db::first(
            'SELECT * FROM rufe_evidencias WHERE id = :f AND preinscripcion_id = :i',
            ['f' => (int) $req->param('foto'), 'i' => $ficha['id']]
        );

        if ($fila === null) {
            throw HttpError::noEncontrado('El archivo no existe.');
        }

        Auditoria::registrar(
            $req,
            'preinscripcion.foto_descargada',
            Auth::exigirUsuario($req),
            'preinscripciones',
            (string) $ficha['radicado'],
            'foto '.$fila['id']
        );

        Archivos::emitir($fila);
    }

    /** Un video de la solicitud, para verlo desde la bandeja. */
    public function descargarVideo(Request $req): void
    {
        $id = (int) $req->param('id');
        $ficha = Db::first('SELECT id, radicado FROM preinscripciones WHERE id = :i', ['i' => $id]);

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa pre-inscripción.');
        }

        // Que el video sea DE ESTA solicitud, no solo que exista: sin esa
        // condición el identificador de uno ajeno bastaría para verlo.
        $fila = Db::first(
            'SELECT * FROM preinscripcion_videos
              WHERE id = :v AND preinscripcion_id = :i AND ruta_relativa <> ""',
            ['v' => (int) $req->param('video'), 'i' => $ficha['id']]
        );

        if ($fila === null) {
            throw HttpError::noEncontrado('Ese video ya no está disponible.');
        }

        Auditoria::registrar(
            $req,
            'preinscripcion.video_visto',
            Auth::exigirUsuario($req),
            'preinscripciones',
            (string) $ficha['radicado'],
            'video '.$fila['id']
        );

        Archivos::emitir($fila);
    }

    /**
     * Borra una solicitud, sus archivos y todo su rastro.
     *
     * Es la única operación de este sistema que destruye datos de un ciudadano,
     * y por eso lleva encima todo lo que se pudo poner:
     *
     *  • Solo Administrador. El Gestor descarta, que es lo que necesita para
     *    trabajar; hacer desaparecer una solicitud es otra cosa.
     *  • Una CONVERTIDA no se borra. Ninguna inspección guarda de qué solicitud
     *    nació, así que borrarla dejaría una ficha de inspección —de la que
     *    depende una entrega de materiales— sin forma de explicar por qué se
     *    hizo esa visita. La inspección sobreviviría; el motivo, no.
     *  • Se exige un motivo y queda en la auditoría junto al radicado y al
     *    nombre. Lo que desaparece es el dato personal, no la constancia de que
     *    existió y de quién decidió quitarlo.
     *
     * Los archivos se borran del disco a mano DESPUÉS de que la base de datos
     * confirme. Las claves foráneas se llevan las filas en cascada pero no
     * tocan el disco: sin esto, la foto de la cédula de una persona seguiría
     * ahí para siempre, sin ninguna fila que la nombrara y sin nadie que
     * supiera que hay que borrarla.
     */
    public function eliminar(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $id = (int) $req->param('id');

        $ficha = Db::first(
            'SELECT id, radicado, nombre_completo, estado, inspeccion_id
               FROM preinscripciones WHERE id = :i',
            ['i' => $id]
        );

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa pre-inscripción.');
        }

        if ($ficha['estado'] === 'CONVERTIDA') {
            throw HttpError::prohibido(
                'Esta solicitud ya se convirtió en inspección y no se puede borrar. '
                .'Es lo único que explica por qué se hizo esa visita.'
            );
        }

        $motivo = trim($req->texto('motivo'));
        if (mb_strlen($motivo) < 5) {
            throw HttpError::validacion([
                'motivo' => 'Escriba por qué se borra. Queda en la auditoría.',
            ]);
        }

        // Las rutas se recogen ANTES: en cuanto se borre la fila, la cascada se
        // lleva las de los archivos y ya no habría forma de saber qué borrar.
        $rutas = array_merge(
            array_column(Db::all(
                'SELECT ruta_relativa FROM rufe_evidencias WHERE preinscripcion_id = :i',
                ['i' => $id]
            ), 'ruta_relativa'),
            array_column(Db::all(
                "SELECT ruta_relativa FROM preinscripcion_videos
                  WHERE preinscripcion_id = :i AND ruta_relativa <> ''",
                ['i' => $id]
            ), 'ruta_relativa')
        );

        Db::exec('DELETE FROM preinscripciones WHERE id = :i', ['i' => $id]);

        // Después del borrado, no antes: si la consulta fallara, unos archivos
        // ya destruidos dejarían una solicitud viva y sin evidencias.
        foreach ($rutas as $ruta) {
            $absoluta = Archivos::base().'/'.$ruta;

            if (is_file($absoluta)) {
                @unlink($absoluta);
                @rmdir(dirname($absoluta));
            }
        }

        Auditoria::registrar(
            $req,
            'preinscripcion.eliminada',
            $actor,
            'preinscripciones',
            (string) $ficha['radicado'],
            mb_substr(
                $ficha['nombre_completo'].' · '.count($rutas).' archivo(s) · motivo: '.$motivo,
                0,
                500
            )
        );

        Response::ok([
            'mensaje' => 'La solicitud '.$ficha['radicado'].' se eliminó.',
            'archivos_borrados' => count($rutas),
        ]);
    }

    public function cambiarEstado(Request $req): void
    {
        $id = (int) $req->param('id');
        $estado = strtoupper($req->texto('estado'));
        $nota = mb_substr($req->texto('nota'), 0, 500);

        if (! in_array($estado, ['RECIBIDA', 'EN_REVISION', 'CONVERTIDA', 'DESCARTADA'], true)) {
            throw HttpError::validacion(['estado' => 'Estado no válido.']);
        }

        // «Convertida» no se marca a mano: la pone el sistema cuando de verdad
        // nace una inspección de esta solicitud. Dejarla aquí permitiría cerrar
        // una solicitud diciendo que se atendió sin que exista la ficha.
        if ($estado === 'CONVERTIDA') {
            throw HttpError::validacion([
                'estado' => 'Una solicitud se marca como convertida al crear la inspección, no a mano.',
            ]);
        }

        // Descartar sin decir por qué deja a la familia sin saber qué pasó con
        // su solicitud, y a quien atiende el teléfono sin nada que responder.
        if ($estado === 'DESCARTADA' && trim($nota) === '') {
            throw HttpError::validacion(['nota' => 'Explique por qué se descarta.']);
        }

        $ficha = Db::first('SELECT id, radicado FROM preinscripciones WHERE id = :i', ['i' => $id]);
        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa pre-inscripción.');
        }

        $actor = Auth::exigirUsuario($req);

        Db::exec('UPDATE preinscripciones SET estado = :e WHERE id = :i', ['e' => $estado, 'i' => $id]);
        Db::exec(
            'INSERT INTO preinscripcion_historial (preinscripcion_id, estado, nota, usuario_id, usuario_email)
             VALUES (:i, :e, :n, :u, :m)',
            ['i' => $id, 'e' => $estado, 'n' => $nota ?: null, 'u' => $actor['id'], 'm' => $actor['email']]
        );

        // Los videos ocupan cien veces más que una foto y la cuenta es compartida
        // con los demás sitios de la Alcaldía. Se borran al decidir la
        // solicitud; la fila queda como constancia de que existieron.
        if ($estado === 'DESCARTADA') {
            Videos::purgarDeSolicitud($id);
        }

        Auditoria::registrar(
            $req, 'preinscripcion.estado', $actor, 'preinscripciones', (string) $ficha['radicado'], $estado
        );

        Response::ok(['estado' => $estado]);
    }

    /** El `envio_id` que manda el navegador, si viene con la forma esperada. */
    private function envioId(Request $req): ?string
    {
        $valor = $req->texto('envio_id');

        return preg_match('/^[a-f0-9-]{16,40}$/i', $valor) === 1 ? $valor : null;
    }
}
