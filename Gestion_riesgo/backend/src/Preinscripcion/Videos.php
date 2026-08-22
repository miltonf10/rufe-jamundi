<?php

declare(strict_types=1);

namespace App\Preinscripcion;

use App\Core\Config;
use App\Core\Db;
use App\Core\HttpError;
use App\Rufe\Archivos;
use RuntimeException;

/**
 * Los videos de la pre-inscripción ciudadana, subidos por trozos.
 *
 * Por qué por trozos y no de una vez, como las fotos: el tope por archivo de
 * este hosting es 1 MiB y el `post_max_size` del servidor compartido no está
 * bajo nuestro control. Un video de 30 segundos a 480p pesa unos 3 MB, así que
 * NO cabe en una sola petición. Se parte en el navegador, se manda trozo a
 * trozo y se reensambla aquí.
 *
 * Además, partirlo hace que una subida interrumpida por falta de señal —lo
 * normal en una vereda— se reanude desde donde iba en vez de empezar de cero.
 *
 * Esta es una ruta PÚBLICA que escribe archivos en disco. Sin límites es
 * alojamiento gratuito para cualquiera, así que:
 *
 *  • Tope duro de bytes por video y de videos por carga.
 *  • El video solo existe cuando llegaron TODOS sus trozos; a medias no se
 *    adopta ni se sirve.
 *  • Lo que no se completa caduca en dos horas y se purga con el tráfico, igual
 *    que las cargas de fotos.
 *  • El MIME se verifica sobre el archivo ya armado, leyendo su contenido, no
 *    lo que diga el cliente.
 */
final class Videos
{
    /** Tamaño de trozo que manda el navegador. Debe caber en una petición. */
    public const BYTES_TROZO = 1048576;   // 1 MiB

    /**
     * Tope por video: 8 MiB.
     *
     * A 480p y 30 segundos un video pesa unos 3 MB. El margen deja pasar un
     * teléfono que comprima mal sin abrir la puerta a subir una película.
     */
    public const MAX_BYTES_VIDEO = 8388608;

    /** Cuántos videos puede llevar una solicitud. Uno por categoría, con holgura. */
    public const MAX_VIDEOS_POR_CARGA = 8;

    /**
     * Lo que el navegador puede producir: WebM en Android, MP4 en iPhone.
     *
     * Pública porque `Archivos::TIPOS_SALIDA` tiene que poder servir todo lo que
     * esta lista deja entrar, y hay una prueba que lo comprueba: un formato
     * añadido aquí y olvidado allí se sube sin problema y después no hay forma
     * de verlo.
     */
    public const FORMATOS = [
        'video/webm' => 'webm',
        'video/mp4' => 'mp4',
        'video/quicktime' => 'mov',
    ];

    /**
     * Reserva un video y devuelve su identificador.
     *
     * @return array<string,mixed>
     */
    public static function iniciar(
        string $cargaHash,
        ?int $categoriaId,
        string $mime,
        int $bytes,
        int $segundos
    ): array {
        $extension = self::FORMATOS[$mime] ?? null;

        if ($extension === null) {
            throw HttpError::validacion([
                'video' => 'Ese formato de video no se admite. Grábelo desde el formulario.',
            ]);
        }

        if ($bytes <= 0 || $bytes > self::MAX_BYTES_VIDEO) {
            throw HttpError::validacion([
                'video' => 'El video pesa más de lo permitido. Grábelo más corto.',
            ]);
        }

        $enCurso = (int) (Db::first(
            'SELECT COUNT(*) AS n FROM preinscripcion_videos WHERE carga_hash = :c',
            ['c' => $cargaHash]
        )['n'] ?? 0);

        if ($enCurso >= self::MAX_VIDEOS_POR_CARGA) {
            throw HttpError::validacion([
                'video' => 'Ya adjuntó el máximo de videos para esta solicitud.',
            ]);
        }

        // El nombre de la categoría se copia AHORA. Si el administrador la
        // renombra dentro de tres meses, el expediente tiene que seguir diciendo
        // qué se grabó entonces, no lo que hoy se llame.
        $categoria = $categoriaId === null ? null : Db::first(
            'SELECT id, nombre FROM categorias_video WHERE id = :i',
            ['i' => $categoriaId]
        );

        $nombreGuardado = bin2hex(random_bytes(16)).'.'.$extension;
        $relativa = 'temporal/'.$cargaHash.'/'.$nombreGuardado;

        Archivos::asegurarDirectorio(dirname(Archivos::base().'/'.$relativa));

        Db::exec(
            'INSERT INTO preinscripcion_videos
                (carga_hash, categoria_id, categoria_nombre, nombre_guardado, ruta_relativa,
                 mime, extension, tamano_bytes, segundos, trozos_esperados, expira_en)
             VALUES (:c, :cat, :nom, :ng, :rr, :mi, :ex, 0, :seg, :tro, :exp)',
            [
                'c' => $cargaHash,
                'cat' => $categoria === null ? null : $categoria['id'],
                'nom' => $categoria === null ? 'Sin categoría' : $categoria['nombre'],
                'ng' => $nombreGuardado,
                'rr' => $relativa,
                'mi' => $mime,
                'ex' => $extension,
                'seg' => $segundos > 0 ? min($segundos, 600) : null,
                'tro' => (int) ceil($bytes / self::BYTES_TROZO),
                'exp' => date('Y-m-d H:i:s', time() + Archivos::HORAS_CARGA * 3600),
            ]
        );

        $id = Db::lastId();

        return [
            'id' => $id,
            'bytes_trozo' => self::BYTES_TROZO,
            'trozos' => (int) ceil($bytes / self::BYTES_TROZO),
        ];
    }

    /**
     * Recibe un trozo y lo pega al final del archivo.
     *
     * Los trozos llegan en orden y se anexan; el índice viaja para poder
     * detectar una reanudación desordenada y rechazarla en vez de armar un
     * archivo corrupto que solo se descubriría al intentar verlo.
     *
     * @param  array{nombre:string,tmp:string,tamano:int,error:int}  $subido
     * @return array<string,mixed>
     */
    public static function recibirTrozo(string $cargaHash, int $videoId, int $indice, array $subido): array
    {
        $video = Db::first(
            'SELECT * FROM preinscripcion_videos WHERE id = :i AND carga_hash = :c AND preinscripcion_id IS NULL',
            ['i' => $videoId, 'c' => $cargaHash]
        );

        if ($video === null) {
            throw HttpError::noEncontrado('Ese video no existe o la carga ya venció.');
        }

        if ((bool) $video['completo']) {
            throw HttpError::validacion(['video' => 'Ese video ya se subió completo.']);
        }

        // Reenvío del trozo que ya entró: la respuesta se perdió y el navegador
        // lo repite. Se responde con el estado actual en vez de duplicarlo.
        if ($indice < (int) $video['trozos_recibidos']) {
            return self::estado($video);
        }

        if ($indice !== (int) $video['trozos_recibidos']) {
            throw HttpError::validacion([
                'video' => 'Los trozos del video llegaron desordenados. Vuelva a grabarlo.',
            ]);
        }

        if ($subido['tamano'] <= 0 || $subido['tamano'] > self::BYTES_TROZO) {
            throw HttpError::validacion(['video' => 'Trozo de video con un tamaño inesperado.']);
        }

        $total = (int) $video['tamano_bytes'] + $subido['tamano'];
        if ($total > self::MAX_BYTES_VIDEO) {
            throw HttpError::validacion(['video' => 'El video pesa más de lo permitido.']);
        }

        $destino = Archivos::base().'/'.$video['ruta_relativa'];
        $entrada = fopen($subido['tmp'], 'rb');
        $salida = fopen($destino, 'ab');

        if ($entrada === false || $salida === false) {
            throw new RuntimeException('No se pudo escribir el video.');
        }

        stream_copy_to_stream($entrada, $salida);
        fclose($entrada);
        fclose($salida);
        @chmod($destino, 0640);

        $recibidos = (int) $video['trozos_recibidos'] + 1;
        $completo = $recibidos >= (int) $video['trozos_esperados'];

        // Solo al estar entero se comprueba qué es de verdad: un trozo suelto no
        // tiene cabecera reconocible y verificarlo antes daría siempre falso.
        if ($completo && ! self::pareceVideo($destino)) {
            @unlink($destino);
            Db::exec('DELETE FROM preinscripcion_videos WHERE id = :i', ['i' => $videoId]);

            throw HttpError::validacion([
                'video' => 'El archivo recibido no es un video. Grábelo desde el formulario.',
            ]);
        }

        Db::exec(
            'UPDATE preinscripcion_videos
                SET trozos_recibidos = :tr, tamano_bytes = :ta, completo = :co
              WHERE id = :i',
            ['tr' => $recibidos, 'ta' => $total, 'co' => $completo ? 1 : 0, 'i' => $videoId]
        );

        $video['trozos_recibidos'] = $recibidos;
        $video['tamano_bytes'] = $total;
        $video['completo'] = $completo ? 1 : 0;

        return self::estado($video);
    }

    /**
     * Ata a una solicitud los videos COMPLETOS de su carga.
     *
     * Los incompletos se borran: un video a medias no se puede ver y guardarlo
     * haría creer que la evidencia está cuando no está.
     */
    public static function adoptar(string $cargaHash, int $preinscripcionId): int
    {
        // Los que se quedaron a medio subir no sirven: un archivo al que le
        // faltan trozos no lo abre ningún reproductor. Se borran.
        //
        // Pero NO en silencio. Antes desaparecían sin dejar rastro, y quien
        // revisaba la solicitud no tenía forma de saber que hubo un video: veía
        // una ficha sin videos, igual que si la persona no hubiera grabado
        // ninguno. El formulario ya no deja enviar con una subida en curso, así
        // que llegar aquí significa que se cortó la señal a mitad — y eso es
        // justo lo que hay que poder contarle a quien decide, para que sepa que
        // puede valer la pena llamar y pedirlo otra vez.
        $incompletos = Db::all(
            'SELECT id, ruta_relativa, categoria_nombre FROM preinscripcion_videos
              WHERE carga_hash = :c AND preinscripcion_id IS NULL AND completo = 0',
            ['c' => $cargaHash]
        );

        foreach ($incompletos as $suelto) {
            @unlink(Archivos::base().'/'.$suelto['ruta_relativa']);
            Db::exec('DELETE FROM preinscripcion_videos WHERE id = :i', ['i' => $suelto['id']]);
        }

        if ($incompletos !== []) {
            $nombres = implode(', ', array_column($incompletos, 'categoria_nombre'));

            Db::exec(
                'INSERT INTO preinscripcion_historial (preinscripcion_id, estado, nota)
                 SELECT id, estado, :n FROM preinscripciones WHERE id = :i',
                [
                    'n' => mb_substr(
                        'Se perdió por mala conexión un video que quedó a medio subir: '.$nombres,
                        0,
                        500
                    ),
                    'i' => $preinscripcionId,
                ]
            );
        }

        $completos = Db::all(
            'SELECT id, nombre_guardado, ruta_relativa FROM preinscripcion_videos
              WHERE carga_hash = :c AND preinscripcion_id IS NULL AND completo = 1',
            ['c' => $cargaHash]
        );

        if ($completos === []) {
            return 0;
        }

        return self::llevarACarpeta($completos, $preinscripcionId);
    }

    /**
     * Mueve unos videos a la carpeta definitiva de su solicitud y los marca.
     *
     * Antes esto NO movía nada: solo escribía `preinscripcion_id` y el archivo
     * se quedaba en `temporal/` para siempre, incluso el de una solicitud
     * aceptada. No se perdía nada —la purga solo borra lo que no tiene dueño—
     * pero dejaba una trampa puesta: el día que alguien limpiara una carpeta
     * llamada «temporal» se llevaría por delante los videos de expedientes
     * reales, y el nombre de la carpeta lo estaba invitando.
     *
     * Las fotos sí se movían desde el primer día. Esto es la mitad que faltaba.
     *
     * @param  list<array<string,mixed>>  $videos
     */
    private static function llevarACarpeta(array $videos, int $preinscripcionId): int
    {
        // La misma carpeta que las fotos de la solicitud, por el mismo cálculo:
        // un expediente repartido en dos sitios es un expediente que alguien va
        // a archivar a medias.
        $carpeta = Archivos::carpetaDe('preinscripcion', $preinscripcionId);
        Archivos::asegurarDirectorio(Archivos::base().'/'.$carpeta);

        $movidos = 0;

        foreach ($videos as $v) {
            $nueva = $carpeta.'/'.$v['nombre_guardado'];
            $origen = Archivos::base().'/'.$v['ruta_relativa'];
            $destino = Archivos::base().'/'.$nueva;

            // Si el archivo ya no está —purgado a mano, disco lleno— se corrige
            // igual la fila: dejarla apuntando a `temporal/` sería peor, porque
            // la próxima limpieza la daría por buena y volvería a intentarlo.
            if (is_file($origen) && ! rename($origen, $destino)) {
                throw new RuntimeException('No se pudo mover un video a su carpeta definitiva.');
            }

            Db::exec(
                'UPDATE preinscripcion_videos
                    SET preinscripcion_id = :p, ruta_relativa = :r
                  WHERE id = :i',
                ['p' => $preinscripcionId, 'r' => $nueva, 'i' => (int) $v['id']]
            );

            // La carpeta de origen, si queda vacía. `rmdir` falla solo si aún
            // tiene algo dentro, así que no hace falta comprobarlo: las fotos ya
            // lo intentaron antes y no pudieron porque los videos seguían ahí.
            @rmdir(dirname($origen));

            $movidos++;
        }

        return $movidos;
    }

    /**
     * Recoloca los videos que quedaron en `temporal/` de cuando `adoptar()` no
     * los movía.
     *
     * Se llama con el tráfico de la bandeja, que es el mismo criterio con el
     * que este proyecto purga las cargas caducadas: aquí no hay consola ni
     * tareas programadas, así que el mantenimiento va montado en peticiones que
     * ya ocurren. Con tope, para que abrir la bandeja no se convierta nunca en
     * un trabajo largo.
     */
    public static function reubicarPendientes(int $maximo = 20): int
    {
        $pendientes = Db::all(
            "SELECT id, preinscripcion_id, nombre_guardado, ruta_relativa
               FROM preinscripcion_videos
              WHERE preinscripcion_id IS NOT NULL
                AND ruta_relativa LIKE 'temporal/%'
              LIMIT {$maximo}"
        );

        $movidos = 0;

        foreach ($pendientes as $v) {
            $movidos += self::llevarACarpeta([$v], (int) $v['preinscripcion_id']);
        }

        return $movidos;
    }

    /**
     * Borra los videos de una solicitud ya decidida.
     *
     * Es la política acordada: el video vive hasta que la solicitud se convierte
     * en inspección o se descarta. Ocupan cien veces más que una foto y la
     * cuenta es compartida con los demás sitios de la Alcaldía; conservarlos
     * para siempre acabaría llenando el disco y tumbándolo todo.
     *
     * La FILA no se borra: queda como constancia de que ese video existió, con
     * su categoría y su duración. Lo que desaparece es el archivo.
     */
    public static function purgarDeSolicitud(int $preinscripcionId): int
    {
        $borrados = 0;

        foreach (Db::all(
            'SELECT id, ruta_relativa FROM preinscripcion_videos
              WHERE preinscripcion_id = :p AND ruta_relativa <> ""',
            ['p' => $preinscripcionId]
        ) as $v) {
            $ruta = Archivos::base().'/'.$v['ruta_relativa'];

            if (is_file($ruta) && @unlink($ruta)) {
                $borrados++;
            }

            Db::exec(
                'UPDATE preinscripcion_videos SET ruta_relativa = "" WHERE id = :i',
                ['i' => $v['id']]
            );
        }

        return $borrados;
    }

    /** Videos abandonados a medias. Se llama con el tráfico, como las cargas. */
    public static function purgarCaducados(): int
    {
        $borrados = 0;

        foreach (Db::all(
            'SELECT id, ruta_relativa FROM preinscripcion_videos
              WHERE preinscripcion_id IS NULL AND expira_en < NOW()'
        ) as $v) {
            @unlink(Archivos::base().'/'.$v['ruta_relativa']);
            Db::exec('DELETE FROM preinscripcion_videos WHERE id = :i', ['i' => $v['id']]);
            $borrados++;
        }

        return $borrados;
    }

    /** @return list<array<string,mixed>> */
    public static function deSolicitud(int $preinscripcionId): array
    {
        return array_map(
            static fn (array $v): array => [
                'id' => (int) $v['id'],
                'categoria_nombre' => $v['categoria_nombre'],
                'segundos' => $v['segundos'] === null ? null : (int) $v['segundos'],
                'tamano_bytes' => (int) $v['tamano_bytes'],
                'extension' => $v['extension'],
                'mime' => $v['mime'],
                // Vacío significa que el archivo ya se purgó tras decidir la
                // solicitud. La fila queda como constancia de que existió.
                'disponible' => $v['ruta_relativa'] !== '',
            ],
            Db::all(
                'SELECT * FROM preinscripcion_videos WHERE preinscripcion_id = :p ORDER BY id',
                ['p' => $preinscripcionId]
            )
        );
    }

    /**
     * ¿El archivo armado es de verdad un video?
     *
     * Se mira el contenido, nunca el tipo que declaró el cliente. WebM empieza
     * por la firma de Matroska y MP4/MOV llevan «ftyp» en los primeros bytes.
     */
    private static function pareceVideo(string $ruta): bool
    {
        $f = fopen($ruta, 'rb');
        if ($f === false) {
            return false;
        }

        $cabecera = (string) fread($f, 16);
        fclose($f);

        if (str_starts_with($cabecera, "\x1A\x45\xDF\xA3")) {
            return true;  // Matroska / WebM
        }

        return str_contains(substr($cabecera, 0, 12), 'ftyp');  // MP4 / MOV
    }

    /**
     * @param  array<string,mixed>  $video
     * @return array<string,mixed>
     */
    private static function estado(array $video): array
    {
        return [
            'id' => (int) $video['id'],
            'trozos_recibidos' => (int) $video['trozos_recibidos'],
            'trozos_esperados' => (int) $video['trozos_esperados'],
            'completo' => (bool) $video['completo'],
        ];
    }
}
