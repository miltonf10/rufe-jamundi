<?php

declare(strict_types=1);

namespace App\Core;

/** Petición HTTP entrante, ya normalizada. */
final class Request
{
    private array $cuerpo;

    /** @param array<string,string> $params comodines de la ruta */
    public function __construct(
        public readonly string $metodo,
        public readonly string $ruta,
        public array $params = []
    ) {
        $this->cuerpo = $this->leerCuerpo();
    }

    public static function desdeGlobales(): self
    {
        $metodo = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $ruta = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

        // Con la API en un subdirectorio, REQUEST_URI trae el prefijo del
        // directorio; se descuenta para que las rutas del router sean siempre
        // absolutas respecto a la raíz de la API.
        $base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'), '/');
        if ($base !== '' && str_starts_with($ruta, $base)) {
            $ruta = substr($ruta, strlen($base));
        }

        return new self($metodo, '/'.trim($ruta, '/'));
    }

    /**
     * El cuerpo llega como JSON. La única excepción es la subida de evidencias,
     * que por fuerza es multipart y se lee con archivo(); en ese caso php://input
     * viene vacío y este método devuelve [] sin más.
     */
    private function leerCuerpo(): array
    {
        if ($this->esMultipart()) {
            return [];
        }

        $crudo = file_get_contents('php://input');
        if ($crudo === false || $crudo === '') {
            return [];
        }

        $datos = json_decode($crudo, true);

        return is_array($datos) ? $datos : [];
    }

    public function esMultipart(): bool
    {
        $tipo = (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');

        return stripos($tipo, 'multipart/form-data') !== false;
    }

    /**
     * Campo de texto de un envío multipart.
     *
     * Existe aparte de texto() porque en multipart el cuerpo no es JSON y
     * php://input viene vacío: los campos llegan por $_POST.
     */
    public function campo(string $clave, string $porDefecto = ''): string
    {
        $v = $_POST[$clave] ?? $porDefecto;

        return is_scalar($v) ? trim((string) $v) : $porDefecto;
    }

    /**
     * Un archivo subido, ya comprobado como tal.
     *
     * is_uploaded_file() es la defensa contra que alguien pase por `tmp_name` una
     * ruta del servidor (/etc/passwd, config.php) para que el código la copie a
     * un sitio accesible.
     *
     * @return array{nombre:string,tmp:string,tamano:int,error:int}|null
     */
    public function archivo(string $campo): ?array
    {
        $f = $_FILES[$campo] ?? null;
        if (! is_array($f) || is_array($f['tmp_name'] ?? null)) {
            return null;
        }

        $error = (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE);
        $tmp = (string) ($f['tmp_name'] ?? '');

        if ($error === UPLOAD_ERR_OK && ! is_uploaded_file($tmp)) {
            return null;
        }

        return [
            'nombre' => (string) ($f['name'] ?? ''),
            'tmp' => $tmp,
            'tamano' => (int) ($f['size'] ?? 0),
            'error' => $error,
        ];
    }

    public function input(string $clave, mixed $porDefecto = null): mixed
    {
        return $this->cuerpo[$clave] ?? $porDefecto;
    }

    /**
     * El cuerpo completo, para validadores que necesitan verlo entero en vez de
     * campo por campo.
     *
     * @return array<string,mixed>
     */
    public function todo(): array
    {
        return $this->cuerpo;
    }

    public function texto(string $clave, string $porDefecto = ''): string
    {
        $v = $this->cuerpo[$clave] ?? $porDefecto;

        return is_scalar($v) ? trim((string) $v) : $porDefecto;
    }

    public function query(string $clave, ?string $porDefecto = null): ?string
    {
        $v = $_GET[$clave] ?? $porDefecto;

        return is_scalar($v) ? (string) $v : $porDefecto;
    }

    public function param(string $clave): string
    {
        return $this->params[$clave] ?? '';
    }

    /** Token Bearer, o null. */
    public function token(): ?string
    {
        $cabecera = $this->cabecera('Authorization');
        if ($cabecera === null) {
            return null;
        }

        if (preg_match('/^Bearer\s+(.+)$/i', trim($cabecera), $m) === 1) {
            return trim($m[1]);
        }

        return null;
    }

    public function cabecera(string $nombre): ?string
    {
        $clave = 'HTTP_'.str_replace('-', '_', strtoupper($nombre));
        if (isset($_SERVER[$clave])) {
            return (string) $_SERVER[$clave];
        }

        // Algunos Apache de hosting compartido no propagan Authorization a
        // $_SERVER; getallheaders() sí la ve.
        if (function_exists('getallheaders')) {
            foreach (getallheaders() as $k => $v) {
                if (strcasecmp($k, $nombre) === 0) {
                    return (string) $v;
                }
            }
        }

        return null;
    }

    public function ip(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }

    public function userAgent(): string
    {
        return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }
}
