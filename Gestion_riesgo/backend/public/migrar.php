<?php

declare(strict_types=1);

/**
 * Aplica el esquema sobre una instalación que ya está en uso.
 *
 * instalar.php solo sirve la primera vez (crea el primer administrador y se
 * inutiliza después). Este archivo cubre el otro caso: agregar tablas nuevas a
 * un sistema en producción sin tocar los datos existentes. Todo lo que aplica es
 * idempotente, así que ejecutarlo dos veces no hace daño.
 *
 * Se protege con la misma `install_key` de config.php y se niega a hacer nada si
 * está vacía, de modo que vaciarla tras migrar deja este archivo inerte.
 *
 * Uso:
 *   POST /api/migrar.php?clave=LA_CLAVE
 *
 * Después de migrar: vacíe `install_key` y borre este archivo del servidor.
 */

use App\Core\Config;
use App\Core\Migrador;

$raiz = is_dir(__DIR__.'/src') ? __DIR__ : dirname(__DIR__);

spl_autoload_register(static function (string $clase) use ($raiz): void {
    if (! str_starts_with($clase, 'App\\')) {
        return;
    }
    $archivo = $raiz.'/src/'.str_replace('\\', '/', substr($clase, 4)).'.php';
    if (is_file($archivo)) {
        require $archivo;
    }
});

header('Content-Type: application/json; charset=utf-8');

function salir(int $estado, array $cuerpo): never
{
    http_response_code($estado);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

try {
    Config::cargar($raiz.'/config.php');
} catch (Throwable $e) {
    salir(500, ['ok' => false, 'message' => $e->getMessage()]);
}

date_default_timezone_set((string) Config::get('app.zona', 'America/Bogota'));

$claveEsperada = (string) Config::get('install_key', '');
$claveRecibida = (string) ($_GET['clave'] ?? '');

if ($claveEsperada === '') {
    salir(403, ['ok' => false, 'message' => 'El migrador está deshabilitado.']);
}

// En tiempo constante: con `!==` el tiempo de respuesta varía según cuántos
// caracteres coinciden, lo que permite adivinar la clave carácter a carácter.
if (! hash_equals($claveEsperada, $claveRecibida)) {
    salir(403, ['ok' => false, 'message' => 'Clave de instalación incorrecta.']);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    salir(405, ['ok' => false, 'message' => 'Use POST para ejecutar la migración.']);
}

try {
    $antes = Migrador::tablas();
    $aplicados = Migrador::aplicar($raiz.'/database');
    $despues = Migrador::tablas();

    // El almacén de evidencias se crea aquí para que el error salga ahora, con
    // un mensaje entendible, y no en el primer ciudadano que adjunte una foto.
    $almacen = (string) Config::get('almacenamiento.ruta', '');
    $almacenListo = false;
    if ($almacen !== '') {
        if (! is_dir($almacen)) {
            @mkdir($almacen, 0750, true);
        }
        $almacenListo = is_dir($almacen) && is_writable($almacen);
    }

    salir(200, [
        'ok' => true,
        'message' => 'Migración aplicada.',
        'archivos' => $aplicados,
        'tablas_nuevas' => array_values(array_diff($despues, $antes)),
        'tablas' => $despues,
        'almacenamiento' => [
            'ruta_configurada' => $almacen !== '',
            'listo' => $almacenListo,
        ],
        'siguiente_paso' => 'Vacíe "install_key" en config.php y borre migrar.php del servidor.',
    ]);
} catch (Throwable $e) {
    salir(500, ['ok' => false, 'message' => $e->getMessage()]);
}
