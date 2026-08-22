<?php

declare(strict_types=1);

namespace App\Inspeccion;

use App\Rufe\Catalogos as Rufe;

/**
 * Catálogos y límites del «Formato de Inspección de Viviendas Afectadas» (NGRD).
 *
 * Fuente única, igual que en el RUFE: el frontend los pide por
 * `GET /inspeccion/catalogos` en vez de llevar su propia copia, para que no
 * puedan divergir.
 *
 * Lo que este formato comparte con el RUFE se toma de allí y no se vuelve a
 * escribir —el departamento, el municipio, los corregimientos y la tabla de
 * parentescos son los mismos—; una segunda lista de corregimientos acabaría
 * teniendo un barrio que la otra no.
 */
final class Catalogos
{
    public const FORMATO_NOMBRE = 'Formato de Inspección de Viviendas Afectadas';

    /**
     * El recuadro «Código:» del encabezado va en blanco en el formato en
     * limpio: lo asigna la entidad que lo adopta. Se deja vacío hasta que la
     * Alcaldía diga el suyo, porque inventarlo sería peor que dejarlo así.
     */
    public const FORMATO_CODIGO = '';

    public const DEPARTAMENTO = Rufe::DEPARTAMENTO;

    public const MUNICIPIO = Rufe::MUNICIPIO;

    // ── Límites ──────────────────────────────────────────────────────────────

    /** El numeral 11 imprime diez recuadros de fotografía. */
    public const MAX_FOTOS = 10;

    /** Cada foto lleva su «FOTOGRAFIA DE:», que debe caber en la línea impresa. */
    public const MAX_DESCRIPCION_FOTO = 120;

    public const MAX_TEXTO = 255;

    /** Años hacia atrás admisibles para la fecha de evaluación. */
    public const ANOS_ATRAS = 2;

    // ── 5.1 Tipo de evento ───────────────────────────────────────────────────

    public const EVENTO_OTRO = 'OTRO';

    public const EVENTOS = [
        'INUNDACION' => 'Inundación',
        'VENDAVAL' => 'Vendaval',
        'SISMO' => 'Sismo',
        'AVENIDA_TORRENCIAL' => 'Avenida torrencial',
        'REMOCION_EN_MASA' => 'Remoción en masa',
        self::EVENTO_OTRO => 'Otro, ¿cuál?',
    ];

    // ── 1. Profesión de quien inspecciona ────────────────────────────────────

    public const PROFESION_OTRA = 'OTRA';

    /**
     * Quién puede firmar una inspección de vivienda afectada.
     *
     * No es una lista de oficios: el formato exige TARJETA PROFESIONAL en el
     * renglón de al lado, así que solo caben profesiones con matrícula que
     * habilite para evaluar daño estructural.
     *
     * Se deja «Otra, ¿cuál?» porque un municipio puede enviar a un perfil que
     * esta lista no previó, y cerrarle la puerta obligaría a mentir en el
     * campo. Funciona igual que el «Otro» del tipo de evento.
     */
    public const PROFESIONES = [
        'ARQUITECTO' => 'Arquitecto(a)',
        'INGENIERO_CIVIL' => 'Ingeniero(a) civil',
        'INGENIERO_ESTRUCTURAL' => 'Ingeniero(a) estructural',
        'INGENIERO_GEOTECNISTA' => 'Ingeniero(a) geotecnista',
        'TECNOLOGO_OBRAS_CIVILES' => 'Tecnólogo(a) en obras civiles',
        self::PROFESION_OTRA => 'Otra, ¿cuál?',
    ];

    // ── 3. Requisitos del propietario ────────────────────────────────────────

    /**
     * Los tres requisitos, con su texto íntegro.
     *
     * Se guardan completos y no resumidos porque son las condiciones que la
     * persona acepta o incumple, y de ellas depende que reciba o no los
     * materiales. Un resumen «propietario sí/no» no serviría de constancia.
     *
     * El orden es el del formato y los códigos no se renumeran.
     */
    public const REQUISITOS = [
        'NO_BENEFICIARIO' => 'No haber sido beneficiario del mismo programa o algún otro programa de gobierno relacionado con la rehabilitación o construcción total de viviendas por ese mismo evento.',
        'PROPIETARIO' => 'Ser el propietario de la vivienda afectada o del lote destinado para la construcción de vivienda nueva, para ello presentar escritura pública o certificado de compra-venta o sana posesión. Es importante aclarar que los arrendatarios no serán beneficiados del banco de materiales, por no ser los propietarios del inmueble que sufrió la afectación o el colapso total.',
        'NO_ALTO_RIESGO' => 'Certificación de la Alcaldía en donde conste que el predio no se encuentra en zona de alto riesgo no mitigable o de infraestructura básica a nivel nacional, regional o municipal.',
    ];

    // ── 5.3 Infraestructura actual ───────────────────────────────────────────

    /**
     * Las convenciones del formato: una letra por material.
     *
     * Las letras son las impresas y se guardan ellas, no la etiqueta: el papel
     * dice «Bl» y el expediente tiene que poder cotejarse con el papel.
     *
     * Ojo con las repetidas — «(M) Madera» significa madera en las cuatro
     * categorías, pero «(M) Mampostería» no existe: en estructura la
     * mampostería es «Ma». Por eso cada categoría tiene su propia tabla y no
     * hay una lista común de letras.
     */
    public const CONVENCIONES = [
        'MUROS_DIVISORIOS' => [
            'etiqueta' => 'Muros divisorios',
            'opciones' => [
                'L' => 'Ladrillo', 'Bl' => 'Bloque', 'M' => 'Madera',
                'G' => 'Guadua', 'Ba' => 'Bahareque', 'O' => 'Otro',
            ],
        ],
        'PISOS' => [
            'etiqueta' => 'Pisos',
            'opciones' => [
                'C' => 'Cemento', 'B' => 'Baldosa', 'M' => 'Madera',
                'T' => 'Tierra', 'O' => 'Otro',
            ],
        ],
        'ESTRUCTURA' => [
            'etiqueta' => 'Estructura',
            'opciones' => [
                'M' => 'Madera', 'Co' => 'Concreto', 'Ma' => 'Mampostería', 'O' => 'Otro',
            ],
        ],
        'CUBIERTA' => [
            'etiqueta' => 'Cubierta',
            'opciones' => [
                'Pc' => 'Placa de concreto', 'M' => 'Madera', 'Ac' => 'Asbesto-cemento',
                'Tb' => 'Teja de barro', 'Z' => 'Zinc', 'P' => 'Palma', 'O' => 'Otro',
            ],
        ],
    ];

    /**
     * Qué kit de cubierta sugiere el material que se encontró en la vivienda.
     *
     * Es una sugerencia, no una imposición: quien decide es el profesional. Pero
     * llegar con la casilla ya marcada donde el material lo canta —zinc con
     * zinc, asbesto-cemento con fibrocemento— evita una equivocación tonta al
     * final de una visita larga.
     */
    public const KIT_SUGERIDO = ['Z' => 'ZINC', 'Ac' => 'FIBROCEMENTO'];

    public static function esProfesionValida(string $codigo): bool
    {
        return isset(self::PROFESIONES[$codigo]);
    }

    public static function esEventoValido(string $codigo): bool
    {
        return isset(self::EVENTOS[$codigo]);
    }

    public static function esMaterialValido(string $categoria, string $letra): bool
    {
        return isset(self::CONVENCIONES[$categoria]['opciones'][$letra]);
    }

    /** Lo que el formulario necesita para dibujarse entero, en una sola petición. */
    public static function paraApi(): array
    {
        $opciones = static fn (array $mapa): array => array_map(
            static fn ($codigo, $etiqueta): array => ['codigo' => (string) $codigo, 'etiqueta' => $etiqueta],
            array_keys($mapa),
            $mapa
        );

        return [
            'formato' => [
                'nombre' => self::FORMATO_NOMBRE,
                'codigo' => self::FORMATO_CODIGO,
            ],
            'fijos' => [
                'departamento' => self::DEPARTAMENTO,
                'municipio' => self::MUNICIPIO,
            ],
            'limites' => [
                'fotos' => self::MAX_FOTOS,
                'descripcion_foto' => self::MAX_DESCRIPCION_FOTO,
                'texto' => self::MAX_TEXTO,
                'anos_atras' => self::ANOS_ATRAS,
                'bytes_archivo' => Rufe::MAX_BYTES_ARCHIVO,
                'objetivo_bytes_foto' => Rufe::OBJETIVO_BYTES_FOTO,
                'bytes_carga' => Rufe::MAX_BYTES_CARGA,
                'extensiones' => array_keys(Rufe::EXTENSIONES),
            ],
            'profesiones' => $opciones(self::PROFESIONES),
            'eventos' => $opciones(self::EVENTOS),
            'requisitos' => $opciones(self::REQUISITOS),
            'corregimientos' => Rufe::CORREGIMIENTOS,
            'parentescos' => $opciones(Rufe::PARENTESCOS),
            'convenciones' => self::CONVENCIONES,
            'kit_sugerido' => self::KIT_SUGERIDO,
            'sistemas' => [
                ['codigo' => NivelDano::MAMPOSTERIA, 'etiqueta' => 'Mampostería'],
                ['codigo' => NivelDano::MADERA, 'etiqueta' => 'Madera'],
            ],
            'kits_cubierta' => BancoMateriales::KITS_CUBIERTA,
            // Las tres tablas con las que el navegador replica el cálculo del
            // combo: el orden de gravedad, qué elementos son estructurales y
            // qué combo corresponde a cada nivel. Van desde aquí para que lo
            // único duplicado sea el algoritmo, nunca los datos.
            'niveles' => NivelDano::NIVELES,
            'estructurales' => NivelDano::ESTRUCTURALES,
            'combos' => BancoMateriales::combosParaApi(),
            'anexo2' => BancoMateriales::anexo2ParaApi(),
            // Elementos, niveles permitidos y los criterios del Anexo 1 para
            // cada uno: la tabla del 5.4 tiene que poder llenarse sin señal, y
            // pedir los criterios elemento por elemento no funcionaría en una
            // vereda.
            'evaluacion' => NivelDano::paraApi(),
        ];
    }
}
