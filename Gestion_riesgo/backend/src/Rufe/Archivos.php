<?php

declare(strict_types=1);

namespace App\Rufe;

use App\Core\Config;
use App\Core\Db;
use App\Core\HttpError;
use App\Inspeccion\Catalogos as InspeccionCatalogos;
use RuntimeException;

/**
 * Evidencias fotográficas del reporte. Campo añadido: el formato de papel no lo
 * contempla.
 *
 * Reglas que gobiernan este archivo:
 *
 * - Nada de lo que envía el cliente se usa para construir una ruta. El nombre en
 *   disco se genera con random_bytes y la extensión sale de una lista blanca; el
 *   nombre original solo se guarda como texto en la base.
 * - El MIME se determina leyendo el contenido con finfo, nunca con el que
 *   declara el navegador, que es un simple encabezado que cualquiera falsifica.
 * - Los archivos viven fuera del docroot. Si Apache nunca puede alcanzarlos, da
 *   igual que alguien logre subir código: no hay URL que lo ejecute.
 *
 * Limitación documentada: el hosting compartido no ofrece antivirus, así que no
 * se analiza el contenido más allá de la coherencia formato/extensión. Las
 * mitigaciones son la lista blanca, el límite de tamaño y cantidad, el renombrado
 * y el almacenamiento inalcanzable por web.
 */
final class Archivos
{
    /** Vigencia de una carga sin adoptar, en horas. */
    public const HORAS_CARGA = 2;

    // ── Cargas temporales ────────────────────────────────────────────────────

    /**
     * Valida y guarda un archivo dentro de una carga aún sin reporte.
     *
     * @param  array{nombre:string,tmp:string,tamano:int,error:int}  $subido
     * @return array<string,mixed> fila creada, en la forma que ve el cliente
     */
    public static function guardarEnCarga(
        array $subido,
        string $cargaHash,
        string $tipo,
        ?string $descripcion = null
    ): array {
        self::revisarErrorDeSubida($subido['error']);

        if (! isset(Catalogos::TIPOS_EVIDENCIA[$tipo])) {
            throw HttpError::validacion(['archivo' => 'Tipo de archivo no reconocido.']);
        }

        $limite = Catalogos::TIPOS_EVIDENCIA[$tipo]['maximo'];

        // El cupo se cuenta por tipo: la cédula y las fotos del daño no compiten
        // entre sí por el mismo hueco.
        $delTipo = Db::first(
            'SELECT COUNT(*) AS n FROM rufe_evidencias WHERE carga_hash = :c AND tipo = :t',
            ['c' => $cargaHash, 't' => $tipo]
        ) ?? ['n' => 0];

        if ((int) $delTipo['n'] >= $limite) {
            // El mensaje nombra lo que se está subiendo. Con el texto genérico,
            // rechazar la segunda foto de la cédula decía «hasta 1 fotos del
            // daño», que no explica nada a quien está en la calle intentándolo.
            $etiqueta = mb_strtolower(Catalogos::TIPOS_EVIDENCIA[$tipo]['etiqueta']);

            throw HttpError::validacion([
                'archivo' => $limite === 1
                    ? 'Ya adjuntó la foto de '.$etiqueta.'. Quite la anterior si desea cambiarla.'
                    : 'Solo puede adjuntar hasta '.$limite.' fotos de este tipo.',
            ]);
        }

        $existentes = Db::first(
            'SELECT COUNT(*) AS n, COALESCE(SUM(tamano_bytes), 0) AS bytes
               FROM rufe_evidencias
              WHERE carga_hash = :c',
            ['c' => $cargaHash]
        ) ?? ['n' => 0, 'bytes' => 0];

        if ($subido['tamano'] > Catalogos::MAX_BYTES_ARCHIVO) {
            // El navegador optimiza cada foto antes de subirla; si llega algo por
            // encima del tope, o no vino del formulario o la optimización falló.
            throw HttpError::validacion([
                'archivo' => 'La foto pesa más de lo permitido. Vuelva a tomarla desde el formulario.',
            ]);
        }

        if ((int) $existentes['bytes'] + $subido['tamano'] > Catalogos::MAX_BYTES_CARGA) {
            throw HttpError::validacion(
                ['archivo' => 'En total puede adjuntar hasta '.self::enMb(Catalogos::MAX_BYTES_CARGA).'.']
            );
        }

        [$extension, $mime] = self::verificarTipo($subido['tmp'], $subido['nombre']);

        $nombreGuardado = bin2hex(random_bytes(16)).'.'.$extension;
        $relativa = 'temporal/'.$cargaHash.'/'.$nombreGuardado;
        $destino = self::base().'/'.$relativa;

        self::asegurarDirectorio(dirname($destino));

        if (! move_uploaded_file($subido['tmp'], $destino)) {
            throw new RuntimeException('No se pudo almacenar el archivo subido.');
        }

        chmod($destino, 0640);

        // El «FOTOGRAFIA DE:» del numeral 11. Se recorta en vez de rechazarse: la
        // foto ya está subida y perderla por un pie de foto largo sería absurdo.
        $pie = $descripcion === null || trim($descripcion) === ''
            ? null
            : mb_substr(trim($descripcion), 0, InspeccionCatalogos::MAX_DESCRIPCION_FOTO);

        Db::exec(
            'INSERT INTO rufe_evidencias
                (carga_hash, tipo, descripcion, nombre_original, nombre_guardado, ruta_relativa, mime,
                 extension, tamano_bytes, hash_sha256, expira_en)
             VALUES (:c, :ti, :de, :no, :ng, :rr, :mi, :ex, :ta, :ha, :exp)',
            [
                'c' => $cargaHash,
                'ti' => $tipo,
                'de' => $pie,
                'no' => self::nombreLegible($subido['nombre']),
                'ng' => $nombreGuardado,
                'rr' => $relativa,
                'mi' => $mime,
                'ex' => $extension,
                'ta' => $subido['tamano'],
                'ha' => hash_file('sha256', $destino),
                'exp' => date('Y-m-d H:i:s', time() + self::HORAS_CARGA * 3600),
            ]
        );

        $id = Db::lastId();

        return [
            'id' => $id,
            'tipo' => $tipo,
            'descripcion' => $pie,
            'nombre_original' => self::nombreLegible($subido['nombre']),
            'tamano_bytes' => $subido['tamano'],
            'mime' => $mime,
        ];
    }

    /**
     * Cambia el «FOTOGRAFIA DE:» de una foto que ya está en la carga.
     *
     * El pie se escribe DESPUÉS de tomar la foto —primero se dispara, luego se
     * describe—, así que no puede viajar en la subida. Solo se permite mientras
     * la foto siga suelta en la carga: una vez adoptada por una inspección, el
     * expediente ya está cerrado y no se retoca desde el formulario.
     */
    public static function describirEnCarga(string $cargaHash, int $id, string $descripcion): void
    {
        $pie = trim($descripcion) === ''
            ? null
            : mb_substr(trim($descripcion), 0, InspeccionCatalogos::MAX_DESCRIPCION_FOTO);

        Db::exec(
            'UPDATE rufe_evidencias
                SET descripcion = :de
              WHERE id = :i AND carga_hash = :c AND reporte_id IS NULL AND inspeccion_id IS NULL AND preinscripcion_id IS NULL',
            ['de' => $pie, 'i' => $id, 'c' => $cargaHash]
        );
    }

    /** @return list<array<string,mixed>> */
    public static function listarCarga(string $cargaHash): array
    {
        $filas = Db::all(
            'SELECT id, tipo, descripcion, nombre_original, tamano_bytes, mime
               FROM rufe_evidencias
              WHERE carga_hash = :c AND reporte_id IS NULL AND inspeccion_id IS NULL AND preinscripcion_id IS NULL
              ORDER BY id',
            ['c' => $cargaHash]
        );

        return array_map(
            static fn (array $f): array => [
                'id' => (int) $f['id'],
                'tipo' => $f['tipo'],
                'nombre_original' => $f['nombre_original'],
                'tamano_bytes' => (int) $f['tamano_bytes'],
                'mime' => $f['mime'],
            ],
            $filas
        );
    }

    public static function eliminarDeCarga(string $cargaHash, int $id): void
    {
        $fila = Db::first(
            'SELECT id, ruta_relativa FROM rufe_evidencias
              WHERE id = :i AND carga_hash = :c AND reporte_id IS NULL AND inspeccion_id IS NULL AND preinscripcion_id IS NULL',
            ['i' => $id, 'c' => $cargaHash]
        );

        if ($fila === null) {
            throw HttpError::noEncontrado('El archivo no existe o ya fue enviado.');
        }

        self::borrarDelDisco((string) $fila['ruta_relativa']);
        Db::exec('DELETE FROM rufe_evidencias WHERE id = :i', ['i' => $id]);
    }

    /**
     * Traslada los archivos de una carga al reporte recién creado.
     *
     * Se llama dentro de la transacción del envío. Si la transacción se revierte
     * después, las filas vuelven atrás pero los archivos ya se movieron: quedan
     * huérfanos en disco, sin fila que los referencie y sin URL que los alcance.
     * Es el fallo aceptado; lo contrario (mover al confirmar) exigiría un commit
     * en dos fases que no vale la pena aquí.
     *
     * @return int cuántos archivos se adoptaron
     */
    /**
     * El hash del token de una carga. NUNCA se guarda el token en claro.
     *
     * Vive aquí y no en cada controlador porque olvidarlo no da error: la
     * consulta simplemente no encuentra nada y los archivos quedan huérfanos
     * hasta caducar, sin que nadie se entere. Pasó exactamente eso con las fotos
     * de la inspección, que adoptaban con el token sin cifrar.
     */
    public static function hashDeCarga(string $token): string
    {
        if (preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            throw HttpError::noEncontrado('La carga de archivos no existe o ya venció.');
        }

        return hash('sha256', $token);
    }

    public static function adoptar(string $cargaHash, int $reporteId): int
    {
        return self::adoptarPara($cargaHash, 'reporte_id', $reporteId, 'rufe');
    }

    /**
     * Lo mismo, para el registro fotográfico del formato de inspección.
     *
     * La maquinaria de subida —validación, compresión, caducidad, purga— es la
     * misma y no se duplica: solo cambia a qué expediente se adopta la foto y en
     * qué carpeta acaba. Duplicar este módulo para tener dos copias que
     * mantener sería peor que una tabla cuyo nombre ya no describe del todo su
     * contenido.
     *
     * @return int cuántos archivos se adoptaron
     */
    public static function adoptarInspeccion(string $cargaHash, int $inspeccionId): int
    {
        return self::adoptarPara($cargaHash, 'inspeccion_id', $inspeccionId, 'inspeccion');
    }

    public static function adoptarPreinscripcion(string $cargaHash, int $preinscripcionId): int
    {
        return self::adoptarPara($cargaHash, 'preinscripcion_id', $preinscripcionId, 'preinscripcion');
    }

    /**
     * @param  string  $columna  la columna dueña; NO viene de la petición
     */
    /**
     * La carpeta definitiva de los archivos de una ficha.
     *
     * Vive aquí y la usan tanto las fotos como los videos porque el criterio es
     * uno solo: todo lo de una misma solicitud tiene que caer en la misma
     * carpeta. Con la fórmula escrita dos veces, un día una diría `Y/m` y la
     * otra `Y-m` y los archivos de un expediente quedarían repartidos en dos
     * sitios sin que nada fallara.
     */
    public static function carpetaDe(string $base, int $duenoId): string
    {
        return sprintf('%s/%s/%d', $base, date('Y/m'), $duenoId);
    }

    private static function adoptarPara(string $cargaHash, string $columna, int $duenoId, string $carpetaBase): int
    {
        // La columna es una constante del código, nunca entrada del usuario: si
        // algún día llegara de fuera, esto sería una inyección de SQL.
        if (! in_array($columna, ['reporte_id', 'inspeccion_id', 'preinscripcion_id'], true)) {
            throw new RuntimeException('Columna de adopción no permitida.');
        }

        $filas = Db::all(
            'SELECT id, nombre_guardado, ruta_relativa FROM rufe_evidencias
              WHERE carga_hash = :c AND reporte_id IS NULL AND inspeccion_id IS NULL AND preinscripcion_id IS NULL',
            ['c' => $cargaHash]
        );

        if ($filas === []) {
            return 0;
        }

        $carpeta = self::carpetaDe($carpetaBase, $duenoId);
        self::asegurarDirectorio(self::base().'/'.$carpeta);

        foreach ($filas as $fila) {
            $nueva = $carpeta.'/'.$fila['nombre_guardado'];
            $origen = self::base().'/'.$fila['ruta_relativa'];
            $destino = self::base().'/'.$nueva;

            if (is_file($origen) && ! rename($origen, $destino)) {
                throw new RuntimeException('No se pudo mover una evidencia a su carpeta definitiva.');
            }

            Db::exec(
                "UPDATE rufe_evidencias
                    SET {$columna} = :r, ruta_relativa = :rr, carga_hash = NULL, expira_en = NULL
                  WHERE id = :i",
                ['r' => $duenoId, 'rr' => $nueva, 'i' => (int) $fila['id']]
            );
        }

        @rmdir(self::base().'/temporal/'.$cargaHash);

        return count($filas);
    }

    /**
     * Sin cron en el hosting, la limpieza va montada en el tráfico: la llama el
     * endpoint que abre cargas nuevas.
     */
    public static function purgarCargasCaducadas(): void
    {
        $filas = Db::all(
            'SELECT id, ruta_relativa, carga_hash FROM rufe_evidencias
              WHERE reporte_id IS NULL AND inspeccion_id IS NULL AND preinscripcion_id IS NULL
                AND expira_en IS NOT NULL AND expira_en < NOW()
              LIMIT 200'
        );

        foreach ($filas as $fila) {
            self::borrarDelDisco((string) $fila['ruta_relativa']);
            Db::exec('DELETE FROM rufe_evidencias WHERE id = :i', ['i' => (int) $fila['id']]);
            @rmdir(self::base().'/temporal/'.$fila['carga_hash']);
        }
    }

    /**
     * Borra del disco un conjunto de filas ya eliminadas de la base.
     *
     * @param list<array<string,mixed>> $filas con al menos `ruta_relativa`
     */
    public static function borrarVarios(array $filas): void
    {
        foreach ($filas as $fila) {
            self::borrarDelDisco((string) ($fila['ruta_relativa'] ?? ''));
        }
    }

    // ── Descarga protegida ───────────────────────────────────────────────────

    /**
     * Emite el archivo al funcionario autenticado.
     *
     * El Content-Type sale de la lista blanca y no de la base, y va con nosniff y
     * una CSP que apaga todo: así, aunque un archivo lograra colarse con
     * contenido activo, el navegador no lo ejecutaría al abrirlo.
     *
     * @param array<string,mixed> $fila
     */
    public static function emitir(array $fila): void
    {
        $ruta = self::base().'/'.$fila['ruta_relativa'];

        if (! is_file($ruta)) {
            throw HttpError::noEncontrado('El archivo ya no está disponible.');
        }

        $extension = (string) $fila['extension'];

        header('Content-Type: '.self::tipoDeSalida($extension));
        header('Content-Length: '.(string) filesize($ruta));
        header('Content-Disposition: attachment; filename="'.self::nombreDescarga($fila).'"');
        header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; sandbox");
        header('Cache-Control: private, no-store');

        readfile($ruta);
    }

    /**
     * Los tipos con los que un archivo puede SALIR de aquí.
     *
     * Es una tabla aparte de `Catalogos::EXTENSIONES` porque esa solo conoce
     * fotos, y por aquí también salen los videos ciudadanos. Mientras no
     * estuvieron, todo video se emitía como `application/octet-stream`: con
     * `X-Content-Type-Options: nosniff` puesto —que sí queremos— el navegador se
     * niega a decodificarlo, así que la etiqueta <video> mostraba un recuadro
     * negro y nadie podía ver lo que el ciudadano grabó.
     *
     * Se deriva de la EXTENSIÓN, que la pone el servidor a partir de una lista
     * blanca, y NUNCA del `mime` que mandó el cliente: devolver como
     * Content-Type una cadena que eligió quien sube el archivo es la forma
     * clásica de convertir un endpoint de descarga en uno de XSS.
     *
     * `Videos::FORMATOS` decide qué se puede subir y esta qué se puede servir.
     * Una prueba comprueba que no se separen: añadir un formato allí y olvidarlo
     * aquí no rompe la subida, solo deja el video sin poder verse, que es
     * justamente el fallo que costó encontrar.
     *
     * @var array<string,string>
     */
    public const TIPOS_SALIDA = [
        'webp' => 'image/webp',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webm' => 'video/webm',
        'mp4' => 'video/mp4',
        'mov' => 'video/quicktime',
    ];

    public static function tipoDeSalida(string $extension): string
    {
        return self::TIPOS_SALIDA[strtolower($extension)] ?? 'application/octet-stream';
    }

    /**
     * El nombre con el que se guarda al descargar.
     *
     * Las fotos traen el `nombre_original` que puso el teléfono; los videos no
     * —se graban dentro de la aplicación y nunca tuvieron nombre de archivo—,
     * así que la clave puede no existir. Leerla a ciegas emitía un aviso de PHP
     * que, en local, se colaba DENTRO del cuerpo de la respuesta y corrompía el
     * archivo: los primeros bytes del video eran «<br /><b>Warning</b>».
     *
     * @param array<string,mixed> $fila
     */
    private static function nombreDescarga(array $fila): string
    {
        $origen = (string) ($fila['nombre_original'] ?? $fila['categoria_nombre'] ?? '');

        $base = pathinfo($origen, PATHINFO_FILENAME);
        $base = preg_replace('/[^A-Za-z0-9 _\-]/', '', $base) ?: 'evidencia';

        return substr($base, 0, 60).'.'.$fila['extension'];
    }

    // ── Interno ──────────────────────────────────────────────────────────────

    /**
     * Determina la extensión real. Se exige que la extensión del nombre y el
     * contenido coincidan: un .php renombrado a .jpg falla aquí porque finfo lo
     * ve como text/x-php, y un JPEG llamado .php falla porque .php no está en la
     * lista blanca.
     *
     * @return array{0:string,1:string} extensión, MIME
     */
    private static function verificarTipo(string $ruta, string $nombreOriginal): array
    {
        $extension = strtolower((string) pathinfo($nombreOriginal, PATHINFO_EXTENSION));

        if (! isset(Catalogos::EXTENSIONES[$extension])) {
            throw HttpError::validacion([
                'archivo' => 'Solo se admiten imágenes ('
                    .implode(', ', array_keys(Catalogos::EXTENSIONES)).').',
            ]);
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = $finfo !== false ? (string) finfo_file($finfo, $ruta) : '';
        if ($finfo !== false) {
            finfo_close($finfo);
        }

        if (! in_array($mime, Catalogos::EXTENSIONES[$extension], true)) {
            throw HttpError::validacion([
                'archivo' => 'El contenido del archivo no corresponde con su extensión.',
            ]);
        }

        // Se comprueba que sea una imagen de verdad y que tenga un tamaño
        // razonable. Lo segundo no es un capricho: una imagen de 30.000 píxeles
        // por lado pesa poco comprimida y agota la memoria del proceso al
        // decodificarla, que es una forma barata de tumbar el sitio.
        $medidas = @getimagesize($ruta);

        if ($medidas === false || $medidas[0] < 1 || $medidas[1] < 1) {
            throw HttpError::validacion(['archivo' => 'La imagen está dañada o no se puede leer.']);
        }

        if ($medidas[0] > Catalogos::MAX_LADO_PIXELES || $medidas[1] > Catalogos::MAX_LADO_PIXELES) {
            throw HttpError::validacion([
                'archivo' => 'La imagen tiene una resolución fuera de lo admitido.',
            ]);
        }

        return [$extension, $mime];
    }

    private static function revisarErrorDeSubida(int $error): void
    {
        if ($error === UPLOAD_ERR_OK) {
            return;
        }

        $mensaje = match ($error) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'El archivo supera el tamaño permitido por el servidor.',
            UPLOAD_ERR_PARTIAL => 'La carga se interrumpió. Intente de nuevo.',
            UPLOAD_ERR_NO_FILE => 'No se recibió ningún archivo.',
            default => 'No se pudo recibir el archivo. Intente de nuevo.',
        };

        throw HttpError::validacion(['archivo' => $mensaje]);
    }

    /** Solo para mostrarlo de vuelta; nunca toca el sistema de archivos. */
    private static function nombreLegible(string $nombre): string
    {
        $limpio = preg_replace('/[\x00-\x1F\x7F]/u', '', basename($nombre)) ?? 'archivo';

        return mb_substr(trim($limpio) === '' ? 'archivo' : trim($limpio), 0, 180);
    }

    private static function borrarDelDisco(string $relativa): void
    {
        // Cinturón y tirantes: aunque ruta_relativa la genera este mismo código,
        // un '..' guardado por error no debe poder borrar fuera del almacén.
        if (str_contains($relativa, '..')) {
            return;
        }

        $ruta = self::base().'/'.$relativa;
        if (is_file($ruta)) {
            @unlink($ruta);
        }
    }

    public static function asegurarDirectorio(string $ruta): void
    {
        if (is_dir($ruta)) {
            return;
        }

        if (! mkdir($ruta, 0750, true) && ! is_dir($ruta)) {
            throw new RuntimeException('No se pudo crear el directorio de almacenamiento.');
        }
    }

    /**
     * Raíz del almacén, fuera del docroot.
     *
     * Si el hosting no permitiera una carpeta fuera del docroot, el respaldo es
     * una dentro protegida por .htaccess, que es más débil: bastaría un cambio de
     * configuración de Apache para dejarla al descubierto.
     */
    public static function base(): string
    {
        $ruta = rtrim((string) Config::get('almacenamiento.ruta', ''), '/');

        if ($ruta === '') {
            throw new RuntimeException('Falta configurar "almacenamiento.ruta" en config.php.');
        }

        self::asegurarDirectorio($ruta);

        return $ruta;
    }

    private static function enMb(int $bytes): string
    {
        return round($bytes / 1048576).' MB';
    }
}
