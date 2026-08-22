<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Request;
use App\Core\Response;
use App\Inspeccion\BancoMateriales;
use App\Inspeccion\Catalogos;
use App\Inspeccion\NivelDano;
use App\Rufe\Archivos;
use App\Rufe\Catalogos as Rufe;

/**
 * Consulta de las inspecciones ya registradas.
 *
 * Separado del controlador de captura por la misma razón que en el RUFE: la
 * captura la usa un profesional en la puerta de una casa y la consulta se usa
 * desde una oficina. Mezclarlas hace que un cambio en una toque la otra.
 */
final class InspeccionController
{
    private const POR_PAGINA = 25;

    public function listar(Request $req): void
    {
        $filtros = [];
        $where = [];

        $estado = $req->query('estado') ?? '';
        if ($estado !== '') {
            $where[] = 'i.estado = :estado';
            $filtros['estado'] = $estado;
        }

        $combo = $req->query('combo') ?? '';
        if ($combo !== '') {
            $where[] = 'i.combo = :combo';
            $filtros['combo'] = $combo;
        }

        $sistema = $req->query('sistema') ?? '';
        if ($sistema !== '') {
            $where[] = 'i.sistema_constructivo = :sistema';
            $filtros['sistema'] = $sistema;
        }

        $q = trim($req->query('q') ?? '');
        if ($q !== '') {
            // Cada columna lleva su propio marcador. Repetir `:q` reventaría con
            // SQLSTATE[HY093] porque el PDO va sin emulación de preparadas — ya
            // costó una caída en la bandeja del RUFE.
            $comodin = '%'.$q.'%';
            $partes = [];

            foreach (['i.numero', 'i.propietario_nombres', 'i.propietario_documento', 'i.direccion_cabecera', 'i.vereda'] as $n => $columna) {
                $clave = 'q'.$n;
                $partes[] = "{$columna} LIKE :{$clave}";
                $filtros[$clave] = $comodin;
            }

            $where[] = '('.implode(' OR ', $partes).')';
        }

        $sql = $where === [] ? '' : ' WHERE '.implode(' AND ', $where);

        $total = (int) (Db::first("SELECT COUNT(*) AS n FROM inspeccion_viviendas i{$sql}", $filtros)['n'] ?? 0);

        $pagina = max(1, (int) ($req->query('pagina') ?? 1));
        $desde = ($pagina - 1) * self::POR_PAGINA;

        $filas = Db::all(
            "SELECT i.id, i.numero, i.fecha_evaluacion, i.estado, i.cumple_requisitos,
                    i.propietario_nombres, i.propietario_documento,
                    i.direccion_cabecera, i.corregimiento, i.vereda,
                    i.sistema_constructivo, i.combo, i.combo_nivel, i.colapso_total,
                    i.requiere_evacuacion, i.rufe_reporte_id
               FROM inspeccion_viviendas i{$sql}
              ORDER BY i.creado_en DESC
              LIMIT ".self::POR_PAGINA.' OFFSET '.$desde,
            $filtros
        );

        Response::ok([
            'inspecciones' => $filas,
            'total' => $total,
            'pagina' => $pagina,
            'por_pagina' => self::POR_PAGINA,
        ]);
    }

    public function ver(Request $req): void
    {
        $id = (int) $req->param('id');
        $ficha = Db::first('SELECT * FROM inspeccion_viviendas WHERE id = :i', ['i' => $id]);

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa inspección.');
        }

        $danos = Db::all(
            'SELECT elemento, afectado, nivel FROM inspeccion_danos
              WHERE inspeccion_id = :i ORDER BY orden',
            ['i' => $id]
        );

        $historial = Db::all(
            'SELECT estado, nota, usuario_email, creado_en FROM inspeccion_historial
              WHERE inspeccion_id = :i ORDER BY id',
            ['i' => $id]
        );

        $fotos = Db::all(
            'SELECT id, descripcion, nombre_original, extension, tamano_bytes, mime
               FROM rufe_evidencias WHERE inspeccion_id = :i ORDER BY id',
            ['i' => $id]
        );

        $sistema = $ficha['sistema_constructivo'];

        Response::ok([
            'inspeccion' => $ficha,
            'danos' => array_map(
                static fn (array $d): array => [
                    'elemento' => $d['elemento'],
                    'etiqueta' => $sistema !== null
                        ? (NivelDano::ELEMENTOS[$sistema][$d['elemento']] ?? $d['elemento'])
                        : $d['elemento'],
                    'afectado' => (bool) $d['afectado'],
                    'nivel' => $d['nivel'],
                    'etiqueta_nivel' => $d['nivel'] !== null
                        ? (NivelDano::ETIQUETA_NIVEL[$d['nivel']] ?? $d['nivel'])
                        : null,
                ],
                $danos
            ),
            // Se devuelve la lista GUARDADA, no una recalculada: si la norma
            // cambió desde que se hizo la inspección, el expediente tiene que
            // seguir diciendo qué se entregó entonces.
            'materiales' => $ficha['materiales_json'] !== null
                ? json_decode((string) $ficha['materiales_json'], true)
                : null,
            'parentesco' => $ficha['informante_parentesco'] !== null
                ? (Rufe::PARENTESCOS[(int) $ficha['informante_parentesco']] ?? null)
                : null,
            'requisitos' => Catalogos::REQUISITOS,
            'kits_cubierta' => BancoMateriales::KITS_CUBIERTA,
            'historial' => $historial,
            'fotos' => $fotos,
        ]);
    }

    /**
     * Una foto del registro fotográfico, para verla o descargarla.
     *
     * Las fotos viven fuera del docroot y solo salen por aquí, con sesión: un
     * enlace directo al archivo dejaría el registro fotográfico de una vivienda
     * damnificada al alcance de cualquiera que adivinara la ruta.
     *
     * Se exige que la foto pertenezca a ESTA inspección, no solo que exista:
     * sin esa condición, el identificador de una foto de otra ficha bastaría
     * para verla.
     */
    public function descargarFoto(Request $req): void
    {
        $id = (int) $req->param('id');
        $ficha = Db::first('SELECT id, numero FROM inspeccion_viviendas WHERE id = :i', ['i' => $id]);

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa inspección.');
        }

        $fila = Db::first(
            'SELECT * FROM rufe_evidencias WHERE id = :f AND inspeccion_id = :i',
            ['f' => (int) $req->param('foto'), 'i' => $ficha['id']]
        );

        if ($fila === null) {
            throw HttpError::noEncontrado('El archivo no existe.');
        }

        Auditoria::registrar(
            $req,
            'inspeccion.foto_descargada',
            Auth::exigirUsuario($req),
            'inspeccion_viviendas',
            (string) $ficha['numero'],
            'foto '.$fila['id']
        );

        Archivos::emitir($fila);
    }

    public function cambiarEstado(Request $req): void
    {
        $id = (int) $req->param('id');
        $estado = $req->texto('estado');
        $nota = mb_substr($req->texto('nota'), 0, 500);

        $validos = ['RECIBIDA', 'EN_VALIDACION', 'APROBADA', 'RECHAZADA', 'ARCHIVADA'];

        if (! in_array($estado, $validos, true)) {
            throw HttpError::validacion(['estado' => 'Estado no válido.']);
        }

        $ficha = Db::first('SELECT id, numero FROM inspeccion_viviendas WHERE id = :i', ['i' => $id]);

        if ($ficha === null) {
            throw HttpError::noEncontrado('No existe esa inspección.');
        }

        // Rechazar sin decir por qué deja al profesional sin saber qué corregir
        // y obliga a una llamada que se podía haber ahorrado.
        if ($estado === 'RECHAZADA' && trim($nota) === '') {
            throw HttpError::validacion(['nota' => 'Explique por qué se rechaza.']);
        }

        $actor = Auth::exigirUsuario($req);

        Db::exec('UPDATE inspeccion_viviendas SET estado = :e WHERE id = :i', ['e' => $estado, 'i' => $id]);
        Db::exec(
            'INSERT INTO inspeccion_historial (inspeccion_id, estado, nota, usuario_id, usuario_email)
             VALUES (:i, :e, :n, :u, :m)',
            ['i' => $id, 'e' => $estado, 'n' => $nota ?: null, 'u' => $actor['id'], 'm' => $actor['email']]
        );

        Auditoria::registrar($req, 'inspeccion.estado', $actor, 'inspeccion_viviendas', $ficha['numero'], $estado);

        Response::ok(['estado' => $estado]);
    }
}
