<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Request;
use App\Core\Response;

/**
 * El catálogo de categorías de video de la pre-inscripción ciudadana.
 *
 * Qué hay que grabar de una vivienda no está escrito en el código: lo decide el
 * administrador desde su panel. Cambia entre una emergencia y la siguiente —un
 * sismo pide ver muros y cubierta; una inundación, alturas de agua y pisos— y
 * esperar a un despliegue para ajustarlo sería llegar tarde siempre.
 *
 * Dos reglas que no se negocian:
 *
 *  • Una categoría con videos grabados NO se borra, se desactiva. Lo que tiene
 *    datos detrás no desaparece.
 *  • Todo cambio queda en el historial, con quién y cuándo. Un video de hace
 *    tres meses grabado con una instrucción que ya nadie recuerda no se puede
 *    interpretar sin eso.
 */
final class CategoriasVideoController
{
    private const MAX_OBLIGATORIAS = 6;

    /** Lo que ve el administrador: todas, activas o no. */
    public function listar(Request $req): void
    {
        Response::ok([
            'categorias' => array_map(
                [$this, 'presentar'],
                Db::all('SELECT * FROM categorias_video ORDER BY orden ASC, id ASC')
            ),
            'maximo_obligatorias' => self::MAX_OBLIGATORIAS,
        ]);
    }

    public function crear(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $datos = $this->validar($req);

        // Al final de la lista: reordenar es un gesto aparte y explícito.
        $ultimo = (int) (Db::first('SELECT COALESCE(MAX(orden), 0) AS n FROM categorias_video')['n'] ?? 0);

        Db::exec(
            'INSERT INTO categorias_video
                (nombre, instruccion, orden, obligatoria, segundos_min, segundos_max, activa, creada_por)
             VALUES (:n, :i, :o, :ob, :smin, :smax, 1, :u)',
            [
                'n' => $datos['nombre'],
                'i' => $datos['instruccion'],
                'o' => $ultimo + 1,
                'ob' => $datos['obligatoria'],
                'smin' => $datos['segundos_min'],
                'smax' => $datos['segundos_max'],
                'u' => $actor['id'],
            ]
        );

        $id = Db::lastId();
        $this->anotar($id, 'creada', null, $this->buscar($id), $actor);
        Auditoria::registrar($req, 'categoria_video.creada', $actor, 'categorias_video', (string) $id, $datos['nombre']);

        Response::json(['ok' => true, 'data' => ['categoria' => $this->presentar($this->buscar($id))]], 201);
    }

    public function actualizar(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $id = (int) $req->param('id');
        $antes = $this->buscar($id);
        $datos = $this->validar($req, $antes);

        Db::exec(
            'UPDATE categorias_video
                SET nombre = :n, instruccion = :i, obligatoria = :ob,
                    segundos_min = :smin, segundos_max = :smax
              WHERE id = :id',
            [
                'n' => $datos['nombre'],
                'i' => $datos['instruccion'],
                'ob' => $datos['obligatoria'],
                'smin' => $datos['segundos_min'],
                'smax' => $datos['segundos_max'],
                'id' => $id,
            ]
        );

        $this->anotar($id, 'editada', $antes, $this->buscar($id), $actor);
        Auditoria::registrar($req, 'categoria_video.editada', $actor, 'categorias_video', (string) $id, $datos['nombre']);

        Response::ok(['categoria' => $this->presentar($this->buscar($id))]);
    }

    /** Activar o desactivar. Una desactivada deja de pedirse en nuevas solicitudes. */
    public function cambiarEstado(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $id = (int) $req->param('id');
        $antes = $this->buscar($id);
        $activa = (bool) $req->input('activa', false);

        if ($activa && (bool) $antes['obligatoria'] && $this->obligatoriasActivas($id) >= self::MAX_OBLIGATORIAS) {
            throw HttpError::validacion([
                'activa' => 'Ya hay '.self::MAX_OBLIGATORIAS.' categorías obligatorias activas. '
                    .'Desactive una o marque esta como opcional.',
            ]);
        }

        Db::exec('UPDATE categorias_video SET activa = :a WHERE id = :i', ['a' => $activa ? 1 : 0, 'i' => $id]);

        $this->anotar($id, $activa ? 'reactivada' : 'desactivada', $antes, $this->buscar($id), $actor);

        Response::ok(['categoria' => $this->presentar($this->buscar($id))]);
    }

    /** Reordenar. Llega la lista completa de ids en el orden deseado. */
    public function reordenar(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $ids = $req->input('orden', []);

        if (! is_array($ids) || $ids === []) {
            throw HttpError::validacion(['orden' => 'No se recibió el orden de las categorías.']);
        }

        $posicion = 0;
        foreach ($ids as $id) {
            $id = (int) $id;
            if ($id <= 0) {
                continue;
            }

            Db::exec(
                'UPDATE categorias_video SET orden = :o WHERE id = :i',
                ['o' => ++$posicion, 'i' => $id]
            );
        }

        Auditoria::registrar($req, 'categoria_video.reordenada', $actor, 'categorias_video', null, (string) $posicion);

        Response::ok([
            'categorias' => array_map(
                [$this, 'presentar'],
                Db::all('SELECT * FROM categorias_video ORDER BY orden ASC, id ASC')
            ),
        ]);
    }

    /**
     * Borrar, solo si nunca se usó.
     *
     * Con videos grabados detrás, borrarla dejaría esos videos hablando de una
     * categoría que ya no existe. Se responde explicando la alternativa en vez
     * de un «no se puede» a secas.
     */
    public function eliminar(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);
        $id = (int) $req->param('id');
        $categoria = $this->buscar($id);

        $usos = (int) (Db::first(
            'SELECT COUNT(*) AS n FROM preinscripcion_videos WHERE categoria_id = :i',
            ['i' => $id]
        )['n'] ?? 0);

        if ($usos > 0) {
            throw HttpError::validacion([
                'categoria' => 'Esta categoría ya tiene '.$usos.' video(s) grabados, así que no se puede '
                    .'borrar. Desactívela: dejará de pedirse en nuevas solicitudes y los videos anteriores '
                    .'se conservan.',
            ]);
        }

        Db::exec('DELETE FROM categorias_video WHERE id = :i', ['i' => $id]);

        Auditoria::registrar(
            $req, 'categoria_video.eliminada', $actor, 'categorias_video', (string) $id,
            (string) $categoria['nombre']
        );

        Response::sinContenido();
    }

    // ── Interno ──────────────────────────────────────────────────────────────

    /**
     * @param  array<string,mixed>|null  $previo
     * @return array<string,mixed>
     */
    private function validar(Request $req, ?array $previo = null): array
    {
        $errores = [];

        $nombre = trim($req->texto('nombre', (string) ($previo['nombre'] ?? '')));
        if (mb_strlen($nombre) < 3 || mb_strlen($nombre) > 80) {
            $errores['nombre'] = 'El nombre debe tener entre 3 y 80 caracteres.';
        }

        $instruccion = trim($req->texto('instruccion', (string) ($previo['instruccion'] ?? '')));
        if (mb_strlen($instruccion) > 300) {
            $errores['instruccion'] = 'La instrucción no puede pasar de 300 caracteres.';
        }

        $min = (int) $req->input('segundos_min', $previo['segundos_min'] ?? 5);
        $max = (int) $req->input('segundos_max', $previo['segundos_max'] ?? 30);

        // El techo de 60 s no es capricho: a 480p son unos 6 MB, y cinco
        // categorías así son media hora de subida en una conexión rural.
        if ($min < 3 || $min > 60) {
            $errores['segundos_min'] = 'La duración mínima debe estar entre 3 y 60 segundos.';
        }
        if ($max < 5 || $max > 60) {
            $errores['segundos_max'] = 'La duración máxima no puede pasar de 60 segundos.';
        }
        if ($errores === [] && $min > $max) {
            $errores['segundos_min'] = 'La duración mínima no puede ser mayor que la máxima.';
        }

        $obligatoria = (bool) $req->input('obligatoria', $previo['obligatoria'] ?? true);

        // Un catálogo que crece sin freno convierte la solicitud en una tarea de
        // media hora, y quien la abandona a la mitad se queda sin turno.
        if ($obligatoria) {
            $yaObligatorias = $this->obligatoriasActivas($previo === null ? 0 : (int) $previo['id']);
            if ($yaObligatorias >= self::MAX_OBLIGATORIAS) {
                $errores['obligatoria'] = 'Ya hay '.self::MAX_OBLIGATORIAS.' categorías obligatorias. '
                    .'Marque esta como opcional o desactive otra.';
            }
        }

        if ($errores !== []) {
            throw HttpError::validacion($errores);
        }

        return [
            'nombre' => $nombre,
            'instruccion' => $instruccion === '' ? null : $instruccion,
            'obligatoria' => $obligatoria ? 1 : 0,
            'segundos_min' => $min,
            'segundos_max' => $max,
        ];
    }

    private function obligatoriasActivas(int $excepto): int
    {
        return (int) (Db::first(
            'SELECT COUNT(*) AS n FROM categorias_video WHERE activa = 1 AND obligatoria = 1 AND id <> :i',
            ['i' => $excepto]
        )['n'] ?? 0);
    }

    /** @return array<string,mixed> */
    private function buscar(int $id): array
    {
        $fila = Db::first('SELECT * FROM categorias_video WHERE id = :i', ['i' => $id]);

        if ($fila === null) {
            throw HttpError::noEncontrado('Esa categoría no existe.');
        }

        return $fila;
    }

    /**
     * @param  array<string,mixed>|null  $antes
     * @param  array<string,mixed>  $despues
     * @param  array<string,mixed>  $actor
     */
    private function anotar(int $id, string $accion, ?array $antes, array $despues, array $actor): void
    {
        Db::exec(
            'INSERT INTO categorias_video_historial
                (categoria_id, accion, antes, despues, usuario_id, usuario_email)
             VALUES (:i, :a, :ant, :des, :u, :m)',
            [
                'i' => $id,
                'a' => $accion,
                'ant' => $antes === null ? null : json_encode($this->presentar($antes), JSON_UNESCAPED_UNICODE),
                'des' => json_encode($this->presentar($despues), JSON_UNESCAPED_UNICODE),
                'u' => $actor['id'],
                'm' => $actor['email'],
            ]
        );
    }

    /**
     * @param  array<string,mixed>  $c
     * @return array<string,mixed>
     */
    private function presentar(array $c): array
    {
        return [
            'id' => (int) $c['id'],
            'nombre' => $c['nombre'],
            'instruccion' => $c['instruccion'],
            'orden' => (int) $c['orden'],
            'obligatoria' => (bool) $c['obligatoria'],
            'segundos_min' => (int) $c['segundos_min'],
            'segundos_max' => (int) $c['segundos_max'],
            'activa' => (bool) $c['activa'],
        ];
    }
}
