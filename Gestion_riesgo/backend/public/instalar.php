<?php

declare(strict_types=1);

/**
 * Instalador por web: crea las tablas y el primer administrador.
 *
 * Existe porque el hosting no da acceso por consola y no hay forma de correr
 * migraciones a mano. Se protege con `install_key` de config.php y se niega a
 * hacer nada si esa clave está vacía, así que dejarla en blanco tras instalar
 * inutiliza este archivo.
 *
 * Uso:
 *   POST /instalar.php?clave=LA_CLAVE
 *   { "nombre": "...", "email": "...", "password": "..." }
 */

use App\Core\Config;
use App\Core\Db;
use App\Core\Migrador;

$raiz = dirname(__DIR__);

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
    salir(403, ['ok' => false, 'message' => 'El instalador está deshabilitado.']);
}

// Comparación en tiempo constante: con `!==` el tiempo de respuesta varía según
// cuántos caracteres coinciden, lo que permite adivinar la clave carácter a
// carácter.
if (! hash_equals($claveEsperada, $claveRecibida)) {
    salir(403, ['ok' => false, 'message' => 'Clave de instalación incorrecta.']);
}

try {
    // 1. Esquema. La lista de archivos y el troceo viven en Migrador, que es lo
    //    mismo que usa migrar.php: así una instalación nueva y una ya existente
    //    no pueden acabar con esquemas distintos.
    Migrador::aplicar($raiz.'/database');

    $tablas = Migrador::tablas();

    // 2. Primer administrador. Solo si aún no hay ninguno: este archivo no debe
    //    poder usarse para inyectar un administrador en un sistema ya en uso.
    $existentes = (int) (Db::first('SELECT COUNT(*) AS t FROM usuarios')['t'] ?? 0);
    $creado = null;

    if ($existentes === 0) {
        $datos = json_decode(file_get_contents('php://input') ?: '[]', true);
        $datos = is_array($datos) ? $datos : [];

        $nombre = trim((string) ($datos['nombre'] ?? ''));
        $email = strtolower(trim((string) ($datos['email'] ?? '')));
        $password = (string) ($datos['password'] ?? '');

        if ($nombre === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($password) < 10) {
            salir(422, [
                'ok' => false,
                'message' => 'Envía nombre, email válido y password de al menos 10 caracteres para crear el primer administrador.',
                'tablas' => $tablas,
            ]);
        }

        Db::exec(
            'INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
             VALUES (:n, :e, :h, :r, 1)',
            [
                'n' => $nombre,
                'e' => $email,
                'h' => password_hash($password, PASSWORD_BCRYPT),
                'r' => 'ADMINISTRADOR',
            ]
        );

        $creado = ['id' => Db::lastId(), 'email' => $email, 'rol' => 'ADMINISTRADOR'];
    }

    salir(200, [
        'ok' => true,
        'message' => 'Instalación completada.',
        'tablas' => $tablas,
        'administrador_creado' => $creado,
        'usuarios_existentes' => $existentes,
        'siguiente_paso' => 'Vacía "install_key" en config.php para deshabilitar este instalador.',
    ]);
} catch (Throwable $e) {
    salir(500, ['ok' => false, 'message' => $e->getMessage()]);
}
