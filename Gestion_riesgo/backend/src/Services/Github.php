<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\Db;
use Throwable;

/**
 * Lectura del historial del sistema en GitHub.
 *
 * El sistema no vive en un único sitio: el tablero del RUFE se desarrolla en la
 * rama principal del repositorio y la plataforma que lo envuelve en otra rama.
 * Por eso se leen varias FUENTES (repositorio + rama) y se funden en una sola
 * línea de tiempo ordenada por fecha; con una sola rama, media historia del
 * sistema quedaría invisible.
 *
 * El token se usa solo desde el servidor y nunca se envía al navegador: si
 * viajara al frontend, cualquiera con las herramientas de desarrollo podría
 * leerlo y usarlo con los permisos de la cuenta.
 */
final class Github
{
    private const CACHE_CLAVE = 'github_commits_cache_v2';
    private const CACHE_SEGUNDOS = 300;

    /** @return array<int,array{owner:string,repo:string,branch:string,etiqueta:string}> */
    public function fuentes(): array
    {
        $fuentes = Config::get('github.fuentes');

        // Compatibilidad con la configuración antigua de un solo repositorio.
        if (! is_array($fuentes) || $fuentes === []) {
            $owner = (string) Config::get('github.owner', '');
            $repo = (string) Config::get('github.repo', '');
            if ($owner === '' || $repo === '') {
                return [];
            }

            return [[
                'owner' => $owner,
                'repo' => $repo,
                'branch' => (string) Config::get('github.branch', 'main'),
                'etiqueta' => $repo,
            ]];
        }

        $salida = [];
        foreach ($fuentes as $f) {
            if (! is_array($f) || ($f['owner'] ?? '') === '' || ($f['repo'] ?? '') === '') {
                continue;
            }
            $salida[] = [
                'owner' => (string) $f['owner'],
                'repo' => (string) $f['repo'],
                'branch' => (string) ($f['branch'] ?? 'main'),
                'etiqueta' => (string) ($f['etiqueta'] ?? $f['repo']),
            ];
        }

        return $salida;
    }

    public function configurado(): bool
    {
        return $this->fuentes() !== [];
    }

    /** Repositorio principal, para el enlace de la cabecera. */
    public function repositorio(): array
    {
        $fuentes = $this->fuentes();
        if ($fuentes === []) {
            return ['owner' => '', 'repo' => '', 'branch' => '', 'url' => ''];
        }

        $p = $fuentes[0];

        return [
            'owner' => $p['owner'],
            'repo' => $p['repo'],
            'branch' => $p['branch'],
            'url' => "https://github.com/{$p['owner']}/{$p['repo']}",
        ];
    }

    /** @return array<int,array{etiqueta:string,branch:string,url:string}> */
    public function fuentesPublicas(): array
    {
        return array_map(static fn (array $f): array => [
            'etiqueta' => $f['etiqueta'],
            'branch' => $f['branch'],
            'url' => "https://github.com/{$f['owner']}/{$f['repo']}/tree/{$f['branch']}",
        ], $this->fuentes());
    }

    /**
     * Commits recientes de todas las fuentes, fundidos y ordenados de más
     * reciente a más antiguo.
     *
     * Devuelve ['commits' => [...], 'error' => ?string, 'desde_cache' => bool].
     * Un fallo de red nunca lanza: la pestaña debe seguir mostrando la
     * información del sistema aunque GitHub no responda.
     */
    public function commits(int $limite = 50, bool $forzar = false): array
    {
        if (! $this->configurado()) {
            return ['commits' => [], 'error' => 'El repositorio de GitHub no está configurado.', 'desde_cache' => false];
        }

        if (! $forzar) {
            $cache = $this->leerCache();
            if ($cache !== null) {
                return ['commits' => $cache, 'error' => null, 'desde_cache' => true];
            }
        }

        $todos = [];
        $errores = [];

        foreach ($this->fuentes() as $fuente) {
            $url = sprintf(
                'https://api.github.com/repos/%s/%s/commits?sha=%s&per_page=%d',
                rawurlencode($fuente['owner']),
                rawurlencode($fuente['repo']),
                rawurlencode($fuente['branch']),
                max(1, min(100, $limite))
            );

            try {
                $items = json_decode($this->pedir($url), true);
            } catch (Throwable $e) {
                $errores[] = "{$fuente['etiqueta']}: {$e->getMessage()}";

                continue;
            }

            if (! is_array($items)) {
                $errores[] = "{$fuente['etiqueta']}: respuesta inesperada de GitHub.";

                continue;
            }

            foreach ($items as $item) {
                if (is_array($item)) {
                    $todos[] = $this->normalizar($item, $fuente['etiqueta']);
                }
            }
        }

        // Si TODAS las fuentes fallaron se sirve la caché vencida si existe:
        // información desactualizada es mucho más útil que una pantalla vacía.
        if ($todos === []) {
            $cache = $this->leerCache(true);

            return [
                'commits' => $cache ?? [],
                'error' => $errores === [] ? null : implode(' · ', $errores),
                'desde_cache' => $cache !== null,
            ];
        }

        // Un mismo commit puede aparecer en dos ramas (por ejemplo, si una
        // parte de la otra): se conserva una sola vez.
        $unicos = [];
        foreach ($todos as $c) {
            $unicos[$c['sha']] ??= $c;
        }
        $commits = array_values($unicos);

        usort($commits, static fn (array $a, array $b): int => strtotime($b['fecha']) <=> strtotime($a['fecha']));

        $this->guardarCache($commits);

        return [
            'commits' => $commits,
            'error' => $errores === [] ? null : implode(' · ', $errores),
            'desde_cache' => false,
        ];
    }

    private function normalizar(array $item, string $fuente): array
    {
        $sha = (string) ($item['sha'] ?? '');
        $mensaje = (string) ($item['commit']['message'] ?? '');
        $lineas = preg_split('/\r?\n/', $mensaje) ?: [''];

        // Los "trailers" de git (Co-Authored-By, Signed-off-by, Reviewed-by…)
        // son metadato para las herramientas, no texto para quien lee el
        // historial en pantalla.
        $cuerpo = array_filter(
            array_slice($lineas, 1),
            static fn (string $l): bool => preg_match('/^[A-Za-z-]+-(by|By):\s/', trim($l)) !== 1
        );

        return [
            'sha' => $sha,
            'sha_corto' => substr($sha, 0, 7),
            'titulo' => trim($lineas[0]),
            'descripcion' => trim(implode("\n", $cuerpo)),
            'autor_nombre' => (string) ($item['commit']['author']['name'] ?? 'Desconocido'),
            'autor_login' => $item['author']['login'] ?? null,
            'autor_avatar' => $item['author']['avatar_url'] ?? null,
            'fecha' => (string) ($item['commit']['author']['date'] ?? ''),
            'url' => (string) ($item['html_url'] ?? ''),
            'fuente' => $fuente,
        ];
    }

    /** @throws \RuntimeException */
    private function pedir(string $url): string
    {
        $token = (string) Config::get('github.token', '');
        $cabeceras = [
            'Accept: application/vnd.github+json',
            // GitHub rechaza con 403 cualquier petición sin User-Agent.
            'User-Agent: SGR-Jamundi',
            'X-GitHub-Api-Version: 2022-11-28',
        ];
        if ($token !== '') {
            $cabeceras[] = 'Authorization: Bearer '.$token;
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $cabeceras,
                CURLOPT_TIMEOUT => 20,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $cuerpo = curl_exec($ch);
            $estado = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $errorCurl = curl_error($ch);
            // curl_close() no se llama: desde PHP 8.0 no hace nada y en 8.5 avisa
            // como obsoleta. El manejador se libera solo al salir de ámbito.

            if ($cuerpo === false) {
                throw new \RuntimeException('no se pudo contactar a GitHub ('.$errorCurl.')');
            }
            if ($estado >= 400) {
                throw new \RuntimeException("GitHub respondió {$estado}");
            }

            return (string) $cuerpo;
        }

        $contexto = stream_context_create([
            'http' => ['method' => 'GET', 'header' => implode("\r\n", $cabeceras), 'timeout' => 20],
        ]);
        $cuerpo = @file_get_contents($url, false, $contexto);
        if ($cuerpo === false) {
            throw new \RuntimeException('no se pudo contactar a GitHub');
        }

        return $cuerpo;
    }

    private function leerCache(bool $ignorarVencimiento = false): ?array
    {
        try {
            $fila = Db::first('SELECT valor, actualizado_en FROM ajustes WHERE clave = :c', ['c' => self::CACHE_CLAVE]);
        } catch (Throwable) {
            return null;
        }

        if ($fila === null) {
            return null;
        }

        if (! $ignorarVencimiento) {
            $edad = time() - strtotime((string) $fila['actualizado_en']);
            if ($edad > self::CACHE_SEGUNDOS) {
                return null;
            }
        }

        $datos = json_decode((string) $fila['valor'], true);

        return is_array($datos) ? $datos : null;
    }

    private function guardarCache(array $commits): void
    {
        try {
            Db::exec(
                'INSERT INTO ajustes (clave, valor) VALUES (:c, :v)
                 ON DUPLICATE KEY UPDATE valor = VALUES(valor), actualizado_en = NOW()',
                ['c' => self::CACHE_CLAVE, 'v' => json_encode($commits, JSON_UNESCAPED_UNICODE)]
            );
        } catch (Throwable) {
            // Sin caché el módulo sigue funcionando, solo pega más a GitHub.
        }
    }
}
