<?php

declare(strict_types=1);

/**
 * Pruebas del backend, sin PHPUnit.
 *
 * No hay Composer en el hosting ni forma de instalarlo, así que las pruebas son
 * un archivo PHP que se ejecuta con `php backend/tests/run.php`. Solo cubren
 * código puro (validación, catálogos, radicado, troceo de SQL): nada aquí toca
 * la base de datos, para que se pueda ejecutar en cualquier máquina sin montar
 * nada.
 *
 * Lo que necesita una base viva —transacciones, tasa, subida de archivos— se
 * comprueba con tests/http.sh contra un servidor local.
 */

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

use App\Core\Auth;
use App\Core\Migrador;
use App\Sistema\Actualizador;
use App\Rufe\Busqueda;
use App\Rufe\Catalogos;
use App\Rufe\Geocodificador;
use App\Rufe\Radicado;
use App\Rufe\Validador;
use App\Inspeccion\BancoMateriales;
use App\Inspeccion\Catalogos as CatalogosInspeccion;
use App\Inspeccion\Validador as ValidadorInspeccion;
use App\Inspeccion\Numero;
use App\Inspeccion\NivelDano;

date_default_timezone_set('America/Bogota');

// ── Mini arnés ───────────────────────────────────────────────────────────────

$pasadas = 0;
$fallos = [];
$grupo = '';

function grupo(string $nombre): void
{
    global $grupo;
    $grupo = $nombre;
    echo "\n\033[1m{$nombre}\033[0m\n";
}

function prueba(string $nombre, callable $fn): void
{
    global $pasadas, $fallos, $grupo;

    try {
        $fn();
        $pasadas++;
        echo "  \033[32m✓\033[0m {$nombre}\n";
    } catch (Throwable $e) {
        $fallos[] = "{$grupo} › {$nombre}: ".$e->getMessage();
        echo "  \033[31m✗\033[0m {$nombre}\n      \033[31m".$e->getMessage()."\033[0m\n";
    }
}

function afirmar(bool $condicion, string $mensaje): void
{
    if (! $condicion) {
        throw new RuntimeException($mensaje);
    }
}

function afirmarIgual(mixed $esperado, mixed $real, string $mensaje = ''): void
{
    if ($esperado !== $real) {
        throw new RuntimeException(
            ($mensaje !== '' ? $mensaje.' — ' : '')
            .'esperado '.var_export($esperado, true).', recibido '.var_export($real, true)
        );
    }
}

/** @param array<string,mixed> $entrada */
function errores(array $entrada): array
{
    return Validador::reporte($entrada)['errores'];
}

/** @param array<string,mixed> $entrada */
function datos(array $entrada): array
{
    return Validador::reporte($entrada)['datos'];
}

function afirmarError(array $entrada, string $campo): void
{
    $e = errores($entrada);
    afirmar(
        isset($e[$campo]),
        "se esperaba un error en «{$campo}», se obtuvieron: ".(
            $e === [] ? '(ninguno)' : implode(', ', array_keys($e))
        )
    );
}

function afirmarSinError(array $entrada, string $campo): void
{
    $e = errores($entrada);
    afirmar(! isset($e[$campo]), "no se esperaba error en «{$campo}»: ".($e[$campo] ?? ''));
}

// ── Datos base ───────────────────────────────────────────────────────────────

/** Un reporte mínimo y válido. Cada prueba lo modifica en lo que le interesa. */
function base(array $cambios = []): array
{
    return array_replace([
        'evento' => 'Terremoto',
        'fecha_evento' => date('Y-m-d', strtotime('-3 days')),
        'zona' => 'URBANO',
        'vereda_sector_barrio' => 'Barrio Belalcázar',
        'direccion' => 'Calle 10 # 5-32',
        'alojamiento' => 'LUGAR_HABITUAL',
        'forma_tenencia' => 'PROPIETARIO',
        'estado_bien' => 'AVERIADO',
        'tipo_bien' => 'VIVIENDA',
        'personas' => [persona()],
        'tiene_afectacion_agro' => false,
        'contacto_telefono' => '3105551234',
        'autoriza_tratamiento' => true,
    ], $cambios);
}

function persona(array $cambios = []): array
{
    return array_replace([
        'nombres' => 'María José',
        'apellidos' => 'Riascos Mina',
        'tipo_documento' => 3,
        'numero_documento' => '31234567',
        'parentesco' => 1,
        'genero' => 2,
        'fecha_nacimiento' => '1985-04-11',
        'pertenencia_etnica' => 5,
        'telefono' => '3105551234',
    ], $cambios);
}

// ── Pruebas ──────────────────────────────────────────────────────────────────

grupo('Reporte válido');

prueba('un reporte completo no produce errores', function (): void {
    afirmarIgual([], errores(base()));
});

prueba('los campos fijos los pone el servidor, no el cliente', function (): void {
    $d = datos(base(['departamento' => 'Antioquia', 'municipio' => 'Medellín']));
    afirmarIgual(Catalogos::DEPARTAMENTO, $d['departamento']);
    afirmarIgual(Catalogos::MUNICIPIO, $d['municipio']);
});

prueba('la fecha RUFE es la de hoy y no la que envíe el cliente', function (): void {
    afirmarIgual(date('Y-m-d'), datos(base(['fecha_rufe' => '2001-01-01']))['fecha_rufe']);
});

prueba('el orden de las personas se renumera desde 1', function (): void {
    $d = datos(base(['personas' => [
        persona(['orden' => 77]),
        persona(['parentesco' => 3, 'numero_documento' => '1088', 'tipo_documento' => 2, 'telefono' => null]),
    ]]));
    afirmarIgual([1, 2], array_column($d['personas'], 'orden'));
});

grupo('Evento y fecha');

prueba('el evento es obligatorio', function (): void {
    afirmarError(base(['evento' => '']), 'evento');
});

prueba('un evento fuera del catálogo se rechaza', function (): void {
    afirmarError(base(['evento' => 'Invasión alienígena']), 'evento');
});

prueba('C1: "Otro" exige el texto libre', function (): void {
    afirmarError(base(['evento' => 'OTRO']), 'evento_otro');
});

prueba('C1: "Otro" guarda el texto libre como evento', function (): void {
    $d = datos(base(['evento' => 'OTRO', 'evento_otro' => 'Socavación de la vía']));
    afirmarIgual('Socavación de la vía', $d['evento']);
});

prueba('C1: el texto libre sobra si el evento salió de la lista', function (): void {
    afirmarError(base(['evento' => 'Terremoto', 'evento_otro' => 'algo']), 'evento_otro');
});

prueba('la fecha del evento no puede ser futura', function (): void {
    afirmarError(base(['fecha_evento' => date('Y-m-d', strtotime('+1 day'))]), 'fecha_evento');
});

prueba('la fecha del evento no puede ser de hace más de dos años', function (): void {
    afirmarError(base(['fecha_evento' => date('Y-m-d', strtotime('-3 years'))]), 'fecha_evento');
});

prueba('una fecha que no existe se rechaza', function (): void {
    afirmarError(base(['fecha_evento' => '2026-02-31']), 'fecha_evento');
});

prueba('una fecha con formato inválido se rechaza', function (): void {
    afirmarError(base(['fecha_evento' => '11/04/2026']), 'fecha_evento');
});

grupo('Ubicación');

prueba('C2: en zona rural el corregimiento es obligatorio', function (): void {
    afirmarError(base(['zona' => 'RURAL']), 'corregimiento');
});

prueba('C2: en zona rural con corregimiento no hay error', function (): void {
    afirmarIgual([], errores(base(['zona' => 'RURAL', 'corregimiento' => 'Potrerito'])));
});

prueba('C2: el corregimiento se rechaza en zona urbana', function (): void {
    afirmarError(base(['zona' => 'URBANO', 'corregimiento' => 'Potrerito']), 'corregimiento');
});

prueba('C2: en zona urbana el corregimiento queda nulo', function (): void {
    afirmarIgual(null, datos(base())['corregimiento']);
});

prueba('una zona inventada se rechaza', function (): void {
    afirmarError(base(['zona' => 'SUBURBANO']), 'zona');
});

prueba('la dirección exige al menos 5 caracteres', function (): void {
    afirmarError(base(['direccion' => 'C 1']), 'direccion');
});

prueba('C12: las coordenadas son opcionales', function (): void {
    afirmarIgual(null, datos(base())['latitud']);
});

prueba('C12: coordenadas válidas se conservan', function (): void {
    $d = datos(base(['latitud' => 3.2611, 'longitud' => -76.5423, 'precision_m' => 18]));
    afirmarIgual(3.2611, $d['latitud']);
    afirmarIgual(-76.5423, $d['longitud']);
    afirmarIgual(18, $d['precision_m']);
});

prueba('C12: coordenadas fuera de Colombia se descartan', function (): void {
    afirmarError(base(['latitud' => 48.85, 'longitud' => 2.35]), 'latitud');
});

prueba('C12: media coordenada se descarta', function (): void {
    afirmarError(base(['latitud' => 3.26, 'longitud' => null]), 'latitud');
});

grupo('Alojamiento y bien');

prueba('C4: si evacuó, exige dónde se aloja', function (): void {
    afirmarError(base(['alojamiento' => 'EVACUADO']), 'alojamiento_direccion');
});

prueba('C4: la dirección de alojamiento sobra si no evacuó', function (): void {
    afirmarError(base(['alojamiento_direccion' => 'Casa de un familiar']), 'alojamiento_direccion');
});

prueba('un tipo de bien fuera del catálogo se rechaza', function (): void {
    afirmarError(base(['tipo_bien' => 'CASTILLO']), 'tipo_bien');
});

prueba('los catorce tipos de bien del formato se aceptan', function (): void {
    foreach (array_keys(Catalogos::TIPOS_BIEN) as $tipo) {
        afirmarSinError(base(['tipo_bien' => $tipo]), 'tipo_bien');
    }
});

grupo('Personas');

prueba('se exige al menos una persona', function (): void {
    afirmarError(base(['personas' => []]), 'personas');
});

prueba('no se admiten más de diez personas', function (): void {
    $once = array_map(
        static fn (int $i): array => persona([
            'parentesco' => $i === 0 ? 1 : 3,
            'numero_documento' => (string) (10000000 + $i),
        ]),
        range(0, 10)
    );
    afirmarError(base(['personas' => $once]), 'personas');
});

prueba('diez personas sí se admiten', function (): void {
    $diez = array_map(
        static fn (int $i): array => persona([
            'parentesco' => $i === 0 ? 1 : 3,
            'numero_documento' => (string) (10000000 + $i),
        ]),
        range(0, 9)
    );
    afirmarIgual([], errores(base(['personas' => $diez])));
});

prueba('debe haber un jefe de hogar', function (): void {
    afirmarError(base(['personas' => [persona(['parentesco' => 3])]]), 'personas');
});

prueba('no puede haber dos jefes de hogar', function (): void {
    afirmarError(base(['personas' => [
        persona(),
        persona(['numero_documento' => '99887766']),
    ]]), 'personas');
});

prueba('no se repite el mismo documento en el hogar', function (): void {
    afirmarError(base(['personas' => [
        persona(),
        persona(['parentesco' => 3]),
    ]]), 'personas.1.numero_documento');
});

prueba('C6: la cédula exige número', function (): void {
    afirmarError(base(['personas' => [persona(['numero_documento' => ''])]]), 'personas.0.numero_documento');
});

prueba('C6: la cédula no admite letras', function (): void {
    afirmarError(base(['personas' => [persona(['numero_documento' => 'AB123456'])]]), 'personas.0.numero_documento');
});

prueba('C6: el pasaporte sí admite letras', function (): void {
    afirmarSinError(
        base(['personas' => [persona(['tipo_documento' => 5, 'numero_documento' => 'AV123456'])]]),
        'personas.0.numero_documento'
    );
});

prueba('C5: "menor sin identificación" no lleva número', function (): void {
    afirmarError(
        base(['personas' => [persona(['tipo_documento' => 6, 'numero_documento' => '123456'])]]),
        'personas.0.numero_documento'
    );
});

prueba('C5: "menor sin identificación" sin número es válido', function (): void {
    afirmarIgual([], errores(base(['personas' => [
        persona(['tipo_documento' => 6, 'numero_documento' => '']),
    ]])));
});

prueba('C7: el documento "Otro" exige decir cuál', function (): void {
    afirmarError(
        base(['personas' => [persona(['tipo_documento' => 10, 'numero_documento' => 'X1234'])]]),
        'personas.0.documento_otro'
    );
});

prueba('C7: "cuál documento" sobra con cédula', function (): void {
    afirmarError(
        base(['personas' => [persona(['documento_otro' => 'Libreta militar'])]]),
        'personas.0.documento_otro'
    );
});

prueba('C8: el jefe de hogar necesita teléfono', function (): void {
    afirmarError(base(['personas' => [persona(['telefono' => ''])]]), 'personas.0.telefono');
});

prueba('C8: los demás integrantes no necesitan teléfono', function (): void {
    afirmarIgual([], errores(base(['personas' => [
        persona(),
        persona(['parentesco' => 3, 'tipo_documento' => 1, 'numero_documento' => '1088123', 'telefono' => '']),
    ]])));
});

prueba('un parentesco fuera de 1..15 se rechaza', function (): void {
    afirmarError(base(['personas' => [persona(['parentesco' => 99])]]), 'personas.0.parentesco');
});

prueba('un género fuera de 1..3 se rechaza', function (): void {
    afirmarError(base(['personas' => [persona(['genero' => 0])]]), 'personas.0.genero');
});

prueba('una etnia fuera de 1..6 se rechaza', function (): void {
    afirmarError(base(['personas' => [persona(['pertenencia_etnica' => 7])]]), 'personas.0.pertenencia_etnica');
});

prueba('la fecha de nacimiento es opcional', function (): void {
    afirmarIgual([], errores(base(['personas' => [persona(['fecha_nacimiento' => ''])]])));
});

prueba('la fecha de nacimiento no puede ser futura', function (): void {
    afirmarError(
        base(['personas' => [persona(['fecha_nacimiento' => date('Y-m-d', strtotime('+1 day'))])]]),
        'personas.0.fecha_nacimiento'
    );
});

prueba('el nombre no admite dígitos', function (): void {
    afirmarError(base(['personas' => [persona(['nombres' => 'Ana 3'])]]), 'personas.0.nombres');
});

prueba('el nombre admite tildes, ñ, apóstrofo y guion', function (): void {
    afirmarSinError(base(['personas' => [persona(['nombres' => "Ñandú D'Ángelo-Peña"])]]), 'personas.0.nombres');
});

grupo('Sector agropecuario');

prueba('C9: sin afectación no se admiten renglones', function (): void {
    afirmarError(base([
        'tiene_afectacion_agro' => false,
        'agropecuario' => [['tipo_cultivo' => 'Plátano']],
    ]), 'agropecuario');
});

prueba('C9: sin afectación el arreglo queda vacío', function (): void {
    afirmarIgual([], datos(base())['agropecuario']);
});

prueba('C9: con afectación se exige al menos un renglón', function (): void {
    afirmarError(base(['tiene_afectacion_agro' => true, 'agropecuario' => []]), 'agropecuario');
});

prueba('un renglón sin cultivo ni especie se rechaza', function (): void {
    afirmarError(base([
        'tiene_afectacion_agro' => true,
        'agropecuario' => [['tipo_cultivo' => '', 'especie_pecuaria' => '']],
    ]), 'agropecuario.0');
});

prueba('C10: el cultivo exige unidad y área', function (): void {
    $e = errores(base([
        'tiene_afectacion_agro' => true,
        'agropecuario' => [['tipo_cultivo' => 'Caña']],
    ]));
    afirmar(isset($e['agropecuario.0.unidad_medida']), 'falta el error de unidad');
    afirmar(isset($e['agropecuario.0.area_cantidad']), 'falta el error de área');
});

prueba('C10: un área de cero se rechaza', function (): void {
    afirmarError(base([
        'tiene_afectacion_agro' => true,
        'agropecuario' => [['tipo_cultivo' => 'Caña', 'unidad_medida' => 'HECTAREA', 'area_cantidad' => 0]],
    ]), 'agropecuario.0.area_cantidad');
});

prueba('C11: la especie exige cantidad', function (): void {
    afirmarError(base([
        'tiene_afectacion_agro' => true,
        'agropecuario' => [['especie_pecuaria' => 'Gallinas']],
    ]), 'agropecuario.0.cantidad_unidades');
});

prueba('un renglón solo pecuario es válido', function (): void {
    afirmarIgual([], errores(base([
        'tiene_afectacion_agro' => true,
        'agropecuario' => [['especie_pecuaria' => 'Gallinas', 'cantidad_unidades' => 40]],
    ])));
});

prueba('no se admiten más de cuatro renglones', function (): void {
    afirmarError(base([
        'tiene_afectacion_agro' => true,
        'agropecuario' => array_fill(0, 5, ['especie_pecuaria' => 'Cerdos', 'cantidad_unidades' => 2]),
    ]), 'agropecuario');
});

grupo('Contacto y autorizaciones');

prueba('el teléfono de contacto es obligatorio', function (): void {
    afirmarError(base(['contacto_telefono' => '']), 'contacto_telefono');
});

prueba('un teléfono de menos de siete dígitos se rechaza', function (): void {
    afirmarError(base(['contacto_telefono' => '31055']), 'contacto_telefono');
});

prueba('el teléfono se normaliza a solo dígitos', function (): void {
    afirmarIgual('573105551234', datos(base(['contacto_telefono' => '+57 (310) 555-1234']))['contacto_telefono']);
});

prueba('un correo inválido se rechaza', function (): void {
    afirmarError(base(['contacto_correo' => 'no-es-correo']), 'contacto_correo');
});

prueba('el correo es opcional', function (): void {
    afirmarIgual(null, datos(base())['contacto_correo']);
});

prueba('el correo se normaliza a minúsculas', function (): void {
    afirmarIgual('A@B.CO', 'A@B.CO');
    afirmarIgual('ana@jamundi.gov.co', datos(base(['contacto_correo' => 'Ana@Jamundi.Gov.CO']))['contacto_correo']);
});

prueba('la autorización es obligatoria', function (): void {
    afirmarError(base(['autoriza_tratamiento' => false]), 'autoriza_tratamiento');
});

prueba('una autorización que no sea exactamente true no vale', function (): void {
    // Un 1 o un "si" no son un consentimiento: se exige el booleano, para que un
    // cliente mal escrito no pueda dar por autorizado lo que nadie autorizó.
    afirmarError(base(['autoriza_tratamiento' => 'si']), 'autoriza_tratamiento');
    afirmarError(base(['autoriza_tratamiento' => 1]), 'autoriza_tratamiento');
});

prueba('se guarda el aviso que leyó el ciudadano, no el vigente hoy', function (): void {
    // Una ficha levantada sin señal puede llegar días después, con la aplicación
    // ya cambiada. Estampar la versión vigente afirmaría que esa persona aceptó
    // un texto que nunca vio, y ese registro es la prueba exigible ante la SIC.
    afirmarIgual('habeas-data-v1', datos(base(['aviso_version' => 'habeas-data-v1']))['autorizacion_texto']);
    afirmarIgual('habeas-data-v2', datos(base(['aviso_version' => 'habeas-data-v2']))['autorizacion_texto']);
});

prueba('un aviso inventado no se guarda: se usa el vigente', function (): void {
    // El cliente no puede escribir cualquier cosa en la prueba del consentimiento.
    afirmarIgual(Catalogos::AVISO_VERSION, datos(base(['aviso_version' => 'lo-que-sea']))['autorizacion_texto']);
    afirmarIgual(Catalogos::AVISO_VERSION, datos(base(['aviso_version' => 123]))['autorizacion_texto']);
});

prueba('sin aviso declarado se asume el vigente', function (): void {
    afirmarIgual(Catalogos::AVISO_VERSION, datos(base())['autorizacion_texto']);
});

prueba('una sola casilla sigue guardando las dos columnas de la ley', function (): void {
    // La ley distingue los datos sensibles del resto. Aunque el ciudadano marque
    // una casilla, la base debe poder responder qué autorizó exactamente.
    $d = datos(base());
    afirmarIgual(1, $d['autoriza_datos']);
    afirmarIgual(1, $d['autoriza_sensibles']);
});

prueba('el aviso aceptado sube de versión al cambiar su texto', function (): void {
    // Lo que prueba qué aceptó el ciudadano es este número, no lo que hoy diga
    // la pantalla. Las fichas anteriores conservan la versión que aceptaron.
    afirmarIgual('habeas-data-v2', Catalogos::AVISO_VERSION);
    afirmarIgual('habeas-data-v2', datos(base())['autorizacion_texto']);
});

prueba('se guarda la versión del aviso aceptado', function (): void {
    afirmarIgual(Catalogos::AVISO_VERSION, datos(base())['autorizacion_texto']);
});

prueba('las observaciones se limitan a 2000 caracteres', function (): void {
    afirmarError(base(['observaciones' => str_repeat('a', 2001)]), 'observaciones');
});

grupo('Saneamiento');

prueba('el texto se recorta', function (): void {
    afirmarIgual('Calle 10 # 5-32', datos(base(['direccion' => "   Calle 10 # 5-32\t "]))['direccion']);
});

prueba('los caracteres de control se eliminan', function (): void {
    afirmarIgual('Calle 10 # 5-32', datos(base(['direccion' => "Calle 10 \x00# 5-32"]))['direccion']);
});

prueba('el HTML se conserva literal: escaparlo es tarea de quien lo muestre', function (): void {
    $entrada = '<script>alert(1)</script> en el patio';
    afirmarIgual($entrada, datos(base(['observaciones' => $entrada]))['observaciones']);
});

prueba('una comilla de inyección SQL es solo texto', function (): void {
    $entrada = "Calle 5' OR 1=1 --";
    afirmarIgual($entrada, datos(base(['direccion' => $entrada]))['direccion']);
});

prueba('un valor no escalar no revienta el validador', function (): void {
    afirmarError(base(['direccion' => ['a' => 'b']]), 'direccion');
});

prueba('personas que no son un arreglo no revientan el validador', function (): void {
    afirmarError(base(['personas' => 'muchas']), 'personas');
});

grupo('Radicado');

prueba('el formato es RUFE-AAAA-XXXXXXXX', function (): void {
    afirmar(Radicado::esValido(Radicado::componer()), 'el radicado generado no pasa su propia validación');
});

prueba('lleva el año en curso', function (): void {
    afirmar(str_starts_with(Radicado::componer(), 'RUFE-'.date('Y').'-'), 'el año no coincide');
});

prueba('mide exactamente 18 caracteres, como la columna', function (): void {
    afirmarIgual(18, strlen(Radicado::componer()));
});

prueba('no usa I, L, O ni U, que se confunden al dictarlo', function (): void {
    for ($i = 0; $i < 200; $i++) {
        $sufijo = substr(Radicado::componer(), 10);
        afirmar(preg_match('/[ILOU]/', $sufijo) !== 1, "el sufijo {$sufijo} trae un carácter ambiguo");
    }
});

prueba('no es predecible: 500 radicados sin repetición', function (): void {
    $vistos = [];
    for ($i = 0; $i < 500; $i++) {
        $vistos[Radicado::componer()] = true;
    }
    afirmarIgual(500, count($vistos), 'hubo colisiones');
});

prueba('un radicado con formato ajeno no valida', function (): void {
    afirmar(! Radicado::esValido('RUFE-2026-0000000I'), 'aceptó una I');
    afirmar(! Radicado::esValido('RUFE-26-ABCDEFGH'), 'aceptó un año de dos dígitos');
    afirmar(! Radicado::esValido('rufe-2026-ABCDEFGH'), 'aceptó minúsculas');
});

grupo('Huella anti-duplicado');

prueba('la misma dirección con otro espaciado da la misma huella', function (): void {
    afirmarIgual(
        Radicado::huella('2026-08-01', 'Calle 10 # 5-32', '31234567'),
        Radicado::huella('2026-08-01', '  calle 10   #  5-32 ', '31234567')
    );
});

prueba('otra fecha da otra huella', function (): void {
    afirmar(
        Radicado::huella('2026-08-01', 'Calle 10', '312') !== Radicado::huella('2026-08-02', 'Calle 10', '312'),
        'la fecha no influye en la huella'
    );
});

prueba('otro jefe de hogar da otra huella', function (): void {
    afirmar(
        Radicado::huella('2026-08-01', 'Calle 10', '312') !== Radicado::huella('2026-08-01', 'Calle 10', '999'),
        'el documento no influye en la huella'
    );
});

grupo('Catálogos');

prueba('los códigos del formato están completos', function (): void {
    afirmarIgual(10, count(Catalogos::TIPOS_DOCUMENTO));
    afirmarIgual(15, count(Catalogos::PARENTESCOS));
    afirmarIgual(3, count(Catalogos::GENEROS));
    afirmarIgual(6, count(Catalogos::ETNIAS));
    afirmarIgual(14, count(Catalogos::TIPOS_BIEN));
    afirmarIgual(5, count(Catalogos::FORMAS_TENENCIA));
    afirmarIgual(5, count(Catalogos::ESTADOS_BIEN));
    afirmarIgual(5, count(Catalogos::UNIDADES_MEDIDA));
});

prueba('los códigos numéricos empiezan en 1 y son contiguos', function (): void {
    foreach ([Catalogos::TIPOS_DOCUMENTO, Catalogos::PARENTESCOS, Catalogos::GENEROS, Catalogos::ETNIAS] as $catalogo) {
        afirmarIgual(range(1, count($catalogo)), array_keys($catalogo));
    }
});

prueba('solo tres códigos describen ausencia de documento', function (): void {
    foreach ([6, 7, 8] as $codigo) {
        afirmar(! Catalogos::exigeNumeroDocumento($codigo), "el código {$codigo} no debería exigir número");
    }
    foreach ([1, 2, 3, 4, 5, 9, 10] as $codigo) {
        afirmar(Catalogos::exigeNumeroDocumento($codigo), "el código {$codigo} debería exigir número");
    }
});

prueba('el código 9 es el NIT y lleva número', function (): void {
    // Se leyó mal del PDF original, borroso, como "NA": clasificado así, el
    // formulario impedía escribir el NIT de un hospital o una escuela, que son
    // tipos de bien del propio formato.
    afirmarIgual('NIT', Catalogos::TIPOS_DOCUMENTO[9]);
    afirmar(Catalogos::exigeNumeroDocumento(9), 'el NIT debe exigir número');
    afirmar(
        in_array(9, Catalogos::DOCUMENTOS_ALFANUMERICOS, true),
        'el NIT debe admitir el guion del dígito de verificación'
    );
});

prueba('un NIT con dígito de verificación se acepta', function (): void {
    afirmarSinError(
        base(['personas' => [persona(['tipo_documento' => 9, 'numero_documento' => '900123456-1'])]]),
        'personas.0.numero_documento'
    );
});

prueba('los predeterminados apuntan a un evento que existe en el catálogo', function (): void {
    afirmar(
        in_array(Catalogos::EVENTO_PREDETERMINADO, Catalogos::EVENTOS_SUGERIDOS, true),
        'el evento precargado no está en la lista, el formulario abriría con un valor que él mismo rechaza'
    );
});

prueba('la fecha predeterminada es válida para el formulario', function (): void {
    $f = Catalogos::FECHA_EVENTO_PREDETERMINADA;
    afirmar(preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) === 1, 'formato inesperado');
    afirmar($f <= date('Y-m-d'), 'la fecha precargada es futura');
    afirmar(
        $f >= date('Y-m-d', strtotime('-'.Catalogos::ANOS_ATRAS_EVENTO.' years')),
        'la fecha precargada quedó fuera de la ventana admitida'
    );
    afirmarIgual([], errores(base(['evento' => Catalogos::EVENTO_PREDETERMINADO, 'fecha_evento' => $f])));
});

prueba('el servidor solo acepta WebP y JPEG', function (): void {
    // El navegador convierte toda foto antes de subirla. Aceptar PNG, HEIC o PDF
    // sería dejar abierta una puerta que el formulario ya no usa.
    afirmarIgual(['webp', 'jpg', 'jpeg'], array_keys(Catalogos::EXTENSIONES));
    afirmar(! isset(Catalogos::EXTENSIONES['png']), 'PNG debería estar fuera');
    afirmar(! isset(Catalogos::EXTENSIONES['pdf']), 'PDF debería estar fuera');
    afirmar(! isset(Catalogos::EXTENSIONES['heic']), 'HEIC debería estar fuera');
});

prueba('el tope por foto deja margen sobre la meta del navegador', function (): void {
    afirmar(
        Catalogos::MAX_BYTES_ARCHIVO > Catalogos::OBJETIVO_BYTES_FOTO,
        'el tope del servidor debe ser mayor que la meta del navegador, o una foto en el límite se rechazaría'
    );
    afirmar(Catalogos::MAX_BYTES_ARCHIVO <= 1048576, 'el tope subió de 1 MiB');
    afirmarIgual(921600, Catalogos::OBJETIVO_BYTES_FOTO);
});

prueba('hay tope de resolución contra bombas de descompresión', function (): void {
    afirmar(Catalogos::MAX_LADO_PIXELES > 1920, 'debe caber lo que produce el navegador');
    afirmar(Catalogos::MAX_LADO_PIXELES <= 8000, 'un tope demasiado alto no protege de nada');
});

prueba('los cupos de evidencia son uno de documento y cuatro de daño', function (): void {
    afirmarIgual(1, Catalogos::MAX_EVIDENCIAS_DOCUMENTO);
    afirmarIgual(4, Catalogos::MAX_EVIDENCIAS_DANO);
    afirmarIgual(5, Catalogos::MAX_EVIDENCIAS);
    afirmarIgual(
        ['DOCUMENTO', 'DANO', 'INSPECCION', 'PRE_CEDULA', 'PRE_DANO'],
        array_keys(Catalogos::TIPOS_EVIDENCIA)
    );

    // Cinco fotos de 900 KB caben de sobra en el cupo total de la carga.
    afirmar(
        Catalogos::MAX_EVIDENCIAS * Catalogos::OBJETIVO_BYTES_FOTO < Catalogos::MAX_BYTES_CARGA,
        'el cupo total de la carga no alcanza para el máximo de fotos'
    );
});

prueba('el registro fotográfico de la inspección tiene las diez casillas del formato', function (): void {
    // El numeral 11 imprime diez recuadros. Si el cupo del servidor fuera menor,
    // el profesional llenaría el papel y el sistema le rechazaría fotos sin que
    // nada en pantalla explicara por qué.
    afirmarIgual(
        CatalogosInspeccion::MAX_FOTOS,
        Catalogos::TIPOS_EVIDENCIA['INSPECCION']['maximo']
    );
    afirmarIgual(10, CatalogosInspeccion::MAX_FOTOS);
});

prueba('las diez fotos de una inspección caben en el cupo de la carga', function (): void {
    // Diez es el doble de lo que sube un RUFE. Si no cupieran, el fallo
    // aparecería en la última foto de una visita ya terminada.
    afirmar(
        CatalogosInspeccion::MAX_FOTOS * Catalogos::OBJETIVO_BYTES_FOTO < Catalogos::MAX_BYTES_CARGA,
        'el cupo de la carga no alcanza para las diez fotos del numeral 11'
    );
});

prueba('la respuesta de la API es serializable y trae lo esencial', function (): void {
    $json = json_encode(Catalogos::paraApi(), JSON_UNESCAPED_UNICODE);
    afirmar($json !== false, 'no se pudo serializar');

    $vuelta = json_decode((string) $json, true);
    foreach (['tipos_documento', 'parentescos', 'generos', 'etnias', 'tipos_bien', 'limites', 'fijos', 'predeterminados'] as $clave) {
        afirmar(isset($vuelta[$clave]), "falta la clave «{$clave}»");
    }
    afirmarIgual(15, count($vuelta['parentescos']));
    afirmarIgual(1, $vuelta['parentescos'][0]['codigo'], 'el primer parentesco debe ser el jefe de hogar');
});

prueba('los catálogos numerados viajan como lista y conservan el orden', function (): void {
    $json = (string) json_encode(Catalogos::paraApi());
    afirmar(str_contains($json, '"parentescos":[{'), 'los parentescos deberían ser un arreglo JSON, no un objeto');
});

grupo('Troceo del SQL');

prueba('los comentarios se quitan antes de partir', function (): void {
    $sentencias = Migrador::sentencias("-- comentario\nSELECT 1;\n-- otro\nSELECT 2;");
    afirmarIgual(['SELECT 1', 'SELECT 2'], $sentencias);
});

prueba('la migración posterior no rompe el troceo', function () use ($raiz): void {
    $sql = (string) file_get_contents($raiz.'/database/rufe_02_evidencias_y_envio.sql');
    $sentencias = Migrador::sentencias($sql);

    afirmar($sentencias !== [], 'el archivo quedó vacío tras quitar comentarios');
    foreach ($sentencias as $s) {
        afirmar(! str_contains($s, '--'), 'quedó un comentario dentro de una sentencia');
    }

    // Comprueba la pareja PREPARE/DEALLOCATE: si el troceo partiera una por la
    // mitad, la migración fallaría a mitad de camino en producción.
    afirmarIgual(2, count(array_filter($sentencias, static fn (string $s): bool => str_starts_with($s, 'PREPARE'))));
    afirmarIgual(2, count(array_filter($sentencias, static fn (string $s): bool => str_starts_with($s, 'DEALLOCATE'))));
});

prueba('la migración solo añade columnas: no borra ni renombra nada', function () use ($raiz): void {
    $sql = strtoupper((string) file_get_contents($raiz.'/database/rufe_02_evidencias_y_envio.sql'));
    foreach ([' DROP ', ' TRUNCATE ', 'DELETE FROM', 'CHANGE COLUMN'] as $peligrosa) {
        afirmar(! str_contains($sql, $peligrosa), "la migración contiene «{$peligrosa}»");
    }
});

prueba('rufe.sql se trocea en las siete tablas esperadas', function () use ($raiz): void {
    $sql = (string) file_get_contents($raiz.'/database/rufe.sql');
    $sentencias = Migrador::sentencias($sql);

    $creates = array_filter($sentencias, static fn (string $s): bool => str_starts_with($s, 'CREATE TABLE'));
    afirmarIgual(7, count($creates), 'número de CREATE TABLE');

    foreach ($sentencias as $s) {
        afirmar(! str_contains($s, '--'), 'quedó un comentario dentro de una sentencia');
    }
});

prueba('rufe.sql es idempotente: todo CREATE lleva IF NOT EXISTS', function () use ($raiz): void {
    $sql = (string) file_get_contents($raiz.'/database/rufe.sql');
    foreach (Migrador::sentencias($sql) as $s) {
        if (str_starts_with($s, 'CREATE TABLE')) {
            afirmar(str_contains($s, 'IF NOT EXISTS'), 'un CREATE TABLE sin IF NOT EXISTS: '.substr($s, 0, 60));
        }
    }
});

prueba('todos los .sql del Migrador se trocean y son idempotentes', function () use ($raiz): void {
    // Se recorre la lista real del Migrador y no una escrita a mano: un archivo
    // que se añada allí y no aquí se aplicaría en producción sin que nada lo
    // hubiera mirado. El hosting no tiene consola — si una migración falla a
    // medias, se arregla por FTP.
    foreach (Migrador::ARCHIVOS as $archivo) {
        $ruta = $raiz.'/database/'.$archivo;
        afirmar(is_file($ruta), "falta database/{$archivo}");

        $sentencias = Migrador::sentencias((string) file_get_contents($ruta));
        afirmar($sentencias !== [], "{$archivo} no produjo ninguna sentencia");

        foreach ($sentencias as $s) {
            if (str_starts_with($s, 'CREATE TABLE')) {
                afirmar(str_contains($s, 'IF NOT EXISTS'), "{$archivo}: CREATE TABLE sin IF NOT EXISTS");
            }
            afirmar(! str_contains($s, '--'), "{$archivo}: quedó un comentario dentro de una sentencia");
        }
    }
});

/**
 * ¿Este ALTER solo ENSANCHA un ENUM?
 *
 * Cierto únicamente si es un `MODIFY COLUMN … ENUM(...)` sobre una de las
 * columnas declaradas abajo, no toca nada más, y la lista nueva contiene todos
 * los valores que esa columna ya admitía.
 *
 * Los valores previos se escriben AQUÍ y no se leen del archivo de migración:
 * sacarlos del mismo sitio que se quiere comprobar no comprobaría nada.
 */
function ensanchaUnEnum(string $sentencia): bool
{
    // La excepción está acotada a columnas concretas. Abrirla a cualquier
    // columna sería regalar el permiso de modificar lo que sea.
    foreach (ENUMS_QUE_PUEDEN_CRECER as $columna => $anteriores) {
        if (preg_match('/MODIFY\s+COLUMN\s+'.$columna.'\s+ENUM\s*\(([^)]*)\)/i', $sentencia, $m) !== 1) {
            continue;
        }

        // Nada más en el mismo ALTER: ni DROP, ni CHANGE, ni otro MODIFY.
        if (preg_match_all('/\b(DROP|CHANGE|MODIFY)\s+COLUMN\b/i', $sentencia) !== 1) {
            return false;
        }

        preg_match_all("/'{2}([A-Z_]+)'{2}/", $m[1], $valores);
        $nuevos = $valores[1];

        foreach ($anteriores as $previo) {
            if (! in_array($previo, $nuevos, true)) {
                return false;
            }
        }

        return true;
    }

    return false;
}

/**
 * Qué ENUM puede ensancharse, y qué valores admitía antes.
 *
 * @var array<string,list<string>>
 */
const ENUMS_QUE_PUEDEN_CRECER = [
    'rol'  => ['ADMINISTRADOR', 'GESTOR', 'VISUALIZACION'],
    'tipo' => ['DOCUMENTO', 'DANO'],
];

prueba('la excepción del ENUM no vale para recortarlo', function (): void {
    // Sin esto, «se permite un MODIFY de un ENUM» sería un agujero por el que
    // cabría cualquier cosa. Se comprueba invirtiendo el caso.
    $ensancha = "ALTER TABLE usuarios MODIFY COLUMN rol ENUM(''ADMINISTRADOR'',''GESTOR'',''VISUALIZACION'',''INSPECTOR'')";
    $recorta  = "ALTER TABLE usuarios MODIFY COLUMN rol ENUM(''ADMINISTRADOR'',''INSPECTOR'')";
    $otraCosa = "ALTER TABLE usuarios MODIFY COLUMN email VARCHAR(200) NOT NULL";
    $tipoOk   = "ALTER TABLE rufe_evidencias MODIFY COLUMN tipo ENUM(''DOCUMENTO'',''DANO'',''INSPECCION'')";
    $tipoMal  = "ALTER TABLE rufe_evidencias MODIFY COLUMN tipo ENUM(''DANO'',''INSPECCION'')";
    $conDrop  = "ALTER TABLE usuarios MODIFY COLUMN rol ENUM(''ADMINISTRADOR'',''GESTOR'',''VISUALIZACION'',''INSPECTOR''), DROP COLUMN activo";

    afirmar(ensanchaUnEnum($ensancha), 'añadir un rol debería permitirse');
    afirmar(! ensanchaUnEnum($recorta), 'quitar un rol NO puede permitirse');
    afirmar(! ensanchaUnEnum($otraCosa), 'la excepción es solo para el ENUM de rol');
    afirmar(! ensanchaUnEnum($conDrop), 'un DROP colado en el mismo ALTER debe bloquearlo');
    afirmar(ensanchaUnEnum($tipoOk), 'añadir un tipo de evidencia debería permitirse');
    afirmar(! ensanchaUnEnum($tipoMal), 'quitar DOCUMENTO NO puede permitirse');
});

prueba('ninguna migración puede borrar datos', function () use ($raiz): void {
    // Esto no es celo: estas migraciones se aplican sobre una base con fichas de
    // hogares damnificados que NO existen en ningún otro sitio. Una sentencia
    // destructiva que se colara aquí no se notaría hasta que fuera irreversible.
    //
    // Se comprueban los verbos, no el texto: «ON DELETE CASCADE» dentro de una
    // clave foránea define comportamiento referencial y no borra nada, mientras
    // que un DROP o un TRUNCATE sueltos sí.
    $permitidos = ['CREATE', 'SET', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'INSERT', 'DO'];

    foreach (Migrador::ARCHIVOS as $archivo) {
        foreach (Migrador::sentencias((string) file_get_contents($raiz.'/database/'.$archivo)) as $s) {
            $verbo = strtoupper(strtok(trim($s), " (\n"));

            afirmar(
                in_array($verbo, $permitidos, true),
                "{$archivo}: sentencia «{$verbo}» no permitida en una migración"
            );

            // Un ALTER escondido dentro de un SET @sql := IF(...) solo puede
            // AÑADIR: cambiar o quitar una columna con datos dentro los pierde.
            //
            // Con UNA excepción, la de ensanchar un ENUM. MySQL no sabe añadirle
            // un valor a un ENUM que no sea redefinirlo entero, así que sin esto
            // no se podría crear nunca un rol nuevo. La excepción es estrecha a
            // propósito: se comprueba que la lista nueva CONTENGA todos los
            // valores anteriores. Un MODIFY que quite un valor —o que toque
            // cualquier otra cosa— sigue prohibido.
            if (preg_match('/\bALTER\s+TABLE\b/i', $s) === 1) {
                $ensancha = ensanchaUnEnum($s);

                if (! $ensancha) {
                    afirmar(
                        preg_match('/\b(DROP|MODIFY|CHANGE)\s+COLUMN\b/i', $s) !== 1,
                        "{$archivo}: un ALTER TABLE quita o cambia una columna"
                    );
                    afirmar(
                        preg_match('/\bADD\s+(COLUMN|KEY|CONSTRAINT|UNIQUE)\b/i', $s) === 1,
                        "{$archivo}: un ALTER TABLE que no añade nada"
                    );
                }
            }
        }
    }
});

prueba('el archivo de reversión NUNCA está en la lista del Migrador', function (): void {
    // rufe_revertir.sql borra las siete tablas del censo. Existe para desarrollo
    // y para deshacer una instalación fallida; que se colara en la lista que se
    // ejecuta en cada despliegue vaciaría la base en producción.
    afirmar(
        ! in_array('rufe_revertir.sql', Migrador::ARCHIVOS, true),
        'rufe_revertir.sql no puede aplicarse automáticamente'
    );
});

prueba('la inspección se aplica después del RUFE, del que depende', function (): void {
    // Declara una foránea contra rufe_reportes y añade columnas a
    // rufe_evidencias: al revés, la migración reventaría en el primer despliegue.
    $orden = array_flip(Migrador::ARCHIVOS);

    afirmar(
        $orden['inspeccion_01_viviendas.sql'] > $orden['rufe.sql'],
        'inspeccion_01_viviendas.sql tiene que ir después de rufe.sql'
    );
});

prueba('rufe_revertir.sql borra exactamente lo que crea rufe.sql', function () use ($raiz): void {
    $crea = [];
    foreach (Migrador::sentencias((string) file_get_contents($raiz.'/database/rufe.sql')) as $s) {
        if (preg_match('/CREATE TABLE IF NOT EXISTS (\w+)/', $s, $m) === 1) {
            $crea[] = $m[1];
        }
    }

    $borra = [];
    foreach (Migrador::sentencias((string) file_get_contents($raiz.'/database/rufe_revertir.sql')) as $s) {
        if (preg_match('/DROP TABLE IF EXISTS (\w+)/', $s, $m) === 1) {
            $borra[] = $m[1];
        }
    }

    // El orden importa: hay claves foráneas, así que hay que borrar de la hoja
    // hacia la raíz, es decir exactamente al revés de como se creó.
    afirmarIgual(array_reverse($crea), $borra, 'la reversión no va en orden inverso a la creación');
});

prueba('la reversión no toca ninguna tabla previa', function () use ($raiz): void {
    $sql = (string) file_get_contents($raiz.'/database/rufe_revertir.sql');
    foreach (['usuarios', 'sesiones', 'auditoria', 'ajustes'] as $tabla) {
        afirmar(
            ! str_contains($sql, 'DROP TABLE IF EXISTS '.$tabla.';')
            && ! preg_match('/DROP TABLE IF EXISTS '.$tabla.'\b/', $sql),
            "la reversión borraría la tabla previa «{$tabla}»"
        );
    }
});

grupo('Actualizador del sistema');

/** Acceso a los métodos privados: son las reglas que deciden qué se sobrescribe. */
function actualizador(string $metodo, mixed ...$args): mixed
{
    // setAccessible() no se llama: desde PHP 8.1 no hace nada y en 8.5 avisa
    // como obsoleta. La reflexión ya alcanza los métodos privados.
    return (new ReflectionMethod(Actualizador::class, $metodo))->invoke(new Actualizador, ...$args);
}

function constanteActualizador(string $nombre): mixed
{
    return (new ReflectionClass(Actualizador::class))->getConstant($nombre);
}

prueba('config.php nunca se sobrescribe', function (): void {
    afirmar(
        in_array('config.php', constanteActualizador('PROTEGIDAS'), true),
        'config.php debe estar protegido: un despliegue que lo pise borra las credenciales'
    );
    afirmar(! actualizador('admisible', 'config.php'), 'admisible() aceptó config.php');
});

prueba('los instaladores de un solo uso no reviven', function (): void {
    foreach (['instalar.php', 'migrar.php'] as $archivo) {
        afirmar(! actualizador('admisible', $archivo), "admisible() aceptó {$archivo}");
    }
});

prueba('no se puede escribir fuera del destino', function (): void {
    foreach (['../config.php', 'src/../../fuera.php', '../../etc/passwd'] as $ruta) {
        afirmar(! actualizador('admisible', $ruta), "admisible() aceptó «{$ruta}»");
    }
});

prueba('solo se escriben extensiones de la lista blanca', function (): void {
    foreach (['src/Core/Db.php', 'index.php', '_app/x.js', 'estilo.css', 'database/rufe.sql'] as $ok) {
        afirmar(actualizador('admisible', $ok), "admisible() rechazó «{$ok}»");
    }
    foreach (['malo.sh', 'x.exe', 'y.bin', 'z.phar'] as $no) {
        afirmar(! actualizador('admisible', $no), "admisible() aceptó «{$no}»");
    }
});

prueba('el .htaccess sí se escribe pese a no tener extensión', function (): void {
    afirmar(actualizador('admisible', '.htaccess'), 'admisible() rechazó .htaccess');
});

prueba('el mapa aplana el backend como lo espera el servidor', function (): void {
    $mapa = constanteActualizador('MAPA');

    // En el repositorio el punto de entrada vive en public/; en el servidor va
    // en la raíz de api/, porque el hosting no deja poner código sobre el
    // document root.
    afirmarIgual('index.php', $mapa['BACKEND']['Gestion_riesgo/backend/public/index.php']);
    afirmarIgual('src', $mapa['BACKEND']['Gestion_riesgo/backend/src']);
    afirmarIgual('database', $mapa['BACKEND']['Gestion_riesgo/backend/database']);
    afirmarIgual('', $mapa['FRONTEND']['Gestion_riesgo/frontend/build']);
});

prueba('la plantilla de configuración NO viene con la autoactualización encendida', function () use ($raiz): void {
    // Es la comprobación que impide el peor descuido posible: que alguien copie
    // config.example.php a config.php y el sitio quede pudiendo sobrescribirse
    // a sí mismo sin que nadie lo haya decidido.
    $config = require $raiz.'/config.example.php';

    afirmar(isset($config['actualizaciones']), 'falta la sección "actualizaciones" en la plantilla');
    afirmarIgual(false, $config['actualizaciones']['habilitado'], 'la plantilla viene habilitada');
    afirmarIgual('', $config['actualizaciones']['raiz_api'], 'la plantilla trae una ruta puesta');
    afirmarIgual('', $config['actualizaciones']['respaldos'], 'la plantilla trae una carpeta de respaldos puesta');
});

// ── Buscador de la bandeja ───────────────────────────────────────────────────

/**
 * Cuántas veces aparece cada marcador `:nombre` en el SQL.
 *
 * @return array<string,int>
 */
function marcadores(string $sql): array
{
    preg_match_all('/:([a-z][a-z0-9_]*)/i', $sql, $m);

    return array_count_values($m[1]);
}

prueba('ningún marcador se repite en la consulta', function (): void {
    // ESTE es el fallo que llegó a producción. Con preparadas nativas, un
    // marcador repetido hace que MySQL responda «Invalid parameter number» al
    // prepararla, así que el buscador daba error 500 con cualquier texto y no
    // funcionó nunca. No se veía sin base de datos; aquí sí.
    foreach (['Juan Pérez', '1113456789', 'RUFE-2026-ABCD1234', 'calle 10 juan 123'] as $texto) {
        [$sql] = Busqueda::condicion($texto);
        foreach (marcadores($sql) as $nombre => $veces) {
            afirmarIgual(1, $veces, "el marcador «{$nombre}» aparece {$veces} veces con «{$texto}»");
        }
    }
});

prueba('hay exactamente un parámetro por marcador', function (): void {
    foreach (['Juan Pérez García Lopez Ruiz', '1113456789', 'la playa'] as $texto) {
        [$sql, $params] = Busqueda::condicion($texto);
        $enSql = array_keys(marcadores($sql));
        $enParams = array_keys($params);
        sort($enSql);
        sort($enParams);
        afirmarIgual($enSql, $enParams, "descuadre con «{$texto}»");
    }
});

prueba('sin texto no hay condición', function (): void {
    afirmarIgual(['', []], Busqueda::condicion(''));
    afirmarIgual(['', []], Busqueda::condicion('   '));
});

prueba('busca por cédula exacta, no por trozos', function (): void {
    // Un documento parcial devolvería hogares ajenos y convertiría el buscador
    // en una forma de pasear por el censo.
    [$sql, $params] = Busqueda::condicion('1113456789');
    afirmar(str_contains($sql, 'pd.numero_documento = :doc'), 'debe comparar el documento exacto');
    afirmarIgual('1113456789', $params['doc']);
});

prueba('acepta la cédula escrita con puntos o espacios', function (): void {
    afirmarIgual('1113456789', Busqueda::condicion('1.113.456.789')[1]['doc']);
    afirmarIgual('1113456789', Busqueda::condicion('1 113 456 789')[1]['doc']);
});

prueba('un número corto no se toma por cédula', function (): void {
    // «123» es más probablemente parte de una dirección.
    afirmar(! isset(Busqueda::condicion('123')[1]['doc']), 'no debía buscar por documento');
});

prueba('el nombre se busca palabra por palabra, sin importar el orden', function (): void {
    [$sql, $params] = Busqueda::condicion('garcía juan');
    afirmar(str_contains($sql, "CONCAT(pn.nombres, ' ', pn.apellidos)"), 'debe concatenar nombre y apellido');
    afirmarIgual('%garcía%', $params['n0']);
    afirmarIgual('%juan%', $params['n1']);
    afirmarIgual(2, substr_count($sql, ':n'), 'una condición por palabra');
});

prueba('no se buscan más palabras de la cuenta', function (): void {
    [, $params] = Busqueda::condicion('uno dos tres cuatro cinco seis');
    $delNombre = array_filter(array_keys($params), static fn ($k) => str_starts_with($k, 'n'));
    afirmarIgual(Busqueda::MAX_PALABRAS, count($delNombre));
});

prueba('las letras sueltas no cuentan como nombre', function (): void {
    // Una inicial suelta haría coincidir a media base.
    afirmar(! isset(Busqueda::condicion('j')[1]['n0']), 'una sola letra no debe buscar por nombre');
});

prueba('los comodines del LIKE se neutralizan', function (): void {
    // Sin escapar, buscar «%» devolvería la base entera.
    afirmar(str_contains(Busqueda::condicion('%')[1]['q0'], '\%'), 'el % debe ir escapado');
    afirmar(str_contains(Busqueda::condicion('_')[1]['q0'], '\_'), 'el _ debe ir escapado');
});

prueba('el radicado se sigue encontrando por un trozo', function (): void {
    afirmarIgual('%XRT9BNCP%', Busqueda::condicion('XRT9BNCP')[1]['q0']);
});

prueba('distingue buscar una persona de hojear la bandeja', function (): void {
    // Solo lo primero queda anotado en la auditoría.
    afirmar(Busqueda::buscaPersona('1113456789'), 'una cédula busca persona');
    afirmar(Busqueda::buscaPersona('Juan Pérez'), 'un nombre busca persona');
    afirmar(! Busqueda::buscaPersona(''), 'sin texto no busca persona');
    afirmar(! Busqueda::buscaPersona('123'), 'un número corto no busca persona');
});

// ── Geocodificación ──────────────────────────────────────────────────────────

prueba('la misma dirección escrita de varias formas comparte clave', function (): void {
    // Cada clave distinta es una consulta más al servicio, con su segundo de
    // espera y su costo. Reconocer que es la misma casa es la mitad del ahorro.
    $formas = ['Cra 5 # 10-20', 'CARRERA 5 No 10 20', 'carrera 5 #10 20', '  Cra. 5 #10 - 20  '];
    $claves = array_map(static fn ($d) => Geocodificador::clave($d), $formas);
    afirmarIgual(1, count(array_unique($claves)), 'las cuatro formas debían dar una sola clave');
});

prueba('se normalizan las abreviaturas de vía', function (): void {
    afirmarIgual('carrera 11 # 8 26', Geocodificador::normalizar('Cra 11 # 8-26'));
    afirmarIgual('calle 12 # 3 45', Geocodificador::normalizar('Cll 12 No. 3-45'));
    afirmarIgual('avenida 4 norte', Geocodificador::normalizar('Av 4 Norte'));
    afirmarIgual('transversal 9 # 2 10', Geocodificador::normalizar('Tv 9 #2-10'));
});

prueba('a toda dirección se le añade el municipio', function (): void {
    // Sin esto, «Carrera 11 # 8 26» existe en media Colombia.
    afirmar(
        str_ends_with(Geocodificador::consulta('Cra 11 # 8-26'), 'Jamundí, Valle del Cauca, Colombia'),
        'la consulta debe terminar en el municipio'
    );
});

prueba('una calle sin número sí se intenta', function (): void {
    // «Juan de Ampudia» es una vía real y resuelve a precisión de calle, que
    // para un mapa de calor ya sirve.
    afirmar(Geocodificador::utilizable('Juan de ampudia'), 'debía aceptarse');
});

prueba('lo que no es una dirección no gasta consulta', function (): void {
    foreach (['NO INFORMA', 'na', 'sin direccion', 'ninguna', 'casa', 'x'] as $texto) {
        afirmar(! Geocodificador::utilizable($texto), "«{$texto}» no debía intentarse");
    }
});

prueba('un punto fuera de Jamundí se descarta', function (): void {
    // Bogotá: el servicio se equivocó de municipio.
    afirmarIgual('FALLIDA', Geocodificador::clasificar(['lat' => 4.7110, 'lon' => -74.0721, 'tipo' => 'house']));
    // Y el mar, por si llega basura.
    afirmarIgual('FALLIDA', Geocodificador::clasificar(['lat' => 0.0, 'lon' => 0.0, 'tipo' => 'house']));
});

prueba('el centroide del municipio no se da por bueno', function (): void {
    // ESTA es la trampa que arruinaría el mapa: una dirección que solo resuelve
    // a «Jamundí» devuelve coordenadas válidas e inútiles. Pintarlas amontonaría
    // medio censo sobre el parque principal y la mancha de calor mentiría.
    afirmarIgual('MUNICIPIO', Geocodificador::clasificar([
        'lat' => 3.2611, 'lon' => -76.5423, 'tipo' => 'administrative',
    ]));
    afirmar(! Geocodificador::pintable('MUNICIPIO'), 'el centroide no debe pintarse');
    afirmar(! Geocodificador::pintable('FALLIDA'), 'lo fallido no debe pintarse');
});

prueba('se distingue una casa de una calle y de un barrio', function (): void {
    $en = static fn (string $tipo) => Geocodificador::clasificar([
        'lat' => 3.2700, 'lon' => -76.5500, 'tipo' => $tipo,
    ]);
    afirmarIgual('EXACTA', $en('house'));
    afirmarIgual('EXACTA', $en('rooftop'));
    afirmarIgual('CALLE', $en('residential'));
    afirmarIgual('BARRIO', $en('suburb'));
});

prueba('las tres precisiones útiles sí se pintan', function (): void {
    foreach (['EXACTA', 'CALLE', 'BARRIO'] as $p) {
        afirmar(Geocodificador::pintable($p), "«{$p}» debía poder pintarse");
    }
});

prueba('sin clave configurada no se usa Google', function (): void {
    // El sistema tiene que funcionar solo con OpenStreetMap.
    afirmar(! Geocodificador::hayGoogle(), 'Google debe estar apagado por omisión');
});

prueba('se respeta el segundo entre peticiones que exige OpenStreetMap', function (): void {
    afirmar(Geocodificador::PAUSA_SEGUNDOS >= 1, 'su política no admite más de una por segundo');
});

prueba('un acierto en otro municipio se descarta aunque caiga en la caja', function (): void {
    // ESTE era el fallo que ponía predios donde no van. La caja de coordenadas es
    // un rectángulo y Jamundí no lo es: roza Cali por el norte y Villa Rica por
    // el sur, así que por caja sola se colaban aciertos de municipios vecinos y
    // se pintaban como propios.
    $enCali = [
        'lat' => '3.4200', 'lon' => '-76.5200',
        'address' => ['city' => 'Cali', 'state' => 'Valle del Cauca'],
    ];
    afirmar(Geocodificador::dentroDeJamundi(3.42, -76.52), 'la caja sí lo admite');
    afirmar(! Geocodificador::esDeJamundi($enCali), 'pero no es de Jamundí');
});

prueba('un acierto en Jamundí se acepta, con o sin tilde', function (): void {
    foreach (['Jamundí', 'Jamundi', 'JAMUNDÍ', 'Municipio de Jamundí'] as $nombre) {
        $r = ['lat' => '3.2700', 'lon' => '-76.5500', 'address' => ['county' => $nombre]];
        afirmar(Geocodificador::esDeJamundi($r), "«{$nombre}» debía aceptarse");
    }
});

prueba('el municipio se busca en la clave que traiga', function (): void {
    // Nominatim lo mete en una u otra según el tipo de lugar.
    foreach (['county', 'city', 'town', 'municipality', 'village'] as $clave) {
        $r = ['lat' => '3.2700', 'lon' => '-76.5500', 'address' => [$clave => 'Jamundí']];
        afirmar(Geocodificador::esDeJamundi($r), "no se miró la clave «{$clave}»");
    }
});

prueba('sin detalle de dirección se admite si cae en la caja', function (): void {
    // No se puede comprobar el nombre; la caja es lo único que queda.
    afirmar(
        Geocodificador::esDeJamundi(['lat' => '3.2700', 'lon' => '-76.5500']),
        'sin detalle, la caja debía bastar'
    );
});

prueba('fuera de la caja se descarta aunque diga Jamundí', function (): void {
    $r = ['lat' => '4.7110', 'lon' => '-74.0721', 'address' => ['county' => 'Jamundí']];
    afirmar(! Geocodificador::esDeJamundi($r), 'Bogotá no es Jamundí');
});

// ── Inspección de viviendas: Anexo 1 y niveles permitidos ────────────────────

grupo('Inspección › niveles de daño (Anexo 1)');

prueba('los niveles de cada elemento salen del anexo, no de una lista aparte', function (): void {
    // Si algún día se escribieran en dos sitios, un elemento acabaría
    // ofreciendo un nivel que el anexo no sabe describir.
    foreach (NivelDano::SISTEMAS as $sistema) {
        foreach (NivelDano::elementos($sistema) as $elemento) {
            foreach (NivelDano::nivelesDe($sistema, $elemento) as $nivel) {
                afirmar(
                    NivelDano::descriptores($sistema, $elemento, $nivel) !== [],
                    "{$sistema}/{$elemento}/{$nivel} se ofrece sin criterios que lo describan"
                );
            }
        }
    }
});

prueba('reproduce exactamente las casillas N/A del numeral 5.4', function (): void {
    // Las cuatro casillas marcadas N/A en el papel. Que coincidan no es
    // casualidad: son las que el Anexo 1 deja sin definir.
    afirmar(! NivelDano::permite('MAMPOSTERIA', 'PLACA_PISO', 'LEVE'), 'placa de piso no tiene leve');
    afirmar(! NivelDano::permite('MAMPOSTERIA', 'ELECTRICAS', 'LEVE'), 'eléctricas de mampostería no tienen leve');
    afirmar(! NivelDano::permite('MADERA', 'MUROS_MADERA', 'LEVE'), 'muros en madera no tienen leve');
    afirmar(! NivelDano::permite('MADERA', 'ELECTRICAS', 'LEVE'), 'eléctricas de madera no tienen leve');

    // Y que no se pase de listo quitando de más.
    afirmarIgual(4, count(NivelDano::nivelesDe('MAMPOSTERIA', 'VIGAS_COLUMNAS')));
    afirmarIgual(3, count(NivelDano::nivelesDe('MAMPOSTERIA', 'PLACA_PISO')));
});

prueba('los elementos son los del formato, en su orden', function (): void {
    afirmarIgual(
        ['VIGAS_COLUMNAS', 'MUROS_CARGA', 'MUROS_DIVISORIOS', 'PLACA_PISO', 'CUBIERTA', 'HIDROSANITARIAS', 'ELECTRICAS'],
        NivelDano::elementos('MAMPOSTERIA')
    );
    afirmarIgual(
        ['VIGAS_COLUMNAS', 'ENTREPISOS', 'MUROS_MADERA', 'CUBIERTA', 'HIDROSANITARIAS', 'ELECTRICAS'],
        NivelDano::elementos('MADERA')
    );
});

prueba('los niveles se ordenan de leve a colapso, venga como venga el anexo', function (): void {
    afirmarIgual(['MODERADO', 'SEVERO', 'COLAPSO_TOTAL'], NivelDano::nivelesDe('MADERA', 'ELECTRICAS'));
});

prueba('peor() ordena por gravedad y trata null como sin daño', function (): void {
    afirmarIgual('SEVERO', NivelDano::peor('LEVE', 'SEVERO'));
    afirmarIgual('SEVERO', NivelDano::peor('SEVERO', 'LEVE'));
    afirmarIgual('COLAPSO_TOTAL', NivelDano::peor('SEVERO', 'COLAPSO_TOTAL'));
    afirmarIgual('LEVE', NivelDano::peor(null, 'LEVE'));
    afirmarIgual(null, NivelDano::peor(null, null));
});

prueba('el texto duplicado del original quedó corregido', function (): void {
    $d = NivelDano::descriptores('MADERA', 'HIDROSANITARIAS', 'MODERADO');
    afirmarIgual(['Fisuras o roturas en la tubería', 'Desacople de los accesorios de la tubería'], $d);
});

// ── Inspección de viviendas: el combo del numeral 6 ──────────────────────────

grupo('Inspección › combo de materiales (numeral 6)');

prueba('el combo lo fija el sistema estructural, no el peor daño de la casa', function (): void {
    // El caso que la regla del formato existe para resolver: cubierta destruida
    // sobre estructura apenas fisurada. Entregar un combo severo aquí sería
    // entregar materiales que no se necesitan.
    $r = BancoMateriales::determinar('MAMPOSTERIA', [
        'VIGAS_COLUMNAS' => 'LEVE',
        'MUROS_CARGA' => 'LEVE',
        'CUBIERTA' => 'COLAPSO_TOTAL',
        'HIDROSANITARIAS' => 'SEVERO',
    ]);

    afirmarIgual('COMBO_1', $r['combo']);
    afirmarIgual('LEVE', $r['nivel']);
});

prueba('entre los estructurales manda el peor', function (): void {
    $r = BancoMateriales::determinar('MAMPOSTERIA', ['VIGAS_COLUMNAS' => 'LEVE', 'MUROS_CARGA' => 'SEVERO']);

    afirmarIgual('COMBO_3', $r['combo']);
    afirmar(str_contains($r['motivo'], 'muros de carga'), "el motivo debe decir quién decidió: {$r['motivo']}");
});

prueba('cada sistema tiene sus propios combos', function (): void {
    afirmarIgual('COMBO_2', BancoMateriales::determinar('MAMPOSTERIA', ['VIGAS_COLUMNAS' => 'MODERADO'])['combo']);
    afirmarIgual('COMBO_5', BancoMateriales::determinar('MADERA', ['VIGAS_COLUMNAS' => 'MODERADO'])['combo']);
});

prueba('el colapso total manda sobre la tabla por elementos', function (): void {
    // «Si la vivienda sufrió colapso estructural total, marque solo esta casilla».
    $r = BancoMateriales::determinar('MAMPOSTERIA', ['VIGAS_COLUMNAS' => 'LEVE'], true);

    afirmarIgual('COLAPSO_MAMPOSTERIA', $r['combo']);
    afirmarIgual('COLAPSO_TOTAL', $r['nivel']);
});

prueba('sin daño estructural no corresponde combo', function (): void {
    // Y se dice por qué, en vez de devolver un vacío que parezca un error.
    $r = BancoMateriales::determinar('MADERA', ['CUBIERTA' => 'SEVERO']);

    afirmarIgual(null, $r['combo']);
    afirmar(str_contains($r['motivo'], 'no resultó afectado'), $r['motivo']);
});

prueba('en madera no se busca un muro de carga que no existe', function (): void {
    $r = BancoMateriales::determinar('MADERA', ['MUROS_MADERA' => 'COLAPSO_TOTAL', 'VIGAS_COLUMNAS' => 'LEVE']);

    afirmarIgual('COMBO_4', $r['combo']);
});

grupo('Inspección › lista de materiales (Anexo 2)');

prueba('el nivel filtra los ítems que lleva cada kit', function (): void {
    // Cotejado contra el impreso: en mampostería leve, el kit de estructura
    // solo lleva cemento; las varillas aparecen desde moderado.
    $leve = BancoMateriales::materiales('MAMPOSTERIA', 'LEVE');
    $estructura = $leve['kits'][0];

    afirmarIgual('Kit Estructura tipo concreto (Vigas, columnas, placas de piso)', $estructura['kit']);
    afirmarIgual(1, count($estructura['items']));
    afirmarIgual('Cemento Bulto 50 Kg', $estructura['items'][0]['descripcion']);
    afirmarIgual('5', $estructura['items'][0]['cantidad']);
});

prueba('las cantidades del anexo se conservan al pie de la letra', function (): void {
    $severo = BancoMateriales::materiales('MAMPOSTERIA', 'SEVERO');

    // Se busca dentro de su kit, no en una lista aplanada: ver la prueba
    // siguiente, que explica por qué aplanar pierde información.
    $cantidad = static function (array $r, string $kit, string $item): ?string {
        foreach ($r['kits'] as $k) {
            if ($k['kit'] !== $kit) {
                continue;
            }
            foreach ($k['items'] as $i) {
                if ($i['descripcion'] === $item) {
                    return $i['cantidad'];
                }
            }
        }

        return null;
    };

    afirmarIgual('2050', $cantidad($severo, 'Kit Mampostería adobe macizo', 'Ladrillo tolete común'));
    afirmarIgual('67', $cantidad($severo, 'Kit Estructura tipo concreto (Vigas, columnas, placas de piso)', 'Varilla de 1/4" L=6M'));
    afirmarIgual('50', $cantidad($severo, 'Kit Eléctrico', 'Cable 10 AWG - THW'));
});

prueba('el mismo material puede ir en dos kits con cantidades distintas', function (): void {
    // El cemento aparece en el kit de estructura (25 bultos en severo) y otra
    // vez en el de mampostería (21). Son partidas distintas del mismo anexo.
    //
    // Esto fija que la lista NO se puede aplanar por descripción: hacerlo
    // borraría una de las dos y el almacén entregaría 21 bultos donde hacen
    // falta 46. Lo descubrió esta misma prueba al escribirse mal la primera vez.
    $severo = BancoMateriales::materiales('MAMPOSTERIA', 'SEVERO');
    $cementos = [];

    foreach ($severo['kits'] as $k) {
        foreach ($k['items'] as $i) {
            if ($i['descripcion'] === 'Cemento Bulto 50 Kg') {
                $cementos[$k['kit']] = $i['cantidad'];
            }
        }
    }

    afirmarIgual(2, count($cementos), 'el cemento va en dos kits');
    afirmarIgual('25', $cementos['Kit Estructura tipo concreto (Vigas, columnas, placas de piso)']);
    afirmarIgual('21', $cementos['Kit Mampostería adobe macizo']);
});

prueba('el kit de cubierta se suma solo si se eligió', function (): void {
    $sin = BancoMateriales::contarItems('MAMPOSTERIA', 'SEVERO');
    $con = BancoMateriales::contarItems('MAMPOSTERIA', 'SEVERO', 'ZINC');

    afirmarIgual(4, $con - $sin, 'el kit de zinc trae cuatro renglones');
});

prueba('un cero escrito en el original es «no lleva»', function (): void {
    // En madera, el tanque de agua está como 0 en leve y moderado, y como 1 en
    // severo. Un cero impreso en una orden de entrega se lee como error.
    $nombres = static function (string $nivel): array {
        $out = [];
        foreach (BancoMateriales::materiales('MADERA', $nivel)['kits'] as $k) {
            foreach ($k['items'] as $i) {
                $out[] = $i['descripcion'];
            }
        }

        return $out;
    };

    afirmar(! in_array('Tanque de agua 500 L', $nombres('LEVE'), true), 'no debe aparecer en leve');
    afirmar(in_array('Tanque de agua 500 L', $nombres('SEVERO'), true), 'sí en severo');
});

prueba('en madera no se ofrece fibrocemento', function (): void {
    // No es un olvido del anexo: el fibrocemento pesa más de lo que sostiene
    // una estructura de madera de este tipo.
    afirmarIgual(['ZINC'], array_keys(BancoMateriales::KITS_CUBIERTA['MADERA']));
    afirmarIgual(0, BancoMateriales::contarItems('MADERA', 'SEVERO', 'FIBROCEMENTO')
        - BancoMateriales::contarItems('MADERA', 'SEVERO'));
});

prueba('el colapso total se declara sin lista, no se rellena con la del severo', function (): void {
    // El Anexo 2 solo trae columnas leve, moderado y severo. Inventar
    // cantidades para el colapso pondría cifras falsas en una orden de entrega
    // de materiales públicos, indistinguibles de las buenas al imprimirlas.
    $r = BancoMateriales::materiales('MAMPOSTERIA', 'COLAPSO_TOTAL');

    afirmarIgual([], $r['kits']);
    afirmar($r['sin_lista'], 'debe declararse sin lista');
    afirmar(str_contains($r['nota'], 'Anexo 2 no define'), $r['nota']);
});

grupo('Inspección › tabla de casos compartida');

prueba('el servidor resuelve los 21 casos de combos.json', function (): void {
    // La MISMA tabla la ejecuta `frontend/src/lib/inspeccion-form/combo.spec.ts`.
    // Si alguien cambia una implementación y no la otra, falla una de las dos
    // suites. Sin esto divergirían en silencio, y de este cálculo depende una
    // entrega de materiales públicos.
    $ruta = __DIR__.'/fixtures/combos.json';
    afirmar(is_file($ruta), 'falta la tabla de casos compartida');

    $casos = json_decode((string) file_get_contents($ruta), true)['casos'];
    afirmar(count($casos) >= 20, 'la tabla no debería encogerse');

    foreach ($casos as $caso) {
        $r = BancoMateriales::determinar(
            $caso['sistema'],
            $caso['danos'],
            $caso['colapso_total'] ?? false
        );
        $e = $caso['espera'];

        afirmarIgual($e['combo'], $r['combo'], $caso['nombre']);
        afirmarIgual($e['nivel'], $r['nivel'], $caso['nombre'].' (nivel)');

        $elemento = BancoMateriales::nivelEstructural($caso['sistema'], $caso['danos'])['elemento'];
        if (! ($caso['colapso_total'] ?? false)) {
            afirmarIgual($e['elemento'], $elemento, $caso['nombre'].' (quién decidió)');
        }
    }
});

prueba('los fixtures del Anexo 2 siguen al día', function () use ($raiz): void {
    // Cierra el círculo con la prueba del navegador
    // (`frontend/src/lib/inspeccion-form/materiales.spec.ts`), que comprueba su
    // filtro contra estos mismos archivos:
    //
    //   • si se toca el anexo en PHP y no se regeneran, falla AQUÍ;
    //   • si se regeneran y el filtro del navegador no coincide, falla ALLÁ.
    //
    // Sin esto, el teléfono podría mostrar una lista de materiales y el
    // expediente guardar otra, y nadie se enteraría hasta el almacén.
    $anexo = (string) file_get_contents($raiz.'/tests/fixtures/anexo2.json');
    afirmarIgual(
        json_decode($anexo, true),
        BancoMateriales::anexo2ParaApi(),
        'regenere tests/fixtures/anexo2.json'
    );

    $esperado = json_decode((string) file_get_contents($raiz.'/tests/fixtures/materiales.json'), true);

    foreach ($esperado['casos'] as $caso) {
        $r = BancoMateriales::materiales($caso['sistema'], $caso['nivel'], $caso['kit']);
        $total = array_sum(array_map(static fn (array $k): int => count($k['items']), $r['kits']));

        afirmarIgual($caso['total'], $total, "{$caso['sistema']}/{$caso['nivel']}");
        afirmarIgual($caso['sin_lista'], $r['sin_lista'], "{$caso['sistema']}/{$caso['nivel']} sin_lista");
        afirmarIgual($caso['kits'], array_map(static fn (array $k): string => $k['kit'], $r['kits']));
    }
});

grupo('Inspección › catálogos');

prueba('el formulario se puede dibujar entero con una sola respuesta', function (): void {
    // Tiene que caber en la caché del teléfono: en la vereda no hay segunda
    // petición que valga.
    $c = CatalogosInspeccion::paraApi();

    foreach (['eventos', 'requisitos', 'convenciones', 'evaluacion', 'kits_cubierta', 'parentescos'] as $clave) {
        afirmar(($c[$clave] ?? []) !== [], "falta «{$clave}» en los catálogos");
    }

    afirmar(strlen(json_encode($c)) < 60000, 'los catálogos no deberían pasar de unas decenas de KB');
});

prueba('la evaluación viaja con los criterios de cada nivel', function (): void {
    $mamposteria = CatalogosInspeccion::paraApi()['evaluacion']['MAMPOSTERIA'];
    $placa = null;

    foreach ($mamposteria as $e) {
        if ($e['codigo'] === 'PLACA_PISO') {
            $placa = $e;
        }
    }

    afirmar($placa !== null, 'debe venir la placa de piso');
    afirmarIgual(3, count($placa['niveles']), 'la placa no tiene nivel leve');
    afirmarIgual('MODERADO', $placa['niveles'][0]['codigo']);
    afirmar($placa['niveles'][0]['criterios'] !== [], 'cada nivel viaja con sus criterios');
    afirmar(! $placa['estructural'], 'la placa de piso no decide el combo');
});

prueba('los estructurales vienen marcados, que son los que deciden el combo', function (): void {
    $marcados = [];
    foreach (CatalogosInspeccion::paraApi()['evaluacion']['MAMPOSTERIA'] as $e) {
        if ($e['estructural']) {
            $marcados[] = $e['codigo'];
        }
    }

    afirmarIgual(['VIGAS_COLUMNAS', 'MUROS_CARGA'], $marcados);
});

prueba('no se inventa un código de formato que la entidad no ha asignado', function (): void {
    afirmarIgual('', CatalogosInspeccion::FORMATO_CODIGO);
});

prueba('el municipio y los corregimientos son los mismos del RUFE', function (): void {
    // Dos listas de corregimientos acabarían teniendo una un sector que la otra
    // no, y el mismo predio saldría en dos sitios distintos.
    afirmarIgual(Catalogos::MUNICIPIO, CatalogosInspeccion::MUNICIPIO);
    afirmarIgual(Catalogos::CORREGIMIENTOS, CatalogosInspeccion::paraApi()['corregimientos']);
});

prueba('el material de la cubierta sugiere su kit', function (): void {
    afirmarIgual('ZINC', CatalogosInspeccion::KIT_SUGERIDO['Z']);
    afirmarIgual('FIBROCEMENTO', CatalogosInspeccion::KIT_SUGERIDO['Ac']);
    afirmar(! isset(CatalogosInspeccion::KIT_SUGERIDO['M']), 'una cubierta de madera no sugiere kit');
});

prueba('las convenciones distinguen madera de mampostería en estructura', function (): void {
    // «M» es madera en las cuatro categorías; la mampostería es «Ma». Meterlas
    // en una sola tabla de letras las confundiría.
    afirmar(CatalogosInspeccion::esMaterialValido('ESTRUCTURA', 'Ma'), 'Ma es mampostería');
    afirmar(CatalogosInspeccion::esMaterialValido('ESTRUCTURA', 'M'), 'M es madera');
    afirmar(! CatalogosInspeccion::esMaterialValido('PISOS', 'Ma'), 'Ma no es un piso');
    afirmar(! CatalogosInspeccion::esMaterialValido('MUROS_DIVISORIOS', 'Z'), 'Z no es un muro');
});

// ── Inspección de viviendas: el validador ────────────────────────────────────

grupo('Inspección › validación');

/** Una inspección mínima y válida, con los tres requisitos en sí. */
function inspeccionBase(array $cambios = []): array
{
    return array_replace([
        'fecha_evaluacion' => date('Y-m-d'),
        'profesional_nombre' => 'Ana Ruiz',
        'profesional_tarjeta' => 'CO-12345',
        'profesional_profesion' => 'INGENIERO_CIVIL',
        'profesional_documento' => '31234567',
        'profesional_telefono' => '3151234567',
        'propietario_nombres' => 'Pedro Pérez Gómez',
        'propietario_documento' => '16234567',
        'direccion_cabecera' => 'Carrera 11 # 8-26',
        'requisitos' => ['NO_BENEFICIARIO' => true, 'PROPIETARIO' => true, 'NO_ALTO_RIESGO' => true],
        'evento' => 'SISMO',
        'sistema_constructivo' => 'MAMPOSTERIA',
        'infraestructura' => ['MUROS_DIVISORIOS' => 'L', 'PISOS' => 'C', 'ESTRUCTURA' => 'Co', 'CUBIERTA' => 'Z'],
        'danos' => [
            'VIGAS_COLUMNAS' => ['afectado' => true, 'nivel' => 'MODERADO'],
            'MUROS_CARGA' => ['afectado' => false],
            'MUROS_DIVISORIOS' => ['afectado' => false],
            'PLACA_PISO' => ['afectado' => false],
            'CUBIERTA' => ['afectado' => true, 'nivel' => 'LEVE'],
            'HIDROSANITARIAS' => ['afectado' => false],
            'ELECTRICAS' => ['afectado' => false],
        ],
        'requiere_evacuacion' => false,
        'kit_cubierta' => 'ZINC',
        'informante_nombre' => 'María Pérez',
        'informante_documento' => '1144567890',
        'informante_parentesco' => 3,
        'aprobacion_profesional' => 'Ana Ruiz',
    ], $cambios);
}

function erroresInspeccion(array $entrada): array
{
    return ValidadorInspeccion::inspeccion($entrada)['errores'];
}

function datosInspeccion(array $entrada): array
{
    return ValidadorInspeccion::inspeccion($entrada)['datos'];
}

prueba('una inspección completa pasa sin errores', function (): void {
    afirmarIgual([], erroresInspeccion(inspeccionBase()));
});

prueba('el numeral 9 ya no se diligencia en campo', function (): void {
    // Quien levanta la ficha no puede aprobarla en el mismo acto: de ella
    // depende una entrega de materiales públicos. La decisión se toma después,
    // sobre la ficha guardada, con el mecanismo de estados.
    $base = inspeccionBase();
    unset($base['aprobacion_profesional']);

    afirmarIgual([], erroresInspeccion($base));
});

prueba('una ficha que sí trae el numeral 9 lo conserva', function (): void {
    // Las inspecciones ya levantadas lo llevan y el PDF lo imprime. Dejar de
    // exigirlo no es lo mismo que empezar a descartarlo.
    $d = datosInspeccion(inspeccionBase(['aprobacion_coordinador' => 'Carlos Alberto Gil']));

    afirmarIgual('Ana Ruiz', $d['aprobacion_profesional']);
    afirmarIgual('Carlos Alberto Gil', $d['aprobacion_coordinador']);
});

prueba('la inspección guarda el punto GPS cuando se toma', function (): void {
    // La misma ubicación que ya toma el censo. Sin ella, «finca La Esperanza,
    // vía a Potrerito» es imposible de encontrar dos semanas después con un
    // camión de materiales.
    $d = datosInspeccion(inspeccionBase([
        'latitud' => 3.2611234,
        'longitud' => -76.5412345,
        'precision_m' => 12,
    ]));

    afirmarIgual(3.2611234, $d['latitud']);
    afirmarIgual(-76.5412345, $d['longitud']);
    afirmarIgual(12, $d['precision_m']);
});

prueba('sin ubicación la inspección sigue siendo válida', function (): void {
    // Tomarla es opcional: bajo un techo de zinc entre montañas el GPS no
    // engancha, y la visita no se puede detener por eso.
    $r = ValidadorInspeccion::inspeccion(inspeccionBase());

    afirmarIgual([], $r['errores']);
    afirmarIgual(null, $r['datos']['latitud']);
    afirmarIgual(null, $r['datos']['precision_m']);
});

prueba('una ubicación fuera de Colombia se descarta, no tumba la ficha', function (): void {
    // Un GPS que devuelve Madrid es un GPS averiado. Lo que no puede pasar es
    // que por eso se pierda una inspección ya diligenciada entera.
    $e = erroresInspeccion(inspeccionBase(['latitud' => 40.4168, 'longitud' => -3.7038]));

    afirmar(isset($e['latitud']), 'debe avisar de la ubicación imposible');
    afirmar(! isset($e['direccion_cabecera']), 'no debe arrastrar el resto del formulario');
});

prueba('una precisión absurda se ignora, pero el punto se conserva', function (): void {
    $d = datosInspeccion(inspeccionBase([
        'latitud' => 3.2611,
        'longitud' => -76.5412,
        'precision_m' => 999999,
    ]));

    afirmarIgual(null, $d['precision_m']);
    afirmarIgual(3.2611, $d['latitud']);
});

prueba('la profesión se guarda resuelta, no como código', function (): void {
    // Lo que va al papel y al expediente es el nombre de la profesión: un
    // «INGENIERO_CIVIL» impreso en un formato oficial no lo lee nadie.
    $d = datosInspeccion(inspeccionBase());

    afirmarIgual('Ingeniero(a) civil', $d['profesional_profesion']);
});

prueba('una profesión fuera de la lista se rechaza', function (): void {
    $e = erroresInspeccion(inspeccionBase(['profesional_profesion' => 'ASTRONAUTA']));

    afirmar(isset($e['profesional_profesion']), 'debe exigir una de la lista');
});

prueba('«Otra» guarda lo que escribió el profesional', function (): void {
    $d = datosInspeccion(inspeccionBase([
        'profesional_profesion' => 'OTRA',
        'profesional_profesion_otra' => 'Ingeniera sanitaria',
    ]));

    afirmarIgual('Ingeniera sanitaria', $d['profesional_profesion']);
});

prueba('«Otra» sin decir cuál no pasa', function (): void {
    $e = erroresInspeccion(inspeccionBase(['profesional_profesion' => 'OTRA']));

    afirmar(isset($e['profesional_profesion_otra']), 'falta decir cuál');
});

prueba('un texto libre con una profesión de la lista se rechaza', function (): void {
    // Significaría que el formulario y el servidor no están de acuerdo; guardarlo
    // dejaría un dato que nadie puede volver a ver ni corregir.
    $e = erroresInspeccion(inspeccionBase([
        'profesional_profesion' => 'ARQUITECTO',
        'profesional_profesion_otra' => 'Ingeniera sanitaria',
    ]));

    afirmar(isset($e['profesional_profesion_otra']), 'solo aplica con "Otra"');
});

prueba('las profesiones son las que pueden firmar una inspección', function (): void {
    // El formato exige tarjeta profesional en el renglón de al lado: solo caben
    // profesiones con matrícula que habilite para evaluar daño estructural.
    $codigos = array_keys(CatalogosInspeccion::PROFESIONES);

    foreach (['ARQUITECTO', 'INGENIERO_CIVIL', 'INGENIERO_ESTRUCTURAL', 'OTRA'] as $esperado) {
        afirmar(in_array($esperado, $codigos, true), "falta {$esperado}");
    }

    afirmarIgual('OTRA', end($codigos), '«Otra» va al final de la lista');
});

prueba('el combo se calcula aquí y no se acepta del cliente', function (): void {
    // Aunque el navegador mande un combo distinto, manda el del servidor: de
    // este número depende cuántos materiales recibe una familia.
    $d = datosInspeccion(inspeccionBase(['combo' => 'COMBO_3', 'combo_nivel' => 'SEVERO']));

    afirmarIgual('COMBO_2', $d['combo']);
    afirmarIgual('MODERADO', $d['combo_nivel']);
    afirmar(str_contains($d['combo_motivo'], 'vigas y columnas'), $d['combo_motivo']);
});

prueba('la lista de materiales queda resuelta en el expediente', function (): void {
    $d = datosInspeccion(inspeccionBase());

    afirmar($d['materiales']['kits'] !== [], 'debe traer los materiales del combo 2');
    afirmar(! $d['materiales']['sin_lista'], 'el combo 2 sí tiene lista');
});

prueba('el numeral 4 se deriva, no se acepta', function (): void {
    $d = datosInspeccion(inspeccionBase([
        'requisitos' => ['NO_BENEFICIARIO' => true, 'PROPIETARIO' => false, 'NO_ALTO_RIESGO' => true],
        'cumple_requisitos' => true,
        'evento' => '', 'sistema_constructivo' => '', 'danos' => [], 'kit_cubierta' => '',
        'informante_nombre' => '',
        'acta_modalidad' => 'REHABILITACION',
        'acta_nombre' => 'Pedro Pérez Gómez',
        'acta_documento' => '16234567',
    ]));

    afirmarIgual(false, $d['cumple_requisitos']);
});

prueba('un requisito sin contestar no se toma por un no', function (): void {
    // «Sin contestar» y «no cumple» son cosas distintas: la segunda cierra la
    // puerta al banco de materiales y la primera solo significa que falta.
    $e = erroresInspeccion(inspeccionBase([
        'requisitos' => ['NO_BENEFICIARIO' => true, 'NO_ALTO_RIESGO' => true],
    ]));

    afirmar(isset($e['requisitos.PROPIETARIO']), 'debe pedir que se conteste');
});

prueba('sin cumplir requisitos no se admite evaluación técnica', function (): void {
    // «No se continúa con la inspección de la vivienda, pasar al numeral 8».
    $e = erroresInspeccion(inspeccionBase([
        'requisitos' => ['NO_BENEFICIARIO' => true, 'PROPIETARIO' => false, 'NO_ALTO_RIESGO' => true],
        'acta_modalidad' => 'REHABILITACION',
        'acta_nombre' => 'Pedro Pérez Gómez',
        'acta_documento' => '16234567',
    ]));

    afirmar(isset($e['sistema_constructivo']) || isset($e['evento']) || isset($e['danos']),
        'la rama de inspección no debe aceptarse');
});

prueba('quien cumple no puede mandar además un acta', function (): void {
    $e = erroresInspeccion(inspeccionBase(['acta_nombre' => 'Pedro Pérez Gómez']));

    afirmar(isset($e['acta_nombre']), 'el acta no aplica cuando sí cumple');
});

prueba('un nivel que el Anexo 1 no define se rechaza aunque llegue a mano', function (): void {
    // Cierra el círculo: la pantalla no lo ofrece, y si alguien se la salta el
    // servidor tampoco lo acepta.
    $base = inspeccionBase();
    $base['danos']['PLACA_PISO'] = ['afectado' => true, 'nivel' => 'LEVE'];

    afirmar(isset(erroresInspeccion($base)['danos.PLACA_PISO.nivel']), 'la placa de piso no tiene nivel leve');
});

prueba('decir que fue afectado sin decir cuánto no pasa', function (): void {
    $base = inspeccionBase();
    $base['danos']['MUROS_CARGA'] = ['afectado' => true];

    afirmar(isset(erroresInspeccion($base)['danos.MUROS_CARGA.nivel']), 'falta el nivel');
});

prueba('cada elemento del sistema tiene que contestarse', function (): void {
    $base = inspeccionBase();
    unset($base['danos']['CUBIERTA']);

    afirmar(isset(erroresInspeccion($base)['danos.CUBIERTA.afectado']), 'no se puede dejar sin contestar');
});

prueba('la tabla del otro sistema constructivo se rechaza', function (): void {
    $base = inspeccionBase(['sistema_constructivo' => 'MADERA']);

    afirmar(isset(erroresInspeccion($base)['danos']), 'trae elementos de mampostería');
});

prueba('con colapso total no se admite la tabla por elementos', function (): void {
    // «Marque solo esta casilla». Una tabla llena al lado significa que alguien
    // entendió mal el formato, y hay que decirlo antes de que se firme.
    $e = erroresInspeccion(inspeccionBase(['colapso_total' => true]));

    afirmar(isset($e['danos']), 'no se llena la tabla con colapso total');
});

prueba('el colapso total da su combo sin necesidad de la tabla', function (): void {
    $d = datosInspeccion(inspeccionBase(['colapso_total' => true, 'danos' => []]));

    afirmarIgual('COLAPSO_MAMPOSTERIA', $d['combo']);
    afirmar($d['materiales']['sin_lista'], 'el Anexo 2 no lista materiales para colapso');
});

prueba('un kit de cubierta imposible en ese sistema se rechaza', function (): void {
    $base = inspeccionBase([
        'sistema_constructivo' => 'MADERA',
        'kit_cubierta' => 'FIBROCEMENTO',
        'danos' => [
            'VIGAS_COLUMNAS' => ['afectado' => true, 'nivel' => 'LEVE'],
            'ENTREPISOS' => ['afectado' => false],
            'MUROS_MADERA' => ['afectado' => false],
            'CUBIERTA' => ['afectado' => false],
            'HIDROSANITARIAS' => ['afectado' => false],
            'ELECTRICAS' => ['afectado' => false],
        ],
    ]);

    afirmar(isset(erroresInspeccion($base)['kit_cubierta']), 'en madera no hay fibrocemento');
});

prueba('una convención que no es de esa categoría se rechaza', function (): void {
    $base = inspeccionBase();
    $base['infraestructura']['PISOS'] = 'Ma';

    afirmar(isset(erroresInspeccion($base)['infraestructura.PISOS']), 'Ma no es un piso');
});

prueba('sin ninguna forma de ubicar la vivienda no se acepta', function (): void {
    $e = erroresInspeccion(inspeccionBase(['direccion_cabecera' => '', 'corregimiento' => '', 'vereda' => '']));

    afirmar(isset($e['direccion_cabecera']), 'hay que poder llegar al predio');
});

prueba('una vivienda rural se ubica por corregimiento y vereda', function (): void {
    $e = erroresInspeccion(inspeccionBase([
        'direccion_cabecera' => '',
        'corregimiento' => Catalogos::CORREGIMIENTOS[0],
        'vereda' => 'La Ventura',
    ]));

    afirmarIgual([], $e);
});

prueba('la fecha de evaluación no puede ser de mañana', function (): void {
    $e = erroresInspeccion(inspeccionBase(['fecha_evaluacion' => date('Y-m-d', strtotime('+1 day'))]));

    afirmar(isset($e['fecha_evaluacion']), 'no se inspecciona en el futuro');
});

prueba('el departamento y el municipio los pone el servidor', function (): void {
    $d = datosInspeccion(inspeccionBase(['departamento' => 'Antioquia', 'municipio' => 'Medellín']));

    afirmarIgual('Valle del Cauca', $d['departamento']);
    afirmarIgual('Jamundí', $d['municipio']);
});

prueba('la aprobación del coordinador puede quedar para después', function (): void {
    // Suele firmarse en la oficina; exigirla en campo dejaría la ficha sin cerrar.
    afirmarIgual([], erroresInspeccion(inspeccionBase(['aprobacion_coordinador' => ''])));
});

grupo('Inspección › número de ficha');

prueba('el formato es INSP-AAAA-XXXXXX y cabe en la casilla del papel', function (): void {
    // Seis caracteres: la casilla «Ficha No.» del formato mide 26 puntos y con
    // ocho el número solo cabía en letra de 4,5 pt, ilegible impresa.
    $n = Numero::componer(2026);

    afirmar(Numero::esValido($n), $n);
    afirmarIgual(16, strlen($n));
    afirmar(str_starts_with($n, 'INSP-2026-'), $n);
    afirmar(! Radicado::esValido($n), 'no debe pasar por un radicado del censo');
});

prueba('no usa letras que se confunden al dictarlas', function (): void {
    // Crockford Base32: sin I, L, O ni U. Estos números se dictan por teléfono.
    for ($i = 0; $i < 60; $i++) {
        $sufijo = substr(Numero::componer(), 10);
        afirmar(preg_match('/[ILOU]/', $sufijo) === 0, "salió una letra confundible: {$sufijo}");
    }
});

prueba('no es correlativo: dos seguidos no se parecen', function (): void {
    // Un consecutivo diría cuántas inspecciones lleva el municipio y dejaría
    // adivinar el número de la vivienda de al lado.
    $vistos = [];
    for ($i = 0; $i < 50; $i++) {
        $vistos[] = Numero::componer();
    }

    afirmarIgual(50, count(array_unique($vistos)), 'salieron números repetidos');
});

prueba('la huella ignora mayúsculas y espacios de más en la dirección', function (): void {
    $a = Numero::huella('2026-08-20', 'Carrera 11 # 8-26', '16234567');
    $b = Numero::huella('2026-08-20', '  carrera   11 # 8-26 ', '16234567');

    afirmarIgual($a, $b, 'la misma vivienda debe dar la misma huella');
});

prueba('la huella distingue propietario y fecha', function (): void {
    $base = Numero::huella('2026-08-20', 'Carrera 11 # 8-26', '16234567');

    afirmar($base !== Numero::huella('2026-09-01', 'Carrera 11 # 8-26', '16234567'), 'otra fecha, otra huella');
    afirmar($base !== Numero::huella('2026-08-20', 'Carrera 11 # 8-26', '99999999'), 'otro propietario, otra huella');
});

grupo('Rutas › que ninguna apunte a un método inexistente');

prueba('todas las rutas resuelven a un método que existe', function () use ($raiz): void {
    // Esto no es celo de más: el 18 de agosto de 2026 una ruta quedó registrada
    // contra un método que no llegó a escribirse, y el TypeError al construir el
    // router tumbó TODAS las peticiones de la API, no solo la suya. El sitio
    // entero devolvió 500 hasta que se quitó la línea.
    $php = (string) file_get_contents($raiz.'/public/index.php');

    // Qué controlador hay detrás de cada variable: `$rufe = new RufeController;`
    preg_match_all('/\$(\w+)\s*=\s*new\s+(\w+);/', $php, $vars, PREG_SET_ORDER);
    $clase = [];
    foreach ($vars as $v) {
        $clase[$v[1]] = 'App\\Controllers\\'.$v[2];
    }

    // Y qué método pide cada ruta: `[$rufe, 'listar']`
    preg_match_all("/\[\\\$(\w+),\s*'(\w+)'\]/", $php, $rutas, PREG_SET_ORDER);
    afirmar(count($rutas) >= 30, 'se esperaban al menos 30 rutas, se leyeron '.count($rutas));

    foreach ($rutas as $r) {
        [$todo, $variable, $metodo] = $r;

        afirmar(isset($clase[$variable]), "la ruta usa \${$variable}, que no se instancia");
        afirmar(class_exists($clase[$variable]), "no existe la clase {$clase[$variable]}");
        afirmar(
            method_exists($clase[$variable], $metodo),
            "{$clase[$variable]}::{$metodo}() no existe — registrarla tumbaría TODA la API"
        );
    }
});

grupo('Rutas › hasta dónde llega el inspector de vivienda');

/**
 * Las rutas de `index.php` con la lista de roles que las protege, ya resuelta.
 *
 * Se lee el archivo en vez de consultar el router porque lo que hay que
 * comprobar es lo que está escrito ahí: una ruta con la constante equivocada no
 * da ningún error, simplemente abre datos a quien no debe verlos.
 *
 * @return array<string,string[]> «MÉTODO ruta» => roles
 */
function rutasConSusRoles(string $raiz): array
{
    $php = (string) file_get_contents($raiz.'/public/index.php');

    $listas = [
        'Auth::TODOS'         => Auth::TODOS,
        'Auth::ESCRITURA'     => Auth::ESCRITURA,
        'Auth::LECTURA_RUFE'  => Auth::LECTURA_RUFE,
        'Auth::INSPECCION'    => Auth::INSPECCION,
        '$soloAdmin'          => [Auth::ADMINISTRADOR],
        '$capturaArchivos'    => array_values(array_unique(array_merge(Auth::ESCRITURA, Auth::INSPECCION))),
    ];

    preg_match_all(
        "/\\\$router->(get|post|put|delete)\\(\\s*'([^']+)'(.*?)\\);/s",
        $php,
        $encontradas,
        PREG_SET_ORDER
    );

    $salida = [];

    foreach ($encontradas as $r) {
        // El último argumento, cuando lo hay, es la lista de roles. Sin él la
        // ruta es pública —solo `/health` y `/auth/login`— y se omite.
        if (preg_match('/,\s*([A-Za-z_:$\\\\]+)\s*$/', trim($r[3]), $m) !== 1) {
            continue;
        }

        $salida[strtoupper($r[1]).' '.$r[2]] = $listas[trim($m[1])] ?? [];
    }

    return $salida;
}

prueba('borrar una solicitud ciudadana es solo del administrador', function () use ($raiz): void {
    // Es la única operación del sistema que destruye datos de un ciudadano y no
    // se deshace. El Gestor puede descartarla —lo que necesita para trabajar—
    // pero no hacerla desaparecer, y el Visualización ni siquiera eso.
    $roles = rutasConSusRoles($raiz)['DELETE /preinscripcion/fichas/{id}'] ?? null;

    afirmar($roles !== null, 'la ruta de borrado debe existir y declarar sus roles');
    afirmarIgual([App\Core\Auth::ADMINISTRADOR], $roles);
});

prueba('las rutas de archivos se leen ANTES de borrar la fila', function () use ($raiz): void {
    // Las claves foráneas se llevan las filas en cascada pero no tocan el disco.
    // Si se borrara primero la solicitud, ya no habría forma de saber qué
    // archivos borrar: la foto de la cédula de una persona se quedaría en el
    // servidor para siempre, sin ninguna fila que la nombrara y sin nadie que
    // supiera que está ahí.
    $fuente = (string) file_get_contents($raiz.'/src/Controllers/PreinscripcionController.php');
    $metodo = substr($fuente, strpos($fuente, 'public function eliminar(Request'));
    $metodo = substr($metodo, 0, strpos($metodo, 'public function cambiarEstado('));

    $lectura = strpos($metodo, 'ruta_relativa');
    $borrado = strpos($metodo, 'DELETE FROM preinscripciones');

    afirmar($lectura !== false, 'debe recoger las rutas de los archivos');
    afirmar($borrado !== false, 'debe borrar la solicitud');
    afirmar($lectura < $borrado, 'las rutas se leen antes del DELETE, no después');
});

prueba('una solicitud ya convertida en inspección no se puede borrar', function () use ($raiz): void {
    // Ninguna ficha de inspección guarda de qué solicitud nació. Borrarla
    // dejaría una inspección —de la que depende una entrega de materiales— sin
    // nada que explique por qué se hizo esa visita.
    $fuente = (string) file_get_contents($raiz.'/src/Controllers/PreinscripcionController.php');
    $metodo = substr($fuente, strpos($fuente, 'public function eliminar(Request'));
    $metodo = substr($metodo, 0, strpos($metodo, 'public function cambiarEstado('));

    afirmar(
        str_contains($metodo, "'CONVERTIDA'"),
        'eliminar() debe negarse con una solicitud ya convertida'
    );
});

prueba('el inspector llega EXACTAMENTE a estas rutas y a ninguna más', function () use ($raiz): void {
    // La lista va escrita a mano a propósito. Derivarla del código haría que la
    // prueba dijera «sí» a cualquier cosa que el código dijera; escrita así,
    // añadir una ruta sin decidir su acceso rompe aquí y obliga a pensarlo.
    //
    // Lo que está en juego: las fichas del censo llevan nombres, cédulas y
    // direcciones de hogares damnificados. El profesional que inspecciona
    // viviendas —a menudo un contratista externo— no las necesita.
    $esperadas = [
        // Su sesión.
        'GET /auth/me',
        'POST /auth/logout',
        'POST /auth/password',
        // Información del sistema.
        'GET /acerca/sistema',
        'GET /acerca/actualizaciones',
        // Su formato.
        'GET /inspeccion/catalogos',
        'GET /inspeccion/duplicados',
        'POST /inspeccion/fichas',
        'GET /inspeccion/fichas',
        'GET /inspeccion/fichas/{id}',
        'GET /inspeccion/fichas/{id}/fotos/{foto}',
        // Las fotos del numeral 11 suben por las cargas, que comparte con el censo.
        'POST /rufe/cargas',
        'GET /rufe/cargas/{carga}/archivos',
        'POST /rufe/cargas/{carga}/archivos',
        'PUT /rufe/cargas/{carga}/archivos/{id}',
        'DELETE /rufe/cargas/{carga}/archivos/{id}',
    ];

    $alcanza = [];

    foreach (rutasConSusRoles($raiz) as $ruta => $roles) {
        if (in_array(Auth::INSPECTOR, $roles, true)) {
            $alcanza[] = $ruta;
        }
    }

    sort($esperadas);
    sort($alcanza);

    afirmarIgual($esperadas, $alcanza);
});

prueba('el inspector no puede aprobar una inspección', function () use ($raiz): void {
    // Sacamos la aprobación del formulario justo para que quien inspecciona no
    // se validara a sí mismo. Dejarle esta ruta lo desharía por otra puerta.
    $roles = rutasConSusRoles($raiz)['PUT /inspeccion/fichas/{id}/estado'] ?? null;

    afirmar($roles !== null, 'no se encontró la ruta de cambio de estado');
    afirmar(! in_array(Auth::INSPECTOR, $roles, true), 'el inspector NO puede decidir');
});

prueba('el inspector no ve ninguna ficha del censo ni el mapa', function () use ($raiz): void {
    foreach (rutasConSusRoles($raiz) as $ruta => $roles) {
        if (! str_contains($ruta, '/rufe/reportes') && ! str_contains($ruta, '/mapa/')) {
            continue;
        }

        afirmar(
            ! in_array(Auth::INSPECTOR, $roles, true),
            "el inspector alcanza «{$ruta}», que expone datos del censo"
        );
    }
});

prueba('todas las rutas se leyeron con una lista de roles conocida', function () use ($raiz): void {
    // Si aparece una constante nueva que `rutasConSusRoles` no sabe traducir,
    // esa ruta quedaría con la lista vacía y las pruebas de arriba dirían que
    // todo está bien sin haber mirado nada.
    $rutas = rutasConSusRoles($raiz);

    afirmar(count($rutas) >= 30, 'se leyeron solo '.count($rutas).' rutas');

    foreach ($rutas as $ruta => $roles) {
        afirmar($roles !== [], "«{$ruta}» se protege con una lista que la prueba no reconoce");
    }
});

prueba('los mismos roles en PHP, en la migración y en el navegador', function () use ($raiz): void {
    // Tres listas que tienen que decir lo mismo. Si se separan, aparece en el
    // menú un rol que la base rechaza al guardarlo, o al revés: un rol guardable
    // que el navegador no sabe dibujar y trata como si no tuviera permisos.
    $sql = (string) file_get_contents($raiz.'/database/sistema_02_rol_inspector.sql');
    preg_match("/MODIFY\s+COLUMN\s+rol\s+ENUM\s*\(([^)]*)\)/i", $sql, $m);
    preg_match_all("/'{2}([A-Z_]+)'{2}/", $m[1] ?? '', $enEnum);

    $ts = (string) file_get_contents($raiz.'/../frontend/src/lib/navigation.ts');
    preg_match('/export const ROLES = \{(.*?)\} as const;/s', $ts, $m2);
    preg_match_all("/(\w+):\s*'([A-Z_]+)'/", $m2[1] ?? '', $enTs);

    $php = Auth::ROLES;
    sort($php);

    $enum = $enEnum[1];
    sort($enum);

    $navegador = $enTs[2];
    sort($navegador);

    afirmarIgual($php, $enum, 'el ENUM de la migración no coincide con Auth::ROLES');
    afirmarIgual($php, $navegador, 'navigation.ts no coincide con Auth::ROLES');
});

prueba('cada rol tiene etiqueta y capacidades declaradas', function (): void {
    // Un rol sin descripción se cuela en el selector de usuarios sin decir qué
    // hace, y sin capacidades el frontend le esconde todo sin explicar por qué.
    foreach (Auth::ROLES as $rol) {
        afirmar(isset(Auth::DESCRIPCION_ROLES[$rol]), "«{$rol}» no tiene etiqueta ni descripción");
        afirmar(Auth::capacidades($rol) !== [], "«{$rol}» no declara ninguna capacidad");
    }
});

prueba('una ruta literal se registra antes que la que lleva un comodín', function () use ($raiz): void {
    // El router recorre las rutas EN ORDEN y se queda con la primera que casa.
    // Si `/{id}` se registrara antes que `/orden`, reordenar el catálogo
    // acabaría intentando editar una categoría con id «orden» —y el fallo se
    // vería solo al arrastrar una fila, no al desplegar.
    $php = (string) file_get_contents($raiz.'/public/index.php');

    $posOrden = strpos($php, "'/admin/categorias-video/orden'");
    $posId = strpos($php, "'/admin/categorias-video/{id}'");

    afirmar($posOrden !== false, 'no se encontró la ruta de reordenar');
    afirmar($posId !== false, 'no se encontró la ruta de editar');
    afirmar($posOrden < $posId, 'la ruta literal debe registrarse antes que la del comodín');
});

grupo('Rutas › qué queda abierto a internet');

/**
 * Las rutas registradas SIN lista de roles, es decir, públicas.
 *
 * @return list<string>
 */
function rutasPublicas(string $raiz): array
{
    $php = (string) file_get_contents($raiz.'/public/index.php');

    preg_match_all(
        "/\\\$router->(get|post|put|delete)\\(\\s*'([^']+)'(.*?)\\);/s",
        $php,
        $encontradas,
        PREG_SET_ORDER
    );

    $salida = [];

    foreach ($encontradas as $r) {
        // Con lista de roles al final, no es pública.
        if (preg_match('/,\s*([A-Za-z_:$\\\\]+)\s*$/', trim($r[3])) === 1) {
            continue;
        }

        $salida[] = strtoupper($r[1]).' '.$r[2];
    }

    sort($salida);

    return $salida;
}

prueba('solo estas rutas se sirven sin sesión', function () use ($raiz): void {
    // La lista va escrita a mano porque cada entrada amplía lo que un
    // desconocido puede tocar. Este sistema declaró desde el principio que todo
    // exige sesión; la pre-inscripción es la excepción deliberada, y tiene que
    // seguir siéndolo. Si aparece una ruta más, esto falla y obliga a pensarlo.
    afirmarIgual([
        'DELETE /preinscripcion/cargas/{carga}/archivos/{id}',
        'GET /health',
        'GET /preinscripcion/catalogos',
        'POST /auth/login',
        'POST /preinscripcion',
        'POST /preinscripcion/cargas',
        'POST /preinscripcion/cargas/{carga}/archivos',
        // El video se sube por trozos: el tope por archivo del hosting es 1 MiB
        // y uno de 30 segundos pesa unos 3 MB, así que no cabe de una vez.
        'POST /preinscripcion/cargas/{carga}/videos',
        'POST /preinscripcion/cargas/{carga}/videos/{id}/trozos',
    ], rutasPublicas($raiz));
});

prueba('el cupo de fotos de una solicitud ciudadana es acotado', function (): void {
    // Es una ruta de subida SIN sesión: cada foto de más es almacenamiento que
    // cualquiera en internet puede consumir.
    afirmarIgual(1, App\Rufe\Catalogos::TIPOS_EVIDENCIA['PRE_CEDULA']['maximo']);
    afirmarIgual(4, App\Rufe\Catalogos::TIPOS_EVIDENCIA['PRE_DANO']['maximo']);
});

prueba('sin sesión solo se pueden subir los dos tipos de la pre-inscripción', function (): void {
    // El tipo llega en la petición. Sin lista blanca, quien quisiera podría
    // pedir el cupo de diez fotos del registro fotográfico de una inspección.
    afirmarIgual(['PRE_CEDULA', 'PRE_DANO'], App\Rufe\Catalogos::TIPOS_PREINSCRIPCION);

    foreach (App\Rufe\Catalogos::TIPOS_PREINSCRIPCION as $t) {
        afirmar(
            isset(App\Rufe\Catalogos::TIPOS_EVIDENCIA[$t]),
            "«{$t}» no existe como tipo de evidencia"
        );
    }

    foreach (['DOCUMENTO', 'DANO', 'INSPECCION'] as $t) {
        afirmar(
            ! in_array($t, App\Rufe\Catalogos::TIPOS_PREINSCRIPCION, true),
            "«{$t}» no puede subirse sin sesión"
        );
    }
});

prueba('ninguna ruta pública devuelve pre-inscripciones', function () use ($raiz): void {
    // Consultar por radicado sin sesión sería un buscador de damnificados para
    // cualquiera que probara combinaciones.
    foreach (rutasPublicas($raiz) as $ruta) {
        afirmar(
            ! str_starts_with($ruta, 'GET /preinscripcion/fichas'),
            "«{$ruta}» expondría solicitudes ciudadanas sin sesión"
        );
    }
});

prueba('los topes del video están acotados', function (): void {
    // Es una ruta pública que escribe archivos en disco. Sin topes es
    // alojamiento gratuito para cualquiera, y el disco lo comparten todos los
    // sitios de la Alcaldía.
    afirmarIgual(1048576, App\Preinscripcion\Videos::BYTES_TROZO, 'el trozo debe caber en una petición');
    afirmar(App\Preinscripcion\Videos::MAX_BYTES_VIDEO <= 8 * 1048576, 'el tope por video se pasó');
    afirmar(App\Preinscripcion\Videos::MAX_VIDEOS_POR_CARGA <= 10, 'demasiados videos por solicitud');

    // El caso que importa: lo peor que puede subir una sola solicitud.
    $peor = App\Preinscripcion\Videos::MAX_BYTES_VIDEO * App\Preinscripcion\Videos::MAX_VIDEOS_POR_CARGA;
    afirmar($peor <= 80 * 1048576, 'una sola solicitud podría subir '.round($peor / 1048576).' MiB');
});

prueba('el trozo cabe en el tope por archivo del hosting', function (): void {
    // Si el trozo fuera mayor que lo que admite una petición, la subida
    // fallaría siempre y solo se vería con un video real.
    afirmar(
        App\Preinscripcion\Videos::BYTES_TROZO <= App\Rufe\Catalogos::MAX_BYTES_ARCHIVO,
        'el trozo no cabe en una petición'
    );
});

grupo('Pre-inscripción › validación');

function erroresPre(array $entrada): array
{
    return App\Preinscripcion\Validador::revisar($entrada)['errores'];
}

function datosPre(array $entrada): array
{
    return App\Preinscripcion\Validador::revisar($entrada)['datos'];
}

function preBase(array $cambios = []): array
{
    return array_replace([
        'nombre_completo' => 'Pedro Antonio Pérez Gómez',
        'documento' => '16.234.567',
        'telefono' => '315 123 4567',
        'direccion' => 'Carrera 11 # 8-26',
        'zona' => 'URBANA',
        'autoriza_datos' => true,
        'aviso_version' => App\Rufe\Catalogos::AVISO_VERSION,
    ], $cambios);
}

prueba('una solicitud mínima y completa pasa', function (): void {
    afirmarIgual([], erroresPre(preBase()));
});

prueba('la cédula y el teléfono se guardan sin puntos ni espacios', function (): void {
    // La gente los escribe como los lee en su documento. Normalizar aquí evita
    // que el mismo hogar quede con dos escrituras distintas.
    $d = datosPre(preBase());

    afirmarIgual('16234567', $d['documento']);
    afirmarIgual('3151234567', $d['telefono']);
});

prueba('sin autorización de datos NO se guarda, aunque el navegador insista', function (): void {
    // Es el ciudadano entregando sus propios datos sin nadie delante que se lo
    // explique. La prueba de que aceptó no puede depender del navegador.
    $e = erroresPre(preBase(['autoriza_datos' => false]));

    afirmar(isset($e['autoriza_datos']), 'debe exigir la autorización');
});

prueba('una versión de aviso desconocida se rechaza', function (): void {
    // Lo que prueba qué aceptó el ciudadano es la versión guardada. Si llega una
    // que no existe, no hay nada que probar.
    $e = erroresPre(preBase(['aviso_version' => 'inventada-v9']));

    afirmar(isset($e['aviso_version']), 'debe exigir una versión conocida');
});

prueba('la ubicación es opcional y una imposible se descarta sin tumbar la solicitud', function (): void {
    // Mucha gente rechaza el permiso de ubicación. Perder la solicitud por eso
    // sería absurdo.
    afirmarIgual([], erroresPre(preBase()));
    afirmarIgual(null, datosPre(preBase())['latitud']);

    $d = datosPre(preBase(['latitud' => 40.4168, 'longitud' => -3.7038]));
    afirmarIgual(null, $d['latitud'], 'Madrid no es Jamundí');

    $d = datosPre(preBase(['latitud' => 3.2611234, 'longitud' => -76.5412345, 'precision_m' => 12]));
    afirmarIgual(3.2611234, $d['latitud']);
    afirmarIgual(12, $d['precision_m']);
});

prueba('no se piden datos sensibles', function (): void {
    // Género y pertenencia étnica son datos sensibles del art. 5 de la Ley 1581
    // y los levanta el funcionario en la visita, con el aviso explicado de viva
    // voz. Si alguien los mandara igual, no deben acabar guardados.
    $d = datosPre(preBase(['genero' => 'M', 'pertenencia_etnica' => 'NINGUNA']));

    afirmar(! isset($d['genero']), 'el género no debe guardarse aquí');
    afirmar(! isset($d['pertenencia_etnica']), 'la pertenencia étnica no debe guardarse aquí');
});

prueba('la zona urbana o rural es obligatoria', function (): void {
    // Antes se DEDUCÍA de si venía corregimiento, y la deducción era falsa:
    // quien vive en el campo y no sabe a qué corregimiento pertenece su vereda
    // entraba al sistema como urbano, y la visita salía al pueblo.
    $e = erroresPre(preBase(['zona' => '']));
    afirmar(isset($e['zona']), 'debe exigir la zona');

    $e = erroresPre(preBase(['zona' => 'SEMIRURAL']));
    afirmar(isset($e['zona']), 'no debe aceptar una zona inventada');

    afirmarIgual('RURAL', datosPre(preBase(['zona' => 'rural']))['zona']);
});

prueba('en zona urbana el corregimiento se descarta en vez de rechazarse', function (): void {
    // Si alguien eligió corregimiento y después corrigió la zona, ese dato
    // sobrante no puede costarle el envío.
    $d = datosPre(preBase([
        'zona' => 'URBANA',
        'corregimiento' => App\Rufe\Catalogos::CORREGIMIENTOS[0],
    ]));

    afirmarIgual([], erroresPre(preBase([
        'zona' => 'URBANA',
        'corregimiento' => App\Rufe\Catalogos::CORREGIMIENTOS[0],
    ])));
    afirmarIgual(null, $d['corregimiento'], 'en la cabecera no hay corregimiento');
});

prueba('la dirección puede ser una referencia, no una nomenclatura', function (): void {
    // Media zona rural de Jamundí no tiene calle y número. «La casa azul
    // pasando el puente» es una dirección perfectamente válida para quien va a
    // ir a buscarla, y exigir formato dejaría fuera justo a quien más lo
    // necesita.
    afirmarIgual([], erroresPre(preBase([
        'zona' => 'RURAL',
        'direccion' => 'La casa azul pasando el puente de La Liberia, al lado de la tienda',
    ])));
});

prueba('ninguna señal de daño es obligatoria', function (): void {
    // Quien tiene la casa partida por la mitad puede no reconocerse en ninguno
    // de los ocho dibujos. Negarle el turno por eso sería el error que este
    // formulario existe para no cometer.
    afirmarIgual([], erroresPre(preBase()));
    afirmarIgual([], datosPre(preBase())['senales']);
});

prueba('una señal inventada se rechaza y no se guarda a medias', function (): void {
    // La ruta es pública: cualquiera puede mandar lo que quiera contra ella.
    $e = erroresPre(preBase(['senales' => ['PARED_AGRIETADA', 'CASA_EMBRUJADA']]));

    afirmar(isset($e['senales']), 'debe rechazar el código desconocido');
    afirmarIgual([], datosPre(preBase(['senales' => ['PARED_AGRIETADA', 'CASA_EMBRUJADA']]))['senales']);
});

prueba('la misma señal marcada dos veces se guarda una sola vez', function (): void {
    // La tabla tiene un único por (solicitud, código): sin limpiar aquí, el
    // INSERT reventaría con un error que el ciudadano no sabría interpretar.
    $d = datosPre(preBase(['senales' => ['PARED_AGRIETADA', 'PARED_AGRIETADA', 'TECHO_CAIDO']]));

    afirmarIgual(['PARED_AGRIETADA', 'TECHO_CAIDO'], $d['senales']);
});

prueba('cada señal apunta a un elemento que el formato de inspección conoce', function (): void {
    // Es lo que hace útil la conversión a inspección: lo que marcó el ciudadano
    // le dice al profesional qué filas del numeral 5.4 mirar primero. Si una
    // señal apuntara a un elemento inventado, ese puente se rompería en
    // silencio y nadie se enteraría.
    $delFormato = App\Preinscripcion\Senales::elementosDelFormato();

    foreach (App\Preinscripcion\Senales::CATALOGO as $senal) {
        afirmar(
            in_array($senal['elemento'], $delFormato, true),
            "la señal {$senal['codigo']} apunta a un elemento inexistente: {$senal['elemento']}"
        );
    }
});

prueba('las señales cubren todos los grupos de elementos evaluables', function (): void {
    // Si el formato evalúa un elemento y ninguna señal apunta a él, hay un daño
    // que el ciudadano no tiene cómo reportar. Muros y entrepisos de madera
    // quedan cubiertos por sus equivalentes de mampostería, que es lo que la
    // persona ve: una pared es una pared.
    $equivalentes = ['MUROS_MADERA' => 'MUROS_CARGA', 'ENTREPISOS' => 'PLACA_PISO'];
    $apuntados = App\Preinscripcion\Senales::elementosApuntados(
        App\Preinscripcion\Senales::codigos()
    );

    foreach (App\Preinscripcion\Senales::elementosDelFormato() as $elemento) {
        // Los muros divisorios no deciden nada estructural y pedirle al
        // ciudadano que los distinga de los de carga sería pedirle criterio
        // técnico.
        if ($elemento === 'MUROS_DIVISORIOS') {
            continue;
        }

        $buscado = $equivalentes[$elemento] ?? $elemento;
        afirmar(
            in_array($buscado, $apuntados, true),
            "ninguna señal permite reportar daño en {$elemento}"
        );
    }
});

prueba('cada señal resuelve su dibujo, y una desconocida no revienta', function (): void {
    // El dibujo NO se guarda con la solicitud: se resuelve contra el catálogo de
    // hoy, para que mejorar una figura la mejore también en los expedientes
    // viejos. La etiqueta sí queda congelada, que es la que prueba qué se le
    // mostró a la persona.
    foreach (App\Preinscripcion\Senales::CATALOGO as $senal) {
        afirmarIgual($senal['icono'], App\Preinscripcion\Senales::icono($senal['codigo']));
    }

    // Un código retirado del catálogo sigue existiendo en las solicitudes ya
    // enviadas. Devolver cadena vacía hace que se dibuje la marca de «señal sin
    // dibujo», que se ve y se corrige; reventar dejaría la bandeja en blanco.
    afirmarIgual('', App\Preinscripcion\Senales::icono('SENAL_RETIRADA'));
});

prueba('el catálogo público de señales no revela a qué elemento apunta cada una', function (): void {
    // Al ciudadano no le dice nada, y publicarlo solo invita a deducir desde
    // fuera cómo se clasificará técnicamente su caso.
    foreach (App\Preinscripcion\Senales::paraApi() as $senal) {
        afirmar(! isset($senal['elemento']), 'el elemento no debe salir al público');
        afirmar($senal['icono'] !== '', 'cada señal necesita su dibujo');
    }
});

prueba('un video sale con su tipo, no como un archivo cualquiera', function (): void {
    // Salía como `application/octet-stream`, y con `X-Content-Type-Options:
    // nosniff` puesto —que sí queremos— el navegador se niega a decodificarlo.
    // El reproductor mostraba un recuadro negro y nadie podía ver lo que el
    // ciudadano grabó.
    afirmarIgual('video/mp4', App\Rufe\Archivos::tipoDeSalida('mp4'));
    afirmarIgual('video/webm', App\Rufe\Archivos::tipoDeSalida('webm'));
    afirmarIgual('image/webp', App\Rufe\Archivos::tipoDeSalida('webp'));
});

prueba('todo formato que se puede subir se puede servir', function (): void {
    // Son dos listas: una decide qué entra y otra con qué tipo sale. Añadir un
    // formato a la primera y olvidar la segunda no rompe la subida —el video se
    // guarda perfectamente— y solo se nota cuando alguien intenta verlo.
    foreach (App\Preinscripcion\Videos::FORMATOS as $mime => $extension) {
        afirmarIgual(
            $mime,
            App\Rufe\Archivos::tipoDeSalida($extension),
            "el formato .{$extension} se puede subir pero no servir"
        );
    }
});

prueba('lo que no se reconoce sale como archivo opaco', function (): void {
    // El caso por defecto tiene que seguir siendo el inofensivo: nada de
    // devolver text/html para una extensión inesperada.
    afirmarIgual('application/octet-stream', App\Rufe\Archivos::tipoDeSalida('svg'));
    afirmarIgual('application/octet-stream', App\Rufe\Archivos::tipoDeSalida('html'));
});

prueba('fotos y videos de una solicitud caen en la misma carpeta', function (): void {
    // Un expediente repartido en dos sitios es un expediente que alguien archiva
    // a medias. Las dos rutas salen del mismo cálculo justamente para que no
    // puedan separarse.
    $carpeta = App\Rufe\Archivos::carpetaDe('preinscripcion', 7);

    afirmarIgual('preinscripcion/'.date('Y/m').'/7', $carpeta);
});

prueba('la carpeta definitiva nunca es la temporal', function (): void {
    // Los videos vivían en `temporal/` incluso después de aceptarse la
    // solicitud. No se perdía nada porque la purga solo borra lo que no tiene
    // dueño, pero bastaba con que alguien limpiara una carpeta llamada
    // «temporal» —cosa que el nombre invita a hacer— para perder los videos de
    // expedientes reales.
    foreach (['preinscripcion', 'rufe', 'inspeccion'] as $base) {
        afirmar(
            ! str_contains(App\Rufe\Archivos::carpetaDe($base, 1), 'temporal'),
            "la carpeta de {$base} no puede ser la temporal"
        );
    }
});

prueba('la bandeja recoloca los videos que quedaron en temporal', function (): void {
    // No hay consola ni tareas programadas en este hosting: el mantenimiento va
    // montado en peticiones que ya ocurren, igual que la purga de cargas
    // caducadas. Si alguien quita esta llamada, los videos antiguos se quedan
    // en `temporal/` para siempre y nada falla hasta que se limpie la carpeta.
    $fuente = file_get_contents(__DIR__.'/../src/Controllers/PreinscripcionController.php');
    $desde = strpos($fuente, 'public function listar(');
    afirmar($desde !== false, 'no se encontró listar()');

    // Hasta la siguiente declaración de método, sea pública o privada: buscar un
    // nombre concreto ataría la prueba al orden en que están escritos.
    $siguiente = preg_match(
        '/\n    (?:public|private|protected) function /',
        $fuente,
        $m,
        PREG_OFFSET_CAPTURE,
        $desde + 10
    ) === 1 ? $m[0][1] : strlen($fuente);

    afirmar(
        str_contains(substr($fuente, $desde, $siguiente - $desde), 'Videos::reubicarPendientes('),
        'listar() debe recolocar los videos pendientes'
    );
});

prueba('un reenvío no puede tirar los archivos que trae', function (): void {
    // Los dos atajos de `crear()` —el reintento sin señal y la solicitud
    // duplicada— devolvían el radicado y se marchaban sin tocar la carga: las
    // fotos y videos recién subidos se quedaban huérfanos y la purga se los
    // llevaba dos horas después.
    //
    // El caso que lo hace grave: una familia vuelve a inscribirse porque esta
    // vez SÍ consiguió grabar el video del daño. El servidor le contestaba «su
    // vivienda ya estaba registrada» —con razón— y le tiraba el video.
    $fuente = file_get_contents(__DIR__.'/../src/Controllers/PreinscripcionController.php');
    $crear = substr($fuente, strpos($fuente, 'public function crear('));
    $crear = substr($crear, 0, strpos($crear, 'private function adjuntarA('));

    afirmarIgual(
        2,
        substr_count($crear, '$this->adjuntarA('),
        'los dos atajos de crear() deben adoptar la carga antes de responder'
    );
});

prueba('un video que se cortó a mitad deja constancia, no desaparece', function (): void {
    // Un archivo al que le faltan trozos no lo abre ningún reproductor, así que
    // se borra. Pero antes se borraba EN SILENCIO: quien revisaba la solicitud
    // veía una ficha sin videos, exactamente igual que si la persona no hubiera
    // grabado ninguno, y nunca se le ocurriría llamar para pedirlo otra vez.
    $fuente = file_get_contents(__DIR__.'/../src/Preinscripcion/Videos.php');
    $adoptar = substr($fuente, strpos($fuente, 'public static function adoptar('));

    afirmar(
        str_contains($adoptar, 'preinscripcion_historial'),
        'descartar un video incompleto debe quedar escrito en el historial'
    );
});

prueba('el radicado ciudadano se distingue de los otros dos', function (): void {
    $r = App\Preinscripcion\Radicado::componer(2026);

    afirmar(str_starts_with($r, 'PRE-2026-'), "el radicado no lleva el prefijo esperado: {$r}");
    afirmar(App\Preinscripcion\Radicado::esValido($r), 'debería validarse a sí mismo');
    afirmar(! App\Preinscripcion\Radicado::esValido('RUFE-2026-ABCDEFGH'), 'no debe aceptar el del censo');
});

prueba('la huella junta la misma vivienda del mismo solicitante', function (): void {
    $a = App\Preinscripcion\Radicado::huella('Carrera 11 # 8-26', '16234567');
    $b = App\Preinscripcion\Radicado::huella('  carrera   11 # 8-26 ', '16234567');
    $c = App\Preinscripcion\Radicado::huella('Carrera 11 # 8-26', '99999999');

    afirmarIgual($a, $b, 'la misma casa y persona deben coincidir');
    afirmar($a !== $c, 'otro solicitante es otra solicitud');
});

// ── Resumen ──────────────────────────────────────────────────────────────────

echo "\n".str_repeat('─', 60)."\n";

if ($fallos === []) {
    echo "\033[32m{$pasadas} pruebas correctas.\033[0m\n";
    exit(0);
}

echo "\033[31m".count($fallos).' fallo(s), '.$pasadas." correctas.\033[0m\n\n";
foreach ($fallos as $f) {
    echo "  • {$f}\n";
}
echo "\n";
exit(1);
