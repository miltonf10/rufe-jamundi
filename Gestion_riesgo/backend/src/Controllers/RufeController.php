<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Request;
use App\Core\Response;
use App\Rufe\Archivos;
use App\Rufe\Busqueda;
use App\Rufe\Catalogos;
use App\Rufe\Validador;
use Throwable;

/**
 * Bandeja interna de reportes RUFE. Todo lo de aquí exige sesión; el router se
 * encarga de eso y de los roles, así que estos métodos ya pueden dar por hecho
 * que hay un usuario autorizado.
 */
final class RufeController
{
    private const POR_PAGINA = 25;

    private const MAX_POR_PAGINA = 100;

    /** Días de vigencia de un borrador de funcionario. */
    private const DIAS_BORRADOR = 30;

    // ── Bandeja ──────────────────────────────────────────────────────────────

    /**
     * Listado paginado.
     *
     * El listado no trae nombres ni documentos: para decidir qué revisar bastan
     * el evento, el lugar y la fecha, y así los datos identificatorios solo salen
     * de la base cuando alguien abre un reporte concreto, que es lo que queda
     * registrado en auditoría.
     */
    public function listar(Request $req): void
    {
        [$where, $params] = $this->filtros($req);

        $pagina = max(1, (int) ($req->query('pagina') ?? '1'));
        $porPagina = min(self::MAX_POR_PAGINA, max(1, (int) ($req->query('por_pagina') ?? (string) self::POR_PAGINA)));

        $total = (int) (Db::first(
            'SELECT COUNT(*) AS t FROM rufe_reportes r '.$where,
            $params
        )['t'] ?? 0);

        $filas = Db::all(
            'SELECT r.id, r.radicado, r.estado, r.origen, r.evento, r.fecha_evento, r.fecha_rufe,
                    r.zona, r.corregimiento, r.vereda_sector_barrio, r.tipo_bien, r.estado_bien,
                    r.revision_prioritaria, r.anonimizado_en, r.creado_en,
                    (SELECT COUNT(*) FROM rufe_personas p WHERE p.reporte_id = r.id) AS personas,
                    (SELECT COUNT(*) FROM rufe_evidencias e WHERE e.reporte_id = r.id) AS evidencias
               FROM rufe_reportes r '.$where.'
              ORDER BY r.revision_prioritaria DESC, r.creado_en DESC
              LIMIT :limite OFFSET :salto',
            $params + ['limite' => $porPagina, 'salto' => ($pagina - 1) * $porPagina]
        );

        // Buscar por cédula o por nombre es ir a por una persona concreta, no
        // hojear la bandeja. Queda constancia de quién lo hizo y de cuántas
        // fichas encontró, pero NUNCA del texto buscado: guardarlo metería la
        // cédula del ciudadano en una segunda tabla, que es justo lo que la
        // minimización de datos trata de evitar. Quién vio los datos de quién se
        // sabe igual, porque abrir una ficha se audita con su radicado.
        // El texto se vuelve a leer de la petición: `filtros()` lo tiene en una
        // variable suya, no compartida con este método.
        if (Busqueda::buscaPersona((string) ($req->query('q') ?? ''))) {
            Auditoria::registrar(
                $req,
                'rufe.busqueda_de_persona',
                Auth::exigirUsuario($req),
                'rufe_reportes',
                null,
                $total.' coincidencias'
            );
        }

        Response::ok([
            'reportes' => array_map([$this, 'presentarResumen'], $filas),
            'paginacion' => [
                'pagina' => $pagina,
                'por_pagina' => $porPagina,
                'total' => $total,
                'paginas' => (int) ceil($total / $porPagina),
            ],
        ]);
    }

    public function ver(Request $req): void
    {
        $reporte = $this->buscar((int) $req->param('id'));
        $id = (int) $reporte['id'];

        $personas = Db::all(
            'SELECT * FROM rufe_personas WHERE reporte_id = :r ORDER BY orden',
            ['r' => $id]
        );

        $agro = Db::all(
            'SELECT * FROM rufe_agropecuario WHERE reporte_id = :r ORDER BY orden',
            ['r' => $id]
        );

        $evidencias = Db::all(
            'SELECT id, tipo, nombre_original, mime, extension, tamano_bytes, creado_en
               FROM rufe_evidencias WHERE reporte_id = :r ORDER BY tipo, id',
            ['r' => $id]
        );

        $historial = Db::all(
            'SELECT estado_anterior, estado_nuevo, usuario_email, nota, creado_en
               FROM rufe_historial WHERE reporte_id = :r ORDER BY id',
            ['r' => $id]
        );

        Auditoria::registrar(
            $req,
            'rufe.reporte_consultado',
            Auth::exigirUsuario($req),
            'rufe_reportes',
            (string) $reporte['radicado']
        );

        Response::ok([
            'reporte' => $this->presentarDetalle($reporte),
            'personas' => array_map([$this, 'presentarPersona'], $personas),
            'agropecuario' => array_map([$this, 'presentarAgro'], $agro),
            'evidencias' => array_map(
                static fn (array $e): array => [
                    'id' => (int) $e['id'],
                    'tipo' => $e['tipo'],
                    'tipo_etiqueta' => Catalogos::TIPOS_EVIDENCIA[$e['tipo']]['etiqueta'] ?? $e['tipo'],
                    'nombre_original' => $e['nombre_original'],
                    'mime' => $e['mime'],
                    'extension' => $e['extension'],
                    'tamano_bytes' => (int) $e['tamano_bytes'],
                    'creado_en' => $e['creado_en'],
                ],
                $evidencias
            ),
            'historial' => array_map(
                static fn (array $h): array => [
                    'estado_anterior' => $h['estado_anterior'],
                    'estado_nuevo' => $h['estado_nuevo'],
                    'estado_etiqueta' => Catalogos::ESTADOS_REPORTE[$h['estado_nuevo']] ?? $h['estado_nuevo'],
                    'usuario_email' => $h['usuario_email'],
                    'nota' => $h['nota'],
                    'creado_en' => $h['creado_en'],
                ],
                $historial
            ),
        ]);
    }

    public function cambiarEstado(Request $req): void
    {
        $reporte = $this->buscar((int) $req->param('id'));
        $actor = Auth::exigirUsuario($req);

        $nuevo = $req->texto('estado');
        $nota = mb_substr($req->texto('nota'), 0, 500);

        if (! isset(Catalogos::ESTADOS_REPORTE[$nuevo])) {
            throw HttpError::validacion(['estado' => 'Seleccione un estado válido.']);
        }

        if ($nuevo === (string) $reporte['estado']) {
            throw HttpError::validacion(['estado' => 'El reporte ya se encuentra en ese estado.']);
        }

        // Rechazar es una decisión que afecta a un ciudadano: debe quedar dicho
        // por qué, tanto para él como para quien revise el expediente después.
        if ($nuevo === 'RECHAZADO' && mb_strlen($nota) < 10) {
            throw HttpError::validacion(['nota' => 'Explique en pocas palabras por qué se rechaza el reporte.']);
        }

        $anterior = (string) $reporte['estado'];
        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            // El Vo.Bo. del formato es exactamente esto: quién dio por buena la
            // información y cuándo.
            if ($nuevo === 'VALIDADO') {
                Db::exec(
                    'UPDATE rufe_reportes SET estado = :e, vobo_usuario_id = :u, vobo_en = NOW() WHERE id = :i',
                    ['e' => $nuevo, 'u' => $actor['id'], 'i' => $reporte['id']]
                );
            } else {
                Db::exec(
                    'UPDATE rufe_reportes SET estado = :e WHERE id = :i',
                    ['e' => $nuevo, 'i' => $reporte['id']]
                );
            }

            Db::exec(
                'INSERT INTO rufe_historial
                    (reporte_id, estado_anterior, estado_nuevo, usuario_id, usuario_email, nota)
                 VALUES (:r, :ea, :en, :ui, :ue, :n)',
                [
                    'r' => $reporte['id'],
                    'ea' => $anterior,
                    'en' => $nuevo,
                    'ui' => $actor['id'],
                    'ue' => $actor['email'],
                    'n' => $nota === '' ? null : $nota,
                ]
            );

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }

        Auditoria::registrar(
            $req,
            'rufe.estado_cambiado',
            $actor,
            'rufe_reportes',
            (string) $reporte['radicado'],
            $anterior.' → '.$nuevo
        );

        Response::ok(['reporte' => $this->presentarDetalle($this->buscar((int) $reporte['id']))]);
    }

    /**
     * Corrige el contenido de un reporte.
     *
     * El cuerpo es el mismo que el del envío ciudadano y pasa por el mismo
     * validador: un reporte corregido a mano no puede quedar en un estado que el
     * formulario público no habría podido producir.
     *
     * No se tocan el radicado, el estado, el origen ni la autorización de
     * tratamiento. El radicado ya está en manos del ciudadano; el consentimiento
     * lo dio él y un funcionario no puede otorgárselo ni retirárselo.
     */
    public function actualizar(Request $req): void
    {
        $reporte = $this->buscar((int) $req->param('id'));
        $actor = Auth::exigirUsuario($req);

        if ($reporte['anonimizado_en'] !== null) {
            throw HttpError::validacion(['id' => 'Un reporte anonimizado ya no se puede corregir.']);
        }

        ['errores' => $errores, 'datos' => $datos] = Validador::reporte($req->todo());

        if ($errores !== []) {
            throw HttpError::validacion($errores, 'Revise los datos marcados.');
        }

        $nota = mb_substr($req->texto('nota'), 0, 500);
        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            Db::exec(
                'UPDATE rufe_reportes SET
                    evento = :evento, fecha_evento = :fecha_evento, zona = :zona,
                    corregimiento = :corregimiento, vereda_sector_barrio = :vereda_sector_barrio,
                    direccion = :direccion, latitud = :latitud, longitud = :longitud,
                    precision_m = :precision_m, alojamiento = :alojamiento,
                    alojamiento_direccion = :alojamiento_direccion, forma_tenencia = :forma_tenencia,
                    estado_bien = :estado_bien, tipo_bien = :tipo_bien, observaciones = :observaciones,
                    contacto_telefono = :contacto_telefono, contacto_correo = :contacto_correo
                  WHERE id = :id',
                [
                    'evento' => $datos['evento'],
                    'fecha_evento' => $datos['fecha_evento'],
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
                    'id' => $reporte['id'],
                ]
            );

            // Las filas hijas se reemplazan en bloque en vez de compararse una a
            // una: el formato numera los renglones por posición, así que casarlos
            // exigiría una identidad que el papel no tiene.
            Db::exec('DELETE FROM rufe_personas WHERE reporte_id = :r', ['r' => $reporte['id']]);
            Db::exec('DELETE FROM rufe_agropecuario WHERE reporte_id = :r', ['r' => $reporte['id']]);

            foreach ($datos['personas'] as $p) {
                Db::exec(
                    'INSERT INTO rufe_personas
                        (reporte_id, orden, nombres, apellidos, tipo_documento, numero_documento,
                         documento_otro, parentesco, genero, fecha_nacimiento, pertenencia_etnica, telefono)
                     VALUES (:r, :o, :n, :a, :td, :nd, :do, :pa, :ge, :fn, :pe, :te)',
                    [
                        'r' => $reporte['id'],
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
                        'r' => $reporte['id'],
                        'o' => $a['orden'],
                        'tc' => $a['tipo_cultivo'],
                        'um' => $a['unidad_medida'],
                        'ac' => $a['area_cantidad'],
                        'ep' => $a['especie_pecuaria'],
                        'cu' => $a['cantidad_unidades'],
                    ]
                );
            }

            Db::exec(
                'INSERT INTO rufe_historial
                    (reporte_id, estado_anterior, estado_nuevo, usuario_id, usuario_email, nota)
                 VALUES (:r, :ea, :en, :ui, :ue, :n)',
                [
                    'r' => $reporte['id'],
                    'ea' => $reporte['estado'],
                    'en' => $reporte['estado'],
                    'ui' => $actor['id'],
                    'ue' => $actor['email'],
                    'n' => $nota === '' ? 'Contenido corregido por un funcionario.' : $nota,
                ]
            );

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }

        Auditoria::registrar(
            $req,
            'rufe.reporte_corregido',
            $actor,
            'rufe_reportes',
            (string) $reporte['radicado'],
            $nota === '' ? null : $nota
        );

        Response::ok(['reporte' => $this->presentarDetalle($this->buscar((int) $reporte['id']))]);
    }

    public function descargarEvidencia(Request $req): void
    {
        $reporte = $this->buscar((int) $req->param('id'));

        $fila = Db::first(
            'SELECT * FROM rufe_evidencias WHERE id = :e AND reporte_id = :r',
            ['e' => (int) $req->param('evidencia'), 'r' => $reporte['id']]
        );

        if ($fila === null) {
            throw HttpError::noEncontrado('El archivo no existe.');
        }

        Auditoria::registrar(
            $req,
            'rufe.evidencia_descargada',
            Auth::exigirUsuario($req),
            'rufe_reportes',
            (string) $reporte['radicado'],
            'evidencia '.$fila['id']
        );

        Archivos::emitir($fila);
    }

    /**
     * Sustituye los datos identificatorios por marcas y conserva lo estadístico.
     *
     * No se borra la fila: el reporte sigue contando en los indicadores del
     * municipio, que es información de interés público, mientras desaparece lo
     * que permite saber de quién se trataba.
     */
    public function anonimizar(Request $req): void
    {
        $reporte = $this->buscar((int) $req->param('id'));

        if ($reporte['anonimizado_en'] !== null) {
            throw HttpError::validacion(['id' => 'Este reporte ya fue anonimizado.']);
        }

        $actor = Auth::exigirUsuario($req);
        $evidencias = [];
        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            Db::exec(
                "UPDATE rufe_personas
                    SET nombres = '[ANONIMIZADO]', apellidos = '[ANONIMIZADO]',
                        numero_documento = NULL, documento_otro = NULL, telefono = NULL
                  WHERE reporte_id = :r",
                ['r' => $reporte['id']]
            );

            Db::exec(
                "UPDATE rufe_reportes
                    SET direccion = '[ANONIMIZADO]', alojamiento_direccion = NULL,
                        contacto_telefono = '', contacto_correo = NULL, observaciones = NULL,
                        latitud = NULL, longitud = NULL, precision_m = NULL,
                        ip_hash = NULL, user_agent = NULL, anonimizado_en = NOW()
                  WHERE id = :i",
                ['i' => $reporte['id']]
            );

            $evidencias = Db::all(
                'SELECT id, ruta_relativa FROM rufe_evidencias WHERE reporte_id = :r',
                ['r' => $reporte['id']]
            );

            Db::exec('DELETE FROM rufe_evidencias WHERE reporte_id = :r', ['r' => $reporte['id']]);

            Db::exec(
                'INSERT INTO rufe_historial
                    (reporte_id, estado_anterior, estado_nuevo, usuario_id, usuario_email, nota)
                 VALUES (:r, :ea, :en, :ui, :ue, :n)',
                [
                    'r' => $reporte['id'],
                    // Sin emulación de preparadas, PDO no permite repetir un
                    // marcador con nombre: el estado va dos veces con dos nombres.
                    'ea' => $reporte['estado'],
                    'en' => $reporte['estado'],
                    'ui' => $actor['id'],
                    'ue' => $actor['email'],
                    'n' => 'Datos personales anonimizados.',
                ]
            );

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }

        // Los archivos se borran del disco después del commit: borrarlos dentro
        // de la transacción los perdería igual si esta se revirtiera, porque el
        // sistema de archivos no participa del rollback.
        Archivos::borrarVarios($evidencias);

        Auditoria::registrar(
            $req,
            'rufe.reporte_anonimizado',
            $actor,
            'rufe_reportes',
            (string) $reporte['radicado']
        );

        Response::ok(['mensaje' => 'Los datos personales del reporte fueron eliminados.']);
    }

    // ── Borradores del funcionario ───────────────────────────────────────────

    public function listarBorradores(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $this->purgarBorradores();

        $filas = Db::all(
            'SELECT clave, expira_en, creado_en, actualizado_en
               FROM rufe_borradores WHERE usuario_id = :u ORDER BY actualizado_en DESC',
            ['u' => $actor['id']]
        );

        Response::ok(['borradores' => $filas]);
    }

    public function verBorrador(Request $req): void
    {
        $fila = $this->buscarBorrador($req);

        Response::ok([
            'borrador' => [
                'clave' => $fila['clave'],
                'contenido' => json_decode((string) $fila['contenido'], true),
                'actualizado_en' => $fila['actualizado_en'],
            ],
        ]);
    }

    /**
     * Crea o actualiza en una sola operación. El cliente autoguarda cada pocos
     * segundos y no debe tener que saber si el borrador ya existía.
     */
    public function guardarBorrador(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $this->purgarBorradores();

        $clave = $req->texto('clave');
        if (preg_match('/^[a-f0-9\-]{36}$/i', $clave) !== 1) {
            throw HttpError::validacion(['clave' => 'El identificador del borrador no es válido.']);
        }

        $contenido = $req->input('contenido');
        if (! is_array($contenido)) {
            throw HttpError::validacion(['contenido' => 'No se recibió el contenido del borrador.']);
        }

        $json = json_encode($contenido, JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > 1048576) {
            throw HttpError::validacion(['contenido' => 'El borrador es demasiado extenso.']);
        }

        Db::exec(
            'INSERT INTO rufe_borradores (clave, usuario_id, contenido, expira_en)
             VALUES (:c, :u, :j, :e)
             ON DUPLICATE KEY UPDATE contenido = VALUES(contenido), expira_en = VALUES(expira_en)',
            [
                'c' => $clave,
                'u' => $actor['id'],
                'j' => $json,
                'e' => date('Y-m-d H:i:s', time() + self::DIAS_BORRADOR * 86400),
            ]
        );

        Response::ok(['clave' => $clave, 'guardado_en' => date('c')]);
    }

    public function eliminarBorrador(Request $req): void
    {
        $fila = $this->buscarBorrador($req);

        Db::exec('DELETE FROM rufe_borradores WHERE id = :i', ['i' => (int) $fila['id']]);

        Response::sinContenido();
    }

    // ── Apoyo ────────────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function buscar(int $id): array
    {
        $reporte = Db::first('SELECT * FROM rufe_reportes WHERE id = :i', ['i' => $id]);

        if ($reporte === null) {
            throw HttpError::noEncontrado('El reporte no existe.');
        }

        return $reporte;
    }

    /**
     * Un funcionario solo alcanza sus propios borradores. El filtro va en el
     * WHERE y no en una comprobación posterior: así no hay forma de olvidarlo en
     * una de las rutas.
     *
     * @return array<string,mixed>
     */
    private function buscarBorrador(Request $req): array
    {
        $actor = Auth::exigirUsuario($req);

        $fila = Db::first(
            'SELECT * FROM rufe_borradores WHERE clave = :c AND usuario_id = :u',
            ['c' => $req->param('clave'), 'u' => $actor['id']]
        );

        if ($fila === null) {
            throw HttpError::noEncontrado('El borrador no existe.');
        }

        return $fila;
    }

    private function purgarBorradores(): void
    {
        Db::exec('DELETE FROM rufe_borradores WHERE expira_en < NOW()');
    }

    /**
     * Arma el WHERE de la bandeja. Cada filtro se contrasta con su catálogo antes
     * de entrar, y los valores viajan siempre como parámetros.
     *
     * @return array{0:string,1:array<string,mixed>}
     */
    private function filtros(Request $req): array
    {
        $condiciones = [];
        $params = [];

        $estado = (string) ($req->query('estado') ?? '');
        if (isset(Catalogos::ESTADOS_REPORTE[$estado])) {
            $condiciones[] = 'r.estado = :estado';
            $params['estado'] = $estado;
        }

        $zona = (string) ($req->query('zona') ?? '');
        if (isset(Catalogos::ZONAS[$zona])) {
            $condiciones[] = 'r.zona = :zona';
            $params['zona'] = $zona;
        }

        foreach (['desde' => '>=', 'hasta' => '<='] as $clave => $operador) {
            $valor = (string) ($req->query($clave) ?? '');
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $valor) === 1) {
                $condiciones[] = "r.fecha_evento {$operador} :{$clave}";
                $params[$clave] = $valor;
            }
        }

        // La búsqueda sí alcanza nombres y cédulas: encontrar a una persona
        // censada es el motivo por el que existe la bandeja para quien atiende a
        // un damnificado en ventanilla. Que sea un acceso dirigido a datos
        // personales se compensa con lo que ya hay alrededor — solo usuarios con
        // sesión, y cada ficha que se abre queda en la auditoría — más el
        // registro de la propia búsqueda, unas líneas más abajo.
        $q = trim((string) ($req->query('q') ?? ''));
        [$condicionBusqueda, $paramsBusqueda] = Busqueda::condicion($q);
        if ($condicionBusqueda !== '') {
            $condiciones[] = $condicionBusqueda;
            $params += $paramsBusqueda;
        }

        return [
            $condiciones === [] ? '' : 'WHERE '.implode(' AND ', $condiciones),
            $params,
        ];
    }

    /**
     * @param  array<string,mixed>  $r
     * @return array<string,mixed>
     */
    private function presentarResumen(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'radicado' => $r['radicado'],
            'estado' => $r['estado'],
            'estado_etiqueta' => Catalogos::ESTADOS_REPORTE[$r['estado']] ?? $r['estado'],
            'origen' => $r['origen'],
            'evento' => $r['evento'],
            'fecha_evento' => $r['fecha_evento'],
            'zona' => $r['zona'],
            'zona_etiqueta' => Catalogos::ZONAS[$r['zona']] ?? $r['zona'],
            'corregimiento' => $r['corregimiento'],
            'vereda_sector_barrio' => $r['vereda_sector_barrio'],
            'tipo_bien' => $r['tipo_bien'],
            'tipo_bien_etiqueta' => Catalogos::TIPOS_BIEN[$r['tipo_bien']]['etiqueta'] ?? $r['tipo_bien'],
            'estado_bien' => $r['estado_bien'],
            'estado_bien_etiqueta' => Catalogos::ESTADOS_BIEN[$r['estado_bien']] ?? $r['estado_bien'],
            'personas' => (int) $r['personas'],
            'evidencias' => (int) $r['evidencias'],
            'revision_prioritaria' => (bool) $r['revision_prioritaria'],
            'anonimizado' => $r['anonimizado_en'] !== null,
            'creado_en' => $r['creado_en'],
        ];
    }

    /**
     * @param  array<string,mixed>  $r
     * @return array<string,mixed>
     */
    private function presentarDetalle(array $r): array
    {
        // ip_hash, user_agent y huella existen para investigar abuso, no para
        // mostrarse: quedan fuera de la respuesta.
        return $this->presentarResumen($r + ['personas' => 0, 'evidencias' => 0]) + [
            'formato_version' => $r['formato_version'],
            'departamento' => $r['departamento'],
            'municipio' => $r['municipio'],
            'fecha_rufe' => $r['fecha_rufe'],
            'direccion' => $r['direccion'],
            'latitud' => $r['latitud'] === null ? null : (float) $r['latitud'],
            'longitud' => $r['longitud'] === null ? null : (float) $r['longitud'],
            'precision_m' => $r['precision_m'] === null ? null : (int) $r['precision_m'],
            'alojamiento' => $r['alojamiento'],
            'alojamiento_etiqueta' => Catalogos::ALOJAMIENTOS[$r['alojamiento']] ?? $r['alojamiento'],
            'alojamiento_direccion' => $r['alojamiento_direccion'],
            'forma_tenencia' => $r['forma_tenencia'],
            'forma_tenencia_etiqueta' => Catalogos::FORMAS_TENENCIA[$r['forma_tenencia']] ?? $r['forma_tenencia'],
            'observaciones' => $r['observaciones'],
            'contacto_telefono' => $r['contacto_telefono'],
            'contacto_correo' => $r['contacto_correo'],
            'autoriza_datos' => (bool) $r['autoriza_datos'],
            'autoriza_sensibles' => (bool) $r['autoriza_sensibles'],
            'autorizacion_en' => $r['autorizacion_en'],
            'autorizacion_texto' => $r['autorizacion_texto'],
            'vobo_en' => $r['vobo_en'],
            'anonimizado_en' => $r['anonimizado_en'],
            'actualizado_en' => $r['actualizado_en'],
        ];
    }

    /**
     * @param  array<string,mixed>  $p
     * @return array<string,mixed>
     */
    private function presentarPersona(array $p): array
    {
        return [
            'orden' => (int) $p['orden'],
            'nombres' => $p['nombres'],
            'apellidos' => $p['apellidos'],
            'tipo_documento' => (int) $p['tipo_documento'],
            'tipo_documento_etiqueta' => Catalogos::etiquetaDocumento((int) $p['tipo_documento']),
            'numero_documento' => $p['numero_documento'],
            'documento_otro' => $p['documento_otro'],
            'parentesco' => (int) $p['parentesco'],
            'parentesco_etiqueta' => Catalogos::PARENTESCOS[(int) $p['parentesco']] ?? '',
            'genero' => (int) $p['genero'],
            'genero_etiqueta' => Catalogos::GENEROS[(int) $p['genero']] ?? '',
            'fecha_nacimiento' => $p['fecha_nacimiento'],
            'pertenencia_etnica' => (int) $p['pertenencia_etnica'],
            'pertenencia_etnica_etiqueta' => Catalogos::ETNIAS[(int) $p['pertenencia_etnica']] ?? '',
            'telefono' => $p['telefono'],
        ];
    }

    /**
     * @param  array<string,mixed>  $a
     * @return array<string,mixed>
     */
    private function presentarAgro(array $a): array
    {
        return [
            'orden' => (int) $a['orden'],
            'tipo_cultivo' => $a['tipo_cultivo'],
            'unidad_medida' => $a['unidad_medida'],
            'unidad_medida_etiqueta' => Catalogos::UNIDADES_MEDIDA[$a['unidad_medida']] ?? null,
            'area_cantidad' => $a['area_cantidad'] === null ? null : (float) $a['area_cantidad'],
            'especie_pecuaria' => $a['especie_pecuaria'],
            'cantidad_unidades' => $a['cantidad_unidades'] === null ? null : (int) $a['cantidad_unidades'],
        ];
    }
}
