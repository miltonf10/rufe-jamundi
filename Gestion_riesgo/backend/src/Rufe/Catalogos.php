<?php

declare(strict_types=1);

namespace App\Rufe;

use App\Inspeccion\Catalogos as InspeccionCatalogos;

/**
 * Catálogos y límites del formato RUFE (UNGRD FR-1703-SMD-69, versión 01).
 *
 * Fuente única de verdad: el frontend los pide por GET /rufe/catalogos en vez de
 * duplicarlos en TypeScript, para que no puedan divergir.
 *
 * Los códigos numéricos son los impresos al pie del formato y NO se renumeran:
 * lo que se guarda en la base es el código, no la etiqueta, para que un cambio
 * de redacción de la UNGRD no invalide los registros históricos.
 */
final class Catalogos
{
    public const FORMATO_CODIGO = 'FR-1703-SMD-69';

    public const FORMATO_VERSION = '01';

    public const AVISO_VERSION = 'habeas-data-v2';

    /**
     * Versiones del aviso que alguna vez se le mostraron a un ciudadano.
     *
     * Una ficha levantada sin señal puede enviarse días después, cuando la
     * aplicación ya cambió de versión. Lo que hay que guardar es el aviso que
     * esa persona leyó, no el que rige el día que la ficha llega: si se estampa
     * el vigente, el registro afirma que aceptó un texto que nunca vio, y ese
     * registro es justo la prueba exigible ante la SIC.
     */
    public const AVISOS_CONOCIDOS = ['habeas-data-v1', 'habeas-data-v2'];

    public const DEPARTAMENTO = 'Valle del Cauca';

    public const MUNICIPIO = 'Jamundí';

    // ── Límites del formato ──────────────────────────────────────────────────

    public const MAX_PERSONAS = 10;

    public const MAX_AGROPECUARIO = 4;

    /**
     * Un solo documento de identidad y hasta cuatro fotos del daño. Se cuentan
     * por separado porque cumplen funciones distintas: la cédula identifica a
     * quien reporta y las fotos sustentan la valoración del daño.
     */
    public const MAX_EVIDENCIAS_DOCUMENTO = 1;

    public const MAX_EVIDENCIAS_DANO = 4;

    public const MAX_EVIDENCIAS = self::MAX_EVIDENCIAS_DOCUMENTO + self::MAX_EVIDENCIAS_DANO;

    /**
     * Los tipos que admite una carga.
     *
     * `INSPECCION` es el registro fotográfico del numeral 11 del formato de
     * inspección: hasta diez fotos, cada una con su «FOTOGRAFIA DE:». Vive en
     * esta lista, y no en un módulo propio, porque la maquinaria de carga
     * —cupos, compresión, adopción y purga— es exactamente la misma; duplicarla
     * dejaría dos copias que mantener y una de las dos se quedaría atrás.
     *
     * @var array<string,array{etiqueta:string,maximo:int}>
     */
    public const TIPOS_EVIDENCIA = [
        'DOCUMENTO' => ['etiqueta' => 'Documento de identidad', 'maximo' => self::MAX_EVIDENCIAS_DOCUMENTO],
        'DANO' => ['etiqueta' => 'Foto del daño', 'maximo' => self::MAX_EVIDENCIAS_DANO],
        'INSPECCION' => [
            'etiqueta' => 'Registro fotográfico de la inspección',
            'maximo' => InspeccionCatalogos::MAX_FOTOS,
        ],
        'PRE_CEDULA' => [
            'etiqueta' => 'Cédula (pre-inscripción ciudadana)',
            'maximo' => 1,
        ],
        'PRE_DANO' => [
            'etiqueta' => 'Foto del daño (pre-inscripción ciudadana)',
            'maximo' => self::MAX_FOTOS_PREINSCRIPCION,
        ],
    ];

    /**
     * Los tipos que puede subir alguien SIN sesión.
     *
     * La lista existe para que el tipo no llegue nunca de la petición sin
     * filtrar: sin esto, una solicitud ciudadana podría reclamar el cupo de diez
     * fotos del registro fotográfico de una inspección.
     *
     * @var list<string>
     */
    public const TIPOS_PREINSCRIPCION = ['PRE_CEDULA', 'PRE_DANO'];

    /**
     * Cuántas fotos puede adjuntar un ciudadano a su solicitud.
     *
     * Cuatro, como las del daño en el censo. Es una solicitud de turno, no un
     * expediente: la evidencia que sustenta la decisión la levanta el
     * profesional en la visita. Y cada foto de más en una ruta pública es
     * almacenamiento que cualquiera puede consumir.
     */
    public const MAX_FOTOS_PREINSCRIPCION = 4;

    /**
     * Tope por evidencia. Baja de 8 MiB a 1 MiB porque el navegador ahora
     * optimiza cada foto antes de subirla y ninguna debería pasar de 900 KB.
     * El margen que sobra existe para que una foto justo en el límite no se
     * rechace por unos bytes.
     *
     * Es también una defensa: si alguien intentara subir una foto original
     * saltándose el formulario, el servidor la rechaza.
     */
    public const MAX_BYTES_ARCHIVO = 1048576;      // 1 MiB

    /** Meta que persigue el navegador antes de dar una foto por buena. */
    public const OBJETIVO_BYTES_FOTO = 921600;     // 900 KB

    /**
     * Cupo total de una carga, contando todas sus fotos.
     *
     * Sube de 5 a 12 MiB al entrar el registro fotográfico de la inspección:
     * son DIEZ fotos, el doble de lo que sube un RUFE, y con el tope anterior la
     * séptima habría sido rechazada al final de una visita ya terminada, con un
     * mensaje que hablaba de megabytes y no de fotos. Una prueba comprueba que
     * este número siga alcanzando para el formato más grande.
     */
    public const MAX_BYTES_CARGA = 12582912;       // 12 MiB

    /**
     * Dimensión máxima admitida, en píxeles por lado.
     *
     * Una imagen de 30.000 × 30.000 pesa poco comprimida y revienta la memoria
     * del proceso al decodificarla. El navegador nunca manda nada por encima de
     * 1920, así que este tope solo lo alcanza algo que no vino del formulario.
     */
    public const MAX_LADO_PIXELES = 4000;

    public const MAX_BYTES_CUERPO = 262144;        // 256 KiB de JSON

    /** Antigüedad máxima admitida para la fecha del evento, en años. */
    public const ANOS_ATRAS_EVENTO = 2;

    // ── Catálogos numerados del formato ──────────────────────────────────────

    /** @var array<int,string> */
    public const TIPOS_DOCUMENTO = [
        1 => 'Registro civil',
        2 => 'Tarjeta de identidad',
        3 => 'Cédula de ciudadanía',
        4 => 'Cédula de extranjería',
        5 => 'Pasaporte',
        6 => 'Menor sin identificación',
        7 => 'Adulto sin identidad',
        8 => 'No informa',
        9 => 'NIT',
        10 => 'Otro',
    ];

    /**
     * Códigos que describen la ausencia de documento: no llevan número.
     *
     * El 9 (NIT) NO está aquí: es el identificador tributario de una persona
     * jurídica y por supuesto tiene número. Es el que usan los bienes
     * institucionales del formato — hospital, escuela, alcaldía.
     */
    public const DOCUMENTOS_SIN_NUMERO = [6, 7, 8];

    /**
     * Documentos cuyo número admite letras y guiones además de dígitos.
     *
     * El NIT entra aquí por el guion del dígito de verificación (900123456-1),
     * que un patrón de solo dígitos rechazaría.
     */
    public const DOCUMENTOS_ALFANUMERICOS = [4, 5, 9, 10];

    public const DOCUMENTO_OTRO = 10;

    /** @var array<int,string> */
    public const PARENTESCOS = [
        1 => 'Jefe(a) o cabeza del hogar',
        2 => 'Pareja, esposo(a)',
        3 => 'Hijo(a), hijastro(a)',
        4 => 'Abuelo(a)',
        5 => 'Sobrino(a)',
        6 => 'Nieto(a)',
        7 => 'Tío(a)',
        8 => 'Otro pariente',
        9 => 'Padre, madre, suegro, suegra',
        10 => 'Hermano(a), hermanastro(a)',
        11 => 'Yerno, nuera',
        12 => 'Cuñado, cuñada',
        13 => 'Otro no pariente',
        14 => 'Primo(a)',
        15 => 'No informa',
    ];

    public const PARENTESCO_JEFE = 1;

    /** @var array<int,string> */
    public const GENEROS = [
        1 => 'Masculino',
        2 => 'Femenino',
        3 => 'Transgénero',
    ];

    /** @var array<int,string> */
    public const ETNIAS = [
        1 => 'Indígena',
        2 => 'Gitano - ROM',
        3 => 'Raizal',
        4 => 'Palenquero(a)',
        5 => 'Negro(a), mulato(a), afrodescendiente(a), afrocolombiano(a)',
        6 => 'No aplica',
    ];

    // ── Catálogos de opción única del formato ────────────────────────────────

    /** @var array<string,string> */
    public const ZONAS = [
        'URBANO' => 'Urbano',
        'RURAL' => 'Rural',
    ];

    /** @var array<string,string> */
    public const ALOJAMIENTOS = [
        'LUGAR_HABITUAL' => 'Lugar habitual de su residencia',
        'EVACUADO' => 'Evacuado fuera de su residencia',
    ];

    /** @var array<string,string> */
    public const FORMAS_TENENCIA = [
        'ARRENDATARIO' => 'Arrendatario',
        'OCUPANTE' => 'Ocupante',
        'POSEEDOR' => 'Poseedor',
        'PROPIETARIO' => 'Propietario',
        'NO_INFORMA' => 'No informa',
    ];

    /** @var array<string,string> */
    public const ESTADOS_BIEN = [
        'HABITABLE' => 'Habitable',
        'NO_HABITABLE' => 'No habitable',
        'AVERIADO' => 'Averiado',
        'DESTRUIDO' => 'Destruido',
        'NO_INFORMA' => 'No informa',
    ];

    /**
     * Los catorce tipos del formato. El grupo sirve al frontend para mostrar
     * primero los seis frecuentes y esconder el equipamiento institucional tras
     * "ver más opciones", sin alterar la lista oficial.
     *
     * @var array<string,array{etiqueta:string,grupo:string}>
     */
    public const TIPOS_BIEN = [
        'VIVIENDA' => ['etiqueta' => 'Vivienda', 'grupo' => 'COMUNES'],
        'FINCA' => ['etiqueta' => 'Finca', 'grupo' => 'COMUNES'],
        'LOCAL_COMERCIAL' => ['etiqueta' => 'Local comercial', 'grupo' => 'COMUNES'],
        'FABRICA' => ['etiqueta' => 'Fábrica', 'grupo' => 'COMUNES'],
        'BODEGA' => ['etiqueta' => 'Bodega', 'grupo' => 'COMUNES'],
        'LOTE' => ['etiqueta' => 'Lote', 'grupo' => 'COMUNES'],
        'CENTRO_BIENESTAR' => ['etiqueta' => 'Centro de bienestar', 'grupo' => 'INSTITUCIONAL'],
        'CENTRO_EDUCATIVO' => ['etiqueta' => 'Centro educativo o escuela', 'grupo' => 'INSTITUCIONAL'],
        'CENTRO_ADULTO_MAYOR' => ['etiqueta' => 'Centro de bienestar del adulto mayor', 'grupo' => 'INSTITUCIONAL'],
        'HOSPITAL' => ['etiqueta' => 'Hospital', 'grupo' => 'INSTITUCIONAL'],
        'ESTADIO' => ['etiqueta' => 'Estadio', 'grupo' => 'INSTITUCIONAL'],
        'IGLESIA' => ['etiqueta' => 'Iglesia o institución religiosa', 'grupo' => 'INSTITUCIONAL'],
        'ALCALDIA' => ['etiqueta' => 'Alcaldía municipal', 'grupo' => 'INSTITUCIONAL'],
        'ESTACION_POLICIA' => ['etiqueta' => 'Estación de policía', 'grupo' => 'INSTITUCIONAL'],
    ];

    /** @var array<string,string> */
    public const UNIDADES_MEDIDA = [
        'HECTAREA' => 'Hectárea(s)',
        'FANEGADA' => 'Fanegada(s)',
        'METRO' => 'Metro(s)',
        'CUADRA' => 'Cuadra(s)',
        'UNIDADES' => 'Unidades',
    ];

    // ── Añadidos de usabilidad (no están en el formato de papel) ─────────────

    /**
     * El formato deja "EVENTO" como texto libre. Se ofrecen sugerencias para que
     * el tablero pueda agrupar, pero se conserva la opción de escribirlo.
     *
     * @var list<string>
     */
    public const EVENTOS_SUGERIDOS = [
        'Terremoto',
        'Inundación',
        'Deslizamiento',
        'Vendaval',
        'Incendio estructural',
        'Incendio forestal',
        'Avenida torrencial',
        'Colapso estructural',
    ];

    /**
     * Valores con los que el formulario llega precargado.
     *
     * La emergencia que se está atendiendo es una sola, y la inmensa mayoría de
     * quienes reportan lo hacen por ella: precargarla ahorra dos campos a cada
     * persona. Ambos siguen siendo editables.
     *
     * Cuando cambie la emergencia hay que cambiar esto, y es el único sitio
     * donde hacerlo. Si se deja en blanco, el formulario abre sin precargar.
     */
    public const EVENTO_PREDETERMINADO = 'Terremoto';

    public const FECHA_EVENTO_PREDETERMINADA = '2026-08-10';

    /**
     * Lista provisional de corregimientos de Jamundí, pendiente de confirmación
     * con la Secretaría de Planeación. El campo admite texto libre justamente
     * porque esta lista todavía no es oficial.
     *
     * @var list<string>
     */
    public const CORREGIMIENTOS = [
        'Ampudia',
        'Bocas del Palo',
        'Chagres',
        'Guachinte',
        'La Liberia',
        'La Meseta',
        'La Ventura',
        'Paso de la Bolsa',
        'Potrerito',
        'Puente Vélez',
        'Quinamayó',
        'Robles',
        'San Antonio',
        'San Vicente',
        'Timba',
        'Villa Colombia',
        'Villapaz',
    ];

    // ── Estados internos del reporte ─────────────────────────────────────────

    /** @var array<string,string> */
    public const ESTADOS_REPORTE = [
        'RECIBIDO' => 'Recibido',
        'EN_VALIDACION' => 'En validación',
        'VALIDADO' => 'Validado',
        'RECHAZADO' => 'Rechazado',
        'ARCHIVADO' => 'Archivado',
    ];

    // ── Archivos admitidos ───────────────────────────────────────────────────

    /**
     * Lista blanca extensión => MIME esperado. La verificación real la hace
     * finfo sobre el contenido; esta tabla dice qué pareja es coherente.
     *
     * Solo WebP y JPEG: el navegador convierte toda foto a uno de los dos antes
     * de subirla. Se quitaron PNG (para una fotografía pesa varias veces más),
     * HEIC (no lo genera nadie después de convertir) y PDF (esto es un campo de
     * evidencia fotográfica, no un adjunto documental).
     *
     * @var array<string,list<string>>
     */
    public const EXTENSIONES = [
        'webp' => ['image/webp'],
        'jpg' => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
    ];

    // ── Ayudas ───────────────────────────────────────────────────────────────

    public static function etiquetaDocumento(int $codigo): string
    {
        return self::TIPOS_DOCUMENTO[$codigo] ?? 'Desconocido';
    }

    public static function exigeNumeroDocumento(int $codigo): bool
    {
        return ! in_array($codigo, self::DOCUMENTOS_SIN_NUMERO, true);
    }

    /**
     * Forma con la que viaja al frontend. Se emite tal cual bajo `data`.
     *
     * @return array<string,mixed>
     */
    public static function paraApi(): array
    {
        return [
            'formato' => [
                'codigo' => self::FORMATO_CODIGO,
                'version' => self::FORMATO_VERSION,
                'aviso_version' => self::AVISO_VERSION,
            ],
            'fijos' => [
                'departamento' => self::DEPARTAMENTO,
                'municipio' => self::MUNICIPIO,
            ],
            'limites' => [
                'personas' => self::MAX_PERSONAS,
                'agropecuario' => self::MAX_AGROPECUARIO,
                'evidencias' => self::MAX_EVIDENCIAS,
                'evidencias_documento' => self::MAX_EVIDENCIAS_DOCUMENTO,
                'evidencias_dano' => self::MAX_EVIDENCIAS_DANO,
                'bytes_archivo' => self::MAX_BYTES_ARCHIVO,
                'objetivo_bytes_foto' => self::OBJETIVO_BYTES_FOTO,
                'max_lado_pixeles' => self::MAX_LADO_PIXELES,
                'bytes_carga' => self::MAX_BYTES_CARGA,
                'anos_atras_evento' => self::ANOS_ATRAS_EVENTO,
                'extensiones' => array_keys(self::EXTENSIONES),
            ],
            'tipos_documento' => self::listaNumerada(self::TIPOS_DOCUMENTO),
            'documentos_sin_numero' => self::DOCUMENTOS_SIN_NUMERO,
            'documentos_alfanumericos' => self::DOCUMENTOS_ALFANUMERICOS,
            'documento_otro' => self::DOCUMENTO_OTRO,
            'parentescos' => self::listaNumerada(self::PARENTESCOS),
            'parentesco_jefe' => self::PARENTESCO_JEFE,
            'generos' => self::listaNumerada(self::GENEROS),
            'etnias' => self::listaNumerada(self::ETNIAS),
            'zonas' => self::listaTextual(self::ZONAS),
            'alojamientos' => self::listaTextual(self::ALOJAMIENTOS),
            'formas_tenencia' => self::listaTextual(self::FORMAS_TENENCIA),
            'estados_bien' => self::listaTextual(self::ESTADOS_BIEN),
            'tipos_bien' => array_map(
                static fn (string $c, array $v): array => [
                    'codigo' => $c,
                    'etiqueta' => $v['etiqueta'],
                    'grupo' => $v['grupo'],
                ],
                array_keys(self::TIPOS_BIEN),
                array_values(self::TIPOS_BIEN)
            ),
            'unidades_medida' => self::listaTextual(self::UNIDADES_MEDIDA),
            'eventos_sugeridos' => self::EVENTOS_SUGERIDOS,
            'predeterminados' => [
                'evento' => self::EVENTO_PREDETERMINADO,
                'fecha_evento' => self::FECHA_EVENTO_PREDETERMINADA,
            ],
            'corregimientos' => self::CORREGIMIENTOS,
        ];
    }

    /**
     * Se emiten como lista de objetos y no como mapa porque un mapa con claves
     * numéricas se serializa como objeto en JSON y pierde el orden al recorrerlo
     * en el navegador.
     *
     * @param  array<int,string>  $mapa
     * @return list<array{codigo:int,etiqueta:string}>
     */
    private static function listaNumerada(array $mapa): array
    {
        $salida = [];
        foreach ($mapa as $codigo => $etiqueta) {
            $salida[] = ['codigo' => $codigo, 'etiqueta' => $etiqueta];
        }

        return $salida;
    }

    /**
     * @param  array<string,string>  $mapa
     * @return list<array{codigo:string,etiqueta:string}>
     */
    private static function listaTextual(array $mapa): array
    {
        $salida = [];
        foreach ($mapa as $codigo => $etiqueta) {
            $salida[] = ['codigo' => $codigo, 'etiqueta' => $etiqueta];
        }

        return $salida;
    }
}
