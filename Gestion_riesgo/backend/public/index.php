<?php

declare(strict_types=1);

/**
 * Punto de entrada único de la API.
 *
 * Sin Composer a propósito: el hosting no tiene acceso por consola, así que no
 * se puede ejecutar `composer install` en el servidor. Un autoloader PSR-4 de
 * diez líneas cubre exactamente la misma necesidad y el despliegue se reduce a
 * copiar archivos.
 */

use App\Controllers\AcercaController;
use App\Controllers\AuthController;
use App\Controllers\CategoriasVideoController;
use App\Controllers\InspeccionCapturaController;
use App\Controllers\InspeccionController;
use App\Controllers\MapaController;
use App\Controllers\PreinscripcionController;
use App\Controllers\RufeController;
use App\Controllers\SistemaController;
use App\Controllers\RufeCapturaController;
use App\Controllers\UsuariosController;
use App\Core\Auth;
use App\Core\Config;
use App\Core\HttpError;
use App\Core\Request;
use App\Core\Response;
use App\Core\Router;

/*
 * Raíz del backend. Admite dos disposiciones:
 *   • Desarrollo: backend/{public/index.php, src/, config.php} → la raíz es el
 *     directorio padre de public/.
 *   • Producción: todo aplanado dentro de la carpeta pública en api/ → la raíz
 *     es este mismo directorio.
 * Se aplana en producción porque el hosting solo tiene una carpeta para el
 * sitio y no se puede colocar código por encima del document root; src/,
 * database/ y config.php quedan protegidos por .htaccess (ver esos archivos).
 */
$raiz = is_dir(__DIR__.'/src') ? __DIR__ : dirname(__DIR__);

spl_autoload_register(static function (string $clase) use ($raiz): void {
    $prefijo = 'App\\';
    if (! str_starts_with($clase, $prefijo)) {
        return;
    }

    $relativa = str_replace('\\', '/', substr($clase, strlen($prefijo)));
    $archivo = $raiz.'/src/'.$relativa.'.php';

    if (is_file($archivo)) {
        require $archivo;
    }
});

try {
    Config::cargar($raiz.'/config.php');
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
}

date_default_timezone_set((string) Config::get('app.zona', 'America/Bogota'));

// En producción los errores se registran, nunca se imprimen: un aviso de PHP
// impreso antes del JSON rompe la respuesta y puede filtrar rutas del servidor.
$produccion = Config::esProduccion();
ini_set('display_errors', $produccion ? '0' : '1');
error_reporting(E_ALL);

Response::cors();

// El preflight se responde antes de tocar la base de datos: es una petición
// automática del navegador, sin cuerpo ni sesión.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

$router = new Router;

$auth = new AuthController;
$usuarios = new UsuariosController;
$acerca = new AcercaController;
$rufeCaptura = new RufeCapturaController;
$rufe = new RufeController;
$sistema = new SistemaController;
$mapa = new MapaController;
$inspeccionCaptura = new InspeccionCapturaController;
$inspeccion = new InspeccionController;
$preinscripcion = new PreinscripcionController;
$categoriasVideo = new CategoriasVideoController;

// ── Públicas ─────────────────────────────────────────────────────────────
$router->get('/health', static function (): void {
    Response::ok(['estado' => 'ok', 'hora' => date('c')]);
});

$router->post('/auth/login', [$auth, 'login']);

// El sistema no expone ninguna otra ruta sin token. El formulario RUFE se
// diligencia en campo por un funcionario, no por el ciudadano, así que su
// captura vive con el resto de rutas de escritura.

// Pre-inscripción ciudadana. Las DOS únicas rutas sin sesión aparte del login.
//
// Ampliar esta lista es la decisión más delicada de este archivo: abre una
// superficie que cualquiera en internet puede tocar. Van con límite por IP,
// trampa antirrobot e idempotencia por envio_id, y NO existe ninguna ruta
// pública que devuelva pre-inscripciones: consultar por radicado sería un
// buscador de damnificados para quien probara combinaciones.
$router->get('/preinscripcion/catalogos', [$preinscripcion, 'catalogos']);
$router->post('/preinscripcion/cargas', [$preinscripcion, 'abrirCarga']);
$router->post('/preinscripcion/cargas/{carga}/archivos', [$preinscripcion, 'subirArchivo']);
$router->delete('/preinscripcion/cargas/{carga}/archivos/{id}', [$preinscripcion, 'eliminarArchivo']);
$router->post('/preinscripcion/cargas/{carga}/videos', [$preinscripcion, 'iniciarVideo']);
$router->post('/preinscripcion/cargas/{carga}/videos/{id}/trozos', [$preinscripcion, 'subirTrozo']);
$router->post('/preinscripcion', [$preinscripcion, 'crear']);

// ── Autenticadas (cualquier rol) ─────────────────────────────────────────
$router->get('/auth/me', [$auth, 'me'], Auth::TODOS);
$router->post('/auth/logout', [$auth, 'logout'], Auth::TODOS);
$router->post('/auth/password', [$auth, 'cambiarPassword'], Auth::TODOS);

$router->get('/acerca/sistema', [$acerca, 'sistema'], Auth::TODOS);
$router->get('/acerca/actualizaciones', [$acerca, 'actualizaciones'], Auth::TODOS);

// Bandeja RUFE: consultar es de casi todos los roles, decidir no.
//
// `LECTURA_RUFE` y no `TODOS`: son fichas con nombres, cédulas y direcciones de
// hogares damnificados, y el profesional que inspecciona viviendas no las
// necesita para su trabajo.
$router->get('/rufe/reportes', [$rufe, 'listar'], Auth::LECTURA_RUFE);
$router->get('/rufe/reportes/{id}', [$rufe, 'ver'], Auth::LECTURA_RUFE);
$router->get('/rufe/reportes/{id}/evidencias/{evidencia}', [$rufe, 'descargarEvidencia'], Auth::LECTURA_RUFE);

$capturaArchivos = array_values(array_unique(array_merge(Auth::ESCRITURA, Auth::INSPECCION)));

// ── Gestión de datos (ADMINISTRADOR y GESTOR) ────────────────────────────
// Captura del formulario RUFE en campo.
$router->get('/rufe/catalogos', [$rufeCaptura, 'catalogos'], Auth::ESCRITURA);
// Las cargas de archivos las comparten los dos formatos: por aquí suben tanto
// las evidencias del censo como el registro fotográfico del numeral 11. Sin el
// inspector en esta lista, levantaría la inspección y perdería todas sus fotos.
$router->post('/rufe/cargas', [$rufeCaptura, 'abrirCarga'], $capturaArchivos);
$router->get('/rufe/cargas/{carga}/archivos', [$rufeCaptura, 'listarArchivos'], $capturaArchivos);
$router->post('/rufe/cargas/{carga}/archivos', [$rufeCaptura, 'subirArchivo'], $capturaArchivos);
$router->put('/rufe/cargas/{carga}/archivos/{id}', [$rufeCaptura, 'describirArchivo'], $capturaArchivos);
$router->delete('/rufe/cargas/{carga}/archivos/{id}', [$rufeCaptura, 'eliminarArchivo'], $capturaArchivos);
$router->post('/rufe/reportes', [$rufeCaptura, 'crear'], Auth::ESCRITURA);

$router->put('/rufe/reportes/{id}', [$rufe, 'actualizar'], Auth::ESCRITURA);
$router->put('/rufe/reportes/{id}/estado', [$rufe, 'cambiarEstado'], Auth::ESCRITURA);
$router->get('/rufe/borradores', [$rufe, 'listarBorradores'], Auth::ESCRITURA);
$router->post('/rufe/borradores', [$rufe, 'guardarBorrador'], Auth::ESCRITURA);
$router->get('/rufe/borradores/{clave}', [$rufe, 'verBorrador'], Auth::ESCRITURA);
$router->delete('/rufe/borradores/{clave}', [$rufe, 'eliminarBorrador'], Auth::ESCRITURA);

// ── Solo ADMINISTRADOR ───────────────────────────────────────────────────
$soloAdmin = [Auth::ADMINISTRADOR];
$router->post('/rufe/reportes/{id}/anonimizar', [$rufe, 'anonimizar'], $soloAdmin);

// Actualización del sistema: reescribe el código del sitio y corre migraciones.
// Es la ruta de mayor privilegio que existe aquí.
// Ubicaciones del mapa. Consultarlas es de lectura y lo hace cualquier usuario
// con sesión; geocodificar gasta cupo de un servicio externo y lo lanza un
// administrador desde su pantalla, por lotes, porque este hosting no tiene cron.
$router->get('/mapa/fichas', [$mapa, 'fichas'], Auth::LECTURA_RUFE);
$router->post('/mapa/ubicaciones', [$mapa, 'ubicaciones'], Auth::LECTURA_RUFE);
$router->put('/mapa/ubicaciones/{clave}', [$mapa, 'corregir'], Auth::ESCRITURA);
$router->get('/mapa/estado', [$mapa, 'estado'], $soloAdmin);
$router->post('/mapa/geocodificar', [$mapa, 'geocodificar'], $soloAdmin);
$router->post('/mapa/reubicar', [$mapa, 'reubicar'], $soloAdmin);

// Inspección de viviendas afectadas (formato NGRD). El censo dice quién quedó
// afectado; esto evalúa la vivienda y determina qué materiales le corresponden.
// Capturar es de escritura; consultar lo hace cualquiera con sesión, igual que
// en el RUFE.
$router->get('/inspeccion/catalogos', [$inspeccionCaptura, 'catalogos'], Auth::INSPECCION);
$router->get('/inspeccion/duplicados', [$inspeccionCaptura, 'duplicados'], Auth::INSPECCION);
$router->post('/inspeccion/fichas', [$inspeccionCaptura, 'crear'], Auth::INSPECCION);
// Consultarlas sigue siendo de cualquier rol con sesión, incluido Visualización:
// son las fichas que sustentan una entrega de recursos públicos y quitarle la
// consulta al rol que existe para supervisar sería justo lo contrario de lo que
// se busca.
$router->get('/inspeccion/fichas', [$inspeccion, 'listar'], Auth::TODOS);
$router->get('/inspeccion/fichas/{id}', [$inspeccion, 'ver'], Auth::TODOS);
$router->get('/inspeccion/fichas/{id}/fotos/{foto}', [$inspeccion, 'descargarFoto'], Auth::TODOS);
// Decidir NO: quien inspecciona no puede aprobar su propio trabajo. Es la misma
// razón por la que la aprobación salió del formulario.
$router->put('/inspeccion/fichas/{id}/estado', [$inspeccion, 'cambiarEstado'], Auth::ESCRITURA);

// Bandeja de pre-inscripciones. Consultarlas es de lectura del censo —son
// solicitudes de ciudadanos con nombre, cédula y dirección—; decidir sobre
// ellas, de escritura.
$router->get('/preinscripcion/fichas', [$preinscripcion, 'listar'], Auth::LECTURA_RUFE);
$router->get('/preinscripcion/fichas/{id}', [$preinscripcion, 'ver'], Auth::LECTURA_RUFE);
$router->get('/preinscripcion/fichas/{id}/fotos/{foto}', [$preinscripcion, 'descargarFoto'], Auth::LECTURA_RUFE);
$router->get('/preinscripcion/fichas/{id}/videos/{video}', [$preinscripcion, 'descargarVideo'], Auth::LECTURA_RUFE);
$router->put('/preinscripcion/fichas/{id}/estado', [$preinscripcion, 'cambiarEstado'], Auth::ESCRITURA);
// Borrar la solicitud de un ciudadano es irreversible y destruye sus fotos y su
// video. Solo Administrador: el Gestor puede decidirla y descartarla, que es lo
// que necesita para trabajar, pero no hacerla desaparecer.
$router->delete('/preinscripcion/fichas/{id}', [$preinscripcion, 'eliminar'], $soloAdmin);

// Catálogo de categorías de video, que gestiona el administrador. Qué hay que
// grabar de una vivienda cambia entre una emergencia y la siguiente; esperar a
// un despliegue para ajustarlo sería llegar tarde siempre.
$router->get('/admin/categorias-video', [$categoriasVideo, 'listar'], $soloAdmin);
$router->post('/admin/categorias-video', [$categoriasVideo, 'crear'], $soloAdmin);
$router->put('/admin/categorias-video/orden', [$categoriasVideo, 'reordenar'], $soloAdmin);
$router->put('/admin/categorias-video/{id}', [$categoriasVideo, 'actualizar'], $soloAdmin);
$router->put('/admin/categorias-video/{id}/estado', [$categoriasVideo, 'cambiarEstado'], $soloAdmin);
$router->delete('/admin/categorias-video/{id}', [$categoriasVideo, 'eliminar'], $soloAdmin);

$router->get('/sistema/actualizaciones', [$sistema, 'estado'], $soloAdmin);
$router->post('/sistema/actualizar', [$sistema, 'actualizar'], $soloAdmin);
$router->get('/usuarios', [$usuarios, 'listar'], $soloAdmin);
$router->post('/usuarios', [$usuarios, 'crear'], $soloAdmin);
$router->get('/usuarios/{id}', [$usuarios, 'ver'], $soloAdmin);
$router->put('/usuarios/{id}', [$usuarios, 'actualizar'], $soloAdmin);
$router->delete('/usuarios/{id}', [$usuarios, 'eliminar'], $soloAdmin);
$router->post('/usuarios/{id}/password', [$usuarios, 'restablecerPassword'], $soloAdmin);

try {
    $router->despachar(Request::desdeGlobales());
} catch (HttpError $e) {
    Response::error($e->getMessage(), $e->estado(), $e->errores());
} catch (Throwable $e) {
    error_log('[SGR] '.$e->getMessage().' en '.$e->getFile().':'.$e->getLine());

    // El detalle del error solo se devuelve fuera de producción: en el servidor
    // real puede contener credenciales o la estructura interna del sistema.
    Response::error(
        $produccion ? 'Ocurrió un error en el servidor.' : $e->getMessage(),
        500
    );
}
