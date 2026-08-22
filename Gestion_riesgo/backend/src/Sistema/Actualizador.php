<?php

declare(strict_types=1);

namespace App\Sistema;

use App\Core\Config;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Migrador;
use RuntimeException;
use Throwable;
use ZipArchive;

/**
 * Aplica al servidor la última versión publicada en GitHub.
 *
 * Existe porque el hosting no tiene consola ni Git: la única forma de actualizar
 * era empaquetar a mano y subir por la API de cPanel. Esto lo convierte en un
 * botón, con la misma red de seguridad que tendría un despliegue hecho a mano
 * con cuidado: respaldo antes de sobrescribir, verificación de que el sitio
 * sigue en pie, y restauración automática si no lo está.
 *
 * Lo que NO hace, a propósito:
 *
 * - No compila nada. En cPanel no hay Node, así que el frontend solo puede
 *   copiarse ya construido desde `frontend/build/` del repositorio. Si esa
 *   carpeta no está publicada, el frontend se omite y se dice por qué, en vez de
 *   dejar el sitio a medias.
 * - No toca `config.php` ni el almacén de evidencias. Son estado del servidor,
 *   no código, y un despliegue que los pisara borraría las credenciales.
 * - No se activa solo. `actualizaciones.habilitado` viene en false: dar a un
 *   sitio en producción la capacidad de sobrescribirse es algo que se enciende
 *   a conciencia, no algo que quede puesto por venir en la plantilla.
 */
final class Actualizador
{
    /**
     * Qué copiar y a dónde. La clave es la ruta dentro del repositorio y el
     * valor la ruta en el servidor, relativa a la raíz de cada destino.
     *
     * El backend se aplana: en el repositorio el punto de entrada vive en
     * `backend/public/`, pero en el servidor va en la raíz de `api/` porque el
     * hosting solo da una carpeta por sitio y no se puede poner código por
     * encima del document root.
     *
     * @var array<string,array<string,string>>
     */
    private const MAPA = [
        'BACKEND' => [
            'Gestion_riesgo/backend/public/index.php' => 'index.php',
            'Gestion_riesgo/backend/public/.htaccess' => '.htaccess',
            'Gestion_riesgo/backend/src' => 'src',
            'Gestion_riesgo/backend/database' => 'database',
        ],
        'FRONTEND' => [
            'Gestion_riesgo/frontend/build' => '',
        ],
    ];

    /**
     * Nunca se sobrescriben ni se borran, aunque vinieran en el paquete.
     *
     * `config.php` guarda las credenciales de la base y la sal del RUFE.
     * `instalar.php` y `migrar.php` son de un solo uso y deben poder borrarse
     * del servidor sin que un despliegue los devuelva a la vida.
     *
     * @var list<string>
     */
    private const PROTEGIDAS = ['config.php', 'instalar.php', 'migrar.php', '.well-known'];

    /** Extensiones que se pueden escribir. Todo lo demás se ignora. */
    private const EXTENSIONES = [
        'php', 'html', 'js', 'css', 'json', 'sql', 'txt', 'map', 'svg',
        'png', 'jpg', 'jpeg', 'webp', 'ico', 'woff', 'woff2', 'htaccess',
    ];

    // ── Consulta ─────────────────────────────────────────────────────────────

    /**
     * Qué versión hay puesta y cuál es la última publicada.
     *
     * @return array<string,mixed>
     */
    public function estado(): array
    {
        $remoto = $this->ultimoCommit();

        $destinos = [];
        foreach (['BACKEND', 'FRONTEND'] as $destino) {
            $actual = $this->versionDesplegada($destino);
            $destinos[] = [
                'destino' => $destino,
                'version_desplegada' => $actual,
                'al_dia' => $actual !== null && $remoto !== null && $actual === $remoto['sha'],
                'raiz_configurada' => $this->raiz($destino) !== '',
            ];
        }

        return [
            'habilitado' => $this->habilitado(),
            'motivo_deshabilitado' => $this->motivoDeshabilitado(),
            'repositorio' => $this->repositorio(),
            'ultimo_commit' => $remoto,
            'destinos' => $destinos,
            'historial' => $this->historial(),
        ];
    }

    /** @return list<array<string,mixed>> */
    public function historial(int $limite = 10): array
    {
        $filas = Db::all(
            'SELECT destino, commit_sha, commit_mensaje, commit_autor, estado, archivos,
                    migraciones, detalle, usuario_email, duracion_ms, creado_en
               FROM despliegues
              ORDER BY id DESC
              LIMIT :l',
            ['l' => $limite]
        );

        return array_map(
            static fn (array $f): array => [
                'destino' => $f['destino'],
                'commit_sha' => substr((string) $f['commit_sha'], 0, 7),
                'commit_mensaje' => $f['commit_mensaje'],
                'commit_autor' => $f['commit_autor'],
                'estado' => $f['estado'],
                'archivos' => (int) $f['archivos'],
                'migraciones' => (bool) $f['migraciones'],
                'detalle' => $f['detalle'],
                'usuario_email' => $f['usuario_email'],
                'duracion_ms' => $f['duracion_ms'] === null ? null : (int) $f['duracion_ms'],
                'creado_en' => $f['creado_en'],
            ],
            $filas
        );
    }

    // ── Aplicación ───────────────────────────────────────────────────────────

    /**
     * Descarga la última versión y la aplica a los dos destinos.
     *
     * @param  array<string,mixed>  $actor
     * @return array<string,mixed>
     */
    public function aplicar(array $actor, bool $migrar = true): array
    {
        $this->exigirHabilitado();

        $remoto = $this->ultimoCommit();
        if ($remoto === null) {
            throw new HttpError('No se pudo consultar la última versión en GitHub.', 502);
        }

        // Se cargan ahora todas las clases que hacen falta después. El
        // autoloader lee de src/, y a partir del primer archivo escrito ese
        // directorio deja de ser coherente: una clase cargada tarde vendría de
        // la versión nueva mientras el resto del proceso sigue en la vieja.
        class_exists(Migrador::class);

        $zip = $this->descargarPaquete($remoto['sha']);
        $resultados = [];

        try {
            foreach (['BACKEND', 'FRONTEND'] as $destino) {
                $resultados[$destino] = $this->aplicarDestino($destino, $zip, $remoto, $migrar, $actor);
            }
        } finally {
            @unlink($zip);
        }

        return ['commit' => $remoto, 'resultados' => $resultados];
    }

    /**
     * @param  array<string,mixed>  $remoto
     * @param  array<string,mixed>  $actor
     * @return array<string,mixed>
     */
    private function aplicarDestino(
        string $destino,
        string $rutaZip,
        array $remoto,
        bool $migrar,
        array $actor
    ): array {
        $inicio = microtime(true);
        $raiz = $this->raiz($destino);

        if ($raiz === '') {
            return $this->registrar($destino, $remoto, 'OMITIDO', $actor, [
                'detalle' => 'No está configurada la ruta de este destino en config.php.',
            ]);
        }

        $anterior = $this->versionDesplegada($destino);
        if ($anterior === $remoto['sha']) {
            return $this->registrar($destino, $remoto, 'OMITIDO', $actor, [
                'detalle' => 'Ya estaba al día.',
                'version_anterior' => $anterior,
            ]);
        }

        $archivos = $this->archivosDelPaquete($rutaZip, $destino);

        if ($archivos === []) {
            return $this->registrar($destino, $remoto, 'OMITIDO', $actor, [
                'detalle' => $destino === 'FRONTEND'
                    ? 'El repositorio no publica frontend/build. Sin Node en el servidor no hay nada que copiar: publique el compilado o despliegue el frontend a mano.'
                    : 'El paquete descargado no trae archivos para este destino.',
                'version_anterior' => $anterior,
            ]);
        }

        $respaldo = null;

        try {
            $respaldo = $this->respaldar($destino, $raiz, $remoto['sha']);
            $escritos = $this->escribir($rutaZip, $archivos, $raiz);

            if ($destino === 'BACKEND' && $migrar) {
                Migrador::aplicar($raiz.'/database');
            }

            if (! $this->sitioResponde($destino)) {
                throw new RuntimeException('El sitio dejó de responder después de escribir los archivos.');
            }

            return $this->registrar($destino, $remoto, 'EXITOSO', $actor, [
                'archivos' => $escritos,
                'respaldo_ruta' => $respaldo,
                'version_anterior' => $anterior,
                'migraciones' => $destino === 'BACKEND' && $migrar,
                'duracion_ms' => (int) ((microtime(true) - $inicio) * 1000),
            ]);
        } catch (Throwable $e) {
            $restaurado = $respaldo !== null && $this->restaurar($respaldo, $raiz);

            return $this->registrar($destino, $remoto, $restaurado ? 'REVERTIDO' : 'FALLIDO', $actor, [
                'respaldo_ruta' => $respaldo,
                'version_anterior' => $anterior,
                'duracion_ms' => (int) ((microtime(true) - $inicio) * 1000),
                'detalle' => $this->explicarFallo($e, $respaldo, $restaurado, $destino),
            ]);
        }
    }

    /**
     * Qué decirle a quien está mirando cuando algo salió mal.
     *
     * Se separa si los archivos se restauraron —lo único que este código
     * controla— de si el sitio responde, que puede seguir caído por causas
     * ajenas al despliegue. Confundir las dos cosas haría que un operador
     * empezara a arreglar a mano algo que ya estaba restaurado, que es la peor
     * forma de terminar de romperlo.
     */
    private function explicarFallo(Throwable $e, ?string $respaldo, bool $restaurado, string $destino): string
    {
        if ($respaldo === null) {
            return 'Falló antes de tocar nada, así que el sitio quedó como estaba: '.$e->getMessage();
        }

        if (! $restaurado) {
            return 'Falló y NO se pudieron restaurar los archivos. Requiere intervención manual; '
                .'el respaldo está en '.$respaldo.'. Causa: '.$e->getMessage();
        }

        $enPie = $this->sitioResponde($destino)
            ? 'El sitio responde.'
            : 'OJO: el sitio sigue sin responder, así que la causa es ajena a este despliegue.';

        return 'Falló y se restauró la versión anterior. '.$enPie.' Causa: '.$e->getMessage();
    }

    // ── Paquete ──────────────────────────────────────────────────────────────

    private function descargarPaquete(string $sha): string
    {
        if (! class_exists(ZipArchive::class)) {
            throw new HttpError('El servidor no tiene la extensión ZipArchive de PHP.', 500);
        }

        $repo = $this->repositorio();
        $url = sprintf('https://api.github.com/repos/%s/%s/zipball/%s', $repo['owner'], $repo['repo'], $sha);
        $destino = sys_get_temp_dir().'/sgr-'.bin2hex(random_bytes(8)).'.zip';

        $cuerpo = $this->pedir($url, 180);
        if ($cuerpo === null || strlen($cuerpo) < 1024) {
            throw new HttpError('No se pudo descargar el código desde GitHub.', 502);
        }

        file_put_contents($destino, $cuerpo);

        return $destino;
    }

    /**
     * Qué entradas del ZIP corresponden a este destino y dónde va cada una.
     *
     * GitHub envuelve el zipball en una carpeta con un nombre impredecible
     * (`owner-repo-<sha corto>/`), así que primero hay que descubrirla.
     *
     * @return array<string,string> entrada en el ZIP => ruta relativa en el servidor
     */
    private function archivosDelPaquete(string $rutaZip, string $destino): array
    {
        $zip = new ZipArchive;
        if ($zip->open($rutaZip) !== true) {
            throw new HttpError('El paquete descargado no se pudo abrir.', 502);
        }

        $raizZip = (string) $zip->getNameIndex(0);
        $raizZip = rtrim(explode('/', $raizZip)[0], '/').'/';

        $salida = [];

        foreach (self::MAPA[$destino] as $origen => $destinoRel) {
            $prefijo = $raizZip.$origen;

            for ($i = 0; $i < $zip->numFiles; $i++) {
                $nombre = (string) $zip->getNameIndex($i);

                if (str_ends_with($nombre, '/')) {
                    continue;
                }

                if ($nombre === $prefijo) {
                    // Archivo suelto del mapa (index.php, .htaccess).
                    $salida[$nombre] = $destinoRel;

                    continue;
                }

                if (! str_starts_with($nombre, $prefijo.'/')) {
                    continue;
                }

                $relativa = substr($nombre, strlen($prefijo) + 1);
                $final = $destinoRel === '' ? $relativa : $destinoRel.'/'.$relativa;

                if ($this->admisible($final)) {
                    $salida[$nombre] = $final;
                }
            }
        }

        $zip->close();

        return $salida;
    }

    /** Ni rutas protegidas, ni extensiones fuera de la lista, ni saltos de directorio. */
    private function admisible(string $relativa): bool
    {
        if (str_contains($relativa, '..')) {
            return false;
        }

        $primera = explode('/', $relativa)[0];
        if (in_array($primera, self::PROTEGIDAS, true) || in_array($relativa, self::PROTEGIDAS, true)) {
            return false;
        }

        $extension = strtolower((string) pathinfo($relativa, PATHINFO_EXTENSION));
        if ($extension === '' && basename($relativa) === '.htaccess') {
            return true;
        }

        return in_array($extension, self::EXTENSIONES, true);
    }

    /**
     * @param  array<string,string>  $archivos
     * @return int cuántos se escribieron
     */
    private function escribir(string $rutaZip, array $archivos, string $raiz): int
    {
        $zip = new ZipArchive;
        if ($zip->open($rutaZip) !== true) {
            throw new RuntimeException('El paquete descargado no se pudo abrir.');
        }

        $pausa = max(0, (int) Config::get('actualizaciones.pausa_ms', 40)) * 1000;
        $escritos = 0;

        try {
            foreach ($archivos as $entrada => $relativa) {
                $contenido = $zip->getFromName($entrada);
                if ($contenido === false) {
                    continue;
                }

                $absoluta = $raiz.'/'.$relativa;
                $carpeta = dirname($absoluta);

                if (! is_dir($carpeta) && ! mkdir($carpeta, 0755, true) && ! is_dir($carpeta)) {
                    throw new RuntimeException('No se pudo crear el directorio '.$relativa);
                }

                if (file_put_contents($absoluta, $contenido) === false) {
                    throw new RuntimeException('No se pudo escribir '.$relativa);
                }

                $escritos++;

                // Una pausa mínima entre archivos reparte el trabajo en el
                // tiempo. En hosting compartido, escribir cientos de archivos de
                // golpe dispara los límites de CPU y el proceso muere a mitad.
                if ($pausa > 0) {
                    usleep($pausa);
                }
            }
        } finally {
            $zip->close();
        }

        return $escritos;
    }

    // ── Respaldo y restauración ──────────────────────────────────────────────

    private function respaldar(string $destino, string $raiz, string $sha): string
    {
        $base = rtrim((string) Config::get('actualizaciones.respaldos', ''), '/');
        if ($base === '') {
            throw new RuntimeException('Falta configurar "actualizaciones.respaldos" en config.php.');
        }

        $carpeta = sprintf('%s/%s-%s-%s', $base, strtolower($destino), date('Ymd-His'), substr($sha, 0, 7));

        if (! is_dir($carpeta) && ! mkdir($carpeta, 0750, true) && ! is_dir($carpeta)) {
            throw new RuntimeException('No se pudo crear la carpeta de respaldo.');
        }

        $this->copiarArbol($raiz, $carpeta);

        return $carpeta;
    }

    /**
     * Devuelve si los archivos volvieron a su sitio, que es lo único de lo que
     * esta función responde. Si el sitio sigue caído después, eso se comprueba y
     * se informa aparte: la restauración pudo ser correcta y la caída deberse a
     * otra cosa (la base, una URL de salud mal puesta, el hosting).
     */
    private function restaurar(string $respaldo, string $raiz): bool
    {
        try {
            $this->copiarArbol($respaldo, $raiz);

            return true;
        } catch (Throwable) {
            return false;
        }
    }

    /** Copia recursiva, saltándose siempre lo protegido. */
    private function copiarArbol(string $origen, string $destino): void
    {
        $items = @scandir($origen) ?: [];

        foreach ($items as $item) {
            if ($item === '.' || $item === '..' || in_array($item, self::PROTEGIDAS, true)) {
                continue;
            }

            $rutaOrigen = $origen.'/'.$item;
            $rutaDestino = $destino.'/'.$item;

            if (is_dir($rutaOrigen)) {
                if (! is_dir($rutaDestino) && ! mkdir($rutaDestino, 0755, true) && ! is_dir($rutaDestino)) {
                    throw new RuntimeException('No se pudo crear '.$rutaDestino);
                }
                $this->copiarArbol($rutaOrigen, $rutaDestino);

                continue;
            }

            if (! @copy($rutaOrigen, $rutaDestino)) {
                throw new RuntimeException('No se pudo copiar '.$item);
            }
        }
    }

    // ── Verificación ─────────────────────────────────────────────────────────

    /**
     * ¿El sitio sigue en pie tras escribir?
     *
     * Sin URL configurada no se puede comprobar, y en ese caso se da por bueno:
     * bloquear un despliegue por una verificación que no se puede hacer dejaría
     * el sistema sin forma de actualizarse.
     */
    private function sitioResponde(string $destino): bool
    {
        $url = (string) Config::get(
            $destino === 'BACKEND' ? 'actualizaciones.url_salud' : 'actualizaciones.url_frontend',
            ''
        );

        if ($url === '') {
            return true;
        }

        // Un momento de margen: Apache y OPcache necesitan ver los archivos
        // nuevos antes de que la comprobación signifique algo.
        sleep(2);

        $cuerpo = $this->pedir($url, 15, false);

        return $cuerpo !== null && $cuerpo !== '';
    }

    // ── GitHub ───────────────────────────────────────────────────────────────

    /** @return array<string,mixed>|null */
    private function ultimoCommit(): ?array
    {
        $repo = $this->repositorio();
        $url = sprintf(
            'https://api.github.com/repos/%s/%s/commits/%s',
            $repo['owner'],
            $repo['repo'],
            rawurlencode($repo['rama'])
        );

        $cuerpo = $this->pedir($url, 20);
        if ($cuerpo === null) {
            return null;
        }

        $datos = json_decode($cuerpo, true);
        if (! is_array($datos) || ! isset($datos['sha'])) {
            return null;
        }

        $mensaje = (string) ($datos['commit']['message'] ?? '');

        return [
            'sha' => (string) $datos['sha'],
            'corto' => substr((string) $datos['sha'], 0, 7),
            'mensaje' => trim(explode("\n", $mensaje)[0]),
            'autor' => (string) ($datos['commit']['author']['name'] ?? ''),
            'fecha' => (string) ($datos['commit']['author']['date'] ?? ''),
        ];
    }

    /**
     * Petición HTTP a GitHub.
     *
     * No reutiliza Github::pedir() porque aquel es privado, guarda todo en
     * memoria y corta a los 20 segundos: sirve para leer JSON pequeño, no para
     * bajar un paquete de varios megabytes. Refactorizar el servicio que hoy
     * alimenta "Acerca de" para compartir diez líneas no compensa el riesgo de
     * tocar algo que ya funciona en producción.
     */
    private function pedir(string $url, int $segundos, bool $conToken = true): ?string
    {
        $cabeceras = [
            'Accept: application/vnd.github+json',
            // GitHub rechaza con 403 cualquier petición sin User-Agent.
            'User-Agent: SGR-Jamundi',
            'X-GitHub-Api-Version: 2022-11-28',
        ];

        $token = (string) Config::get('github.token', '');
        if ($conToken && $token !== '') {
            $cabeceras[] = 'Authorization: Bearer '.$token;
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $cabeceras,
                CURLOPT_TIMEOUT => $segundos,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $cuerpo = curl_exec($ch);
            $estado = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

            return is_string($cuerpo) && $estado >= 200 && $estado < 300 ? $cuerpo : null;
        }

        $contexto = stream_context_create([
            'http' => ['header' => implode("\r\n", $cabeceras), 'timeout' => $segundos],
        ]);

        $cuerpo = @file_get_contents($url, false, $contexto);

        return is_string($cuerpo) ? $cuerpo : null;
    }

    // ── Estado interno ───────────────────────────────────────────────────────

    private function versionDesplegada(string $destino): ?string
    {
        $fila = Db::first(
            "SELECT commit_sha FROM despliegues
              WHERE destino = :d AND estado = 'EXITOSO'
              ORDER BY id DESC LIMIT 1",
            ['d' => $destino]
        );

        return $fila === null ? null : (string) $fila['commit_sha'];
    }

    /**
     * @param  array<string,mixed>  $remoto
     * @param  array<string,mixed>  $actor
     * @param  array<string,mixed>  $extra
     * @return array<string,mixed>
     */
    private function registrar(string $destino, array $remoto, string $estado, array $actor, array $extra = []): array
    {
        Db::exec(
            'INSERT INTO despliegues
                (destino, commit_sha, commit_mensaje, commit_autor, rama, estado, archivos,
                 respaldo_ruta, version_anterior, migraciones, detalle, usuario_id, usuario_email, duracion_ms)
             VALUES (:d, :sha, :msj, :aut, :rama, :est, :arc, :resp, :ant, :mig, :det, :uid, :uem, :dur)',
            [
                'd' => $destino,
                'sha' => $remoto['sha'],
                'msj' => mb_substr((string) $remoto['mensaje'], 0, 300),
                'aut' => mb_substr((string) $remoto['autor'], 0, 180),
                'rama' => $this->repositorio()['rama'],
                'est' => $estado,
                'arc' => $extra['archivos'] ?? 0,
                'resp' => $extra['respaldo_ruta'] ?? null,
                'ant' => $extra['version_anterior'] ?? null,
                'mig' => ($extra['migraciones'] ?? false) ? 1 : 0,
                'det' => $extra['detalle'] ?? null,
                'uid' => $actor['id'] ?? null,
                'uem' => $actor['email'] ?? null,
                'dur' => $extra['duracion_ms'] ?? null,
            ]
        );

        return [
            'destino' => $destino,
            'estado' => $estado,
            'archivos' => (int) ($extra['archivos'] ?? 0),
            'detalle' => $extra['detalle'] ?? null,
        ];
    }

    // ── Configuración ────────────────────────────────────────────────────────

    /** @return array{owner:string,repo:string,rama:string} */
    private function repositorio(): array
    {
        return [
            'owner' => (string) Config::get('actualizaciones.owner', ''),
            'repo' => (string) Config::get('actualizaciones.repo', ''),
            'rama' => (string) Config::get('actualizaciones.rama', 'main'),
        ];
    }

    private function raiz(string $destino): string
    {
        $clave = $destino === 'BACKEND' ? 'actualizaciones.raiz_api' : 'actualizaciones.raiz_frontend';

        return rtrim((string) Config::get($clave, ''), '/');
    }

    public function habilitado(): bool
    {
        return $this->motivoDeshabilitado() === null;
    }

    /** El motivo concreto por el que no se puede actualizar, o null si sí se puede. */
    public function motivoDeshabilitado(): ?string
    {
        if ((bool) Config::get('actualizaciones.habilitado', false) !== true) {
            return 'La actualización desde GitHub está deshabilitada en config.php.';
        }

        $repo = $this->repositorio();
        if ($repo['owner'] === '' || $repo['repo'] === '') {
            return 'Falta indicar el repositorio en config.php.';
        }

        if (! class_exists(ZipArchive::class)) {
            return 'El servidor no tiene la extensión ZipArchive de PHP.';
        }

        if ((string) Config::get('actualizaciones.respaldos', '') === '') {
            return 'Falta configurar la carpeta de respaldos en config.php.';
        }

        return null;
    }

    private function exigirHabilitado(): void
    {
        $motivo = $this->motivoDeshabilitado();

        if ($motivo !== null) {
            throw new HttpError($motivo, 409);
        }
    }
}
