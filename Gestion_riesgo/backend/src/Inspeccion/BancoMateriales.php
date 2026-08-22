<?php

declare(strict_types=1);

namespace App\Inspeccion;

/**
 * El numeral 6: qué combo de materiales le corresponde a la vivienda.
 *
 * Aquí no se describe un daño: se decide una entrega de recursos públicos. Por
 * eso este cálculo lo hace el servidor y su resultado es el que se guarda; el
 * navegador replica la regla solo para mostrarla mientras se llena la tabla,
 * igual que `Rufe\Validador` manda sobre la validación del formulario.
 *
 * La regla está impresa en el propio formato:
 *
 *   «prevalece el nivel de daño identificado sobre el sistema estructural
 *    (Vigas y Columnas, Muros de Carga)»
 *
 * Es decir, el combo NO sale del peor daño de toda la vivienda, sino del peor
 * daño entre los elementos estructurales. Una cubierta arrancada sobre una
 * estructura intacta no convierte el caso en severo, y el banco de materiales
 * tiene que reflejarlo: entregar un combo severo ahí sería entregar de más, y
 * uno leve donde la estructura cedió sería dejar la casa sin reparar.
 */
final class BancoMateriales
{
    public const MAMPOSTERIA = NivelDano::MAMPOSTERIA;

    public const MADERA = NivelDano::MADERA;

    /**
     * Qué combo corresponde a cada sistema y nivel estructural.
     *
     * Los números son los del formato y no se renumeran: lo que queda escrito en
     * el expediente es «COMBO 3», y ese texto tiene que seguir significando lo
     * mismo dentro de cinco años.
     */
    private const COMBOS = [
        self::MAMPOSTERIA => [
            'LEVE' => ['codigo' => 'COMBO_1', 'etiqueta' => 'Combo 1'],
            'MODERADO' => ['codigo' => 'COMBO_2', 'etiqueta' => 'Combo 2'],
            'SEVERO' => ['codigo' => 'COMBO_3', 'etiqueta' => 'Combo 3'],
            'COLAPSO_TOTAL' => [
                'codigo' => 'COLAPSO_MAMPOSTERIA',
                'etiqueta' => 'Combo vivienda colapso total — Mampostería',
            ],
        ],
        self::MADERA => [
            'LEVE' => ['codigo' => 'COMBO_4', 'etiqueta' => 'Combo 4'],
            'MODERADO' => ['codigo' => 'COMBO_5', 'etiqueta' => 'Combo 5'],
            'SEVERO' => ['codigo' => 'COMBO_6', 'etiqueta' => 'Combo 6'],
            'COLAPSO_TOTAL' => [
                'codigo' => 'COLAPSO_MADERA',
                'etiqueta' => 'Combo vivienda colapso total — Madera',
            ],
        ],
    ];

    /**
     * Kits de cubierta disponibles por sistema.
     *
     * En madera solo hay zinc. No es una omisión del anexo: el fibrocemento
     * pesa más de lo que una estructura de madera de este tipo sostiene.
     */
    public const KITS_CUBIERTA = [
        self::MAMPOSTERIA => ['ZINC' => 'Cubierta en zinc', 'FIBROCEMENTO' => 'Cubierta en fibrocemento'],
        self::MADERA => ['ZINC' => 'Cubierta en zinc'],
    ];

    /**
     * El Anexo 2, transcrito del libro original.
     *
     * Las cantidades se guardan como TEXTO y no como número a propósito: son lo
     * que hay que pedirle al almacén, se imprimen tal cual y nadie va a operar
     * aritméticamente con ellas. Convertirlas a float solo abriría la puerta a
     * que un «0,5» se imprima como «0.5».
     *
     * Un ítem que no aparece en un nivel es que ese nivel no lo lleva. En el
     * original eso se ve como celda vacía —y en un par de casos como un 0
     * escrito—, que aquí es lo mismo: no entra.
     *
     * @var array<string, array{combo: list<array{kit: string, items: list<array{descripcion: string, unidad: string, cantidades: array<string, string>}>}>, cubierta: array<string, list<array{kit: string, items: list<array{descripcion: string, unidad: string, cantidades: array<string, string>}>}>>}>
     */
    private const MATERIALES = [
        self::MAMPOSTERIA => [
            'combo' => [
                [
                    'kit' => 'Kit Estructura tipo concreto (Vigas, columnas, placas de piso)',
                    'items' => [
                        ['descripcion' => 'Cemento Bulto 50 Kg', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '5', 'MODERADO' => '16', 'SEVERO' => '25']],
                        ['descripcion' => 'Varilla de 1/4" L=6M', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '40', 'SEVERO' => '67']],
                        ['descripcion' => 'Varilla de 3/8"L=6M', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '12', 'SEVERO' => '20']],
                        ['descripcion' => 'Varilla de 1/2"L=6M', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '8', 'SEVERO' => '14']],
                        ['descripcion' => 'Alambre negro No. 18', 'unidad' => 'Kg', 'cantidades' => ['MODERADO' => '5', 'SEVERO' => '10']],
                        ['descripcion' => 'Puntilla de 2"', 'unidad' => 'Lb', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '4']],
                        ['descripcion' => 'Tabla común L=3m para encofrado', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '10', 'SEVERO' => '15']],
                        ['descripcion' => 'Malla electrosoldada 3mm 15x15cm (6x2,35)', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '4']],
                    ],
                ],
                [
                    'kit' => 'Kit Mampostería adobe macizo',
                    'items' => [
                        ['descripcion' => 'Ladrillo tolete común', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '500', 'MODERADO' => '1500', 'SEVERO' => '2050']],
                        ['descripcion' => 'Cemento Bulto 50 Kg', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '4', 'MODERADO' => '12', 'SEVERO' => '21']],
                        ['descripcion' => 'Sika', 'unidad' => 'Kg', 'cantidades' => ['LEVE' => '2', 'MODERADO' => '4', 'SEVERO' => '6']],
                    ],
                ],
                [
                    'kit' => 'Kit Hidrosanitario',
                    'items' => [
                        ['descripcion' => 'Tubería Hidráulica PVC Presión 1/2" RDE 13,5 - 315 PSI L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '2', 'SEVERO' => '3']],
                        ['descripcion' => 'Tanque de agua 500 L', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Tubería PVC sanitaria de 2" L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '3', 'SEVERO' => '5']],
                        ['descripcion' => 'Tubería PVC sanitaria de 3" L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '3', 'SEVERO' => '5']],
                        ['descripcion' => 'Tubería PVC sanitaria de 4" L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '2', 'MODERADO' => '4', 'SEVERO' => '6']],
                        ['descripcion' => 'Tanque pozo séptico', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Rejilla metálica 3x2" con sosco', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '3']],
                        ['descripcion' => 'Pegante PVC PAVCO 1/4 galón (Soldadura)', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '1', 'SEVERO' => '1']],
                        ['descripcion' => 'Limpiador liquido PVC PAVCO 1/4 galón', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '1', 'SEVERO' => '1']],
                    ],
                ],
                [
                    'kit' => 'Kit Eléctrico',
                    'items' => [
                        ['descripcion' => 'Tablero monofásico de 4 circuitos', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Braker Luminex o similar enchufable 40Amp', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Cable 10 AWG - THW', 'unidad' => 'm', 'cantidades' => ['MODERADO' => '25', 'SEVERO' => '50']],
                        ['descripcion' => 'Cable 12 AWG - THW', 'unidad' => 'm', 'cantidades' => ['MODERADO' => '25', 'SEVERO' => '50']],
                        ['descripcion' => 'Varilla polo a tierra - Copper Weld', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Tubería PVC de 1/2" conduit L= 3m', 'unidad' => 'm', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '6']],
                        ['descripcion' => 'Curva PVC de 1/2" conduit 90° c*e', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '4', 'SEVERO' => '8']],
                        ['descripcion' => 'Caja Sencilla Rectangular PVC para Electricidad de 4x2"', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '4']],
                        ['descripcion' => 'Caja Sencilla Rectangular PVC para Electricidad de 4x4"', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '4']],
                        ['descripcion' => 'Caja plástica eléctrica octagonal de 4"', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '4']],
                        ['descripcion' => 'Toma corriente doble', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '3', 'SEVERO' => '5']],
                        ['descripcion' => 'Interruptor Sencillo', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '3', 'SEVERO' => '5']],
                    ],
                ],
            ],
            'cubierta' => [
                'ZINC' => [
                    [
                        'kit' => 'Kit Cubierta Zinc',
                        'items' => [
                            ['descripcion' => 'Teja lámina de zinc (L=2,44 m)', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '4', 'MODERADO' => '10', 'SEVERO' => '20']],
                            ['descripcion' => 'Amarras', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '24', 'MODERADO' => '60', 'SEVERO' => '120']],
                            ['descripcion' => 'Perfil metálico 3"x1-1/2"x6m', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '3']],
                            ['descripcion' => 'Canaleta de aguas lluvias, L=2m', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '3']],
                        ],
                    ],
                ],
                'FIBROCEMENTO' => [
                    [
                        'kit' => 'Kit Cubierta Fibrocemento',
                        'items' => [
                            ['descripcion' => 'Teja No. 8 (L=2,44 m)', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '4', 'MODERADO' => '10', 'SEVERO' => '20']],
                            ['descripcion' => 'Caballete para teja fibrocemento', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '4', 'SEVERO' => '8']],
                            ['descripcion' => 'Ganchos para teja', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '16', 'MODERADO' => '40', 'SEVERO' => '80']],
                            ['descripcion' => 'Perfil metálico 3"x1-1/2"x6m', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '3']],
                            ['descripcion' => 'Canaleta de aguas lluvias, L=2m', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '3']],
                        ],
                    ],
                ],
            ],
        ],
        self::MADERA => [
            'combo' => [
                [
                    'kit' => 'Kit estructura (Vigas, columnas, cimentación)',
                    'items' => [
                        ['descripcion' => 'Bamba en madera 70x70cm', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '4', 'SEVERO' => '8']],
                        ['descripcion' => 'Pilote en madera, Diámetro 6", L= 7m', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '8', 'SEVERO' => '16']],
                        ['descripcion' => 'Columna en guayacán 4"x5m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '4', 'MODERADO' => '10', 'SEVERO' => '22']],
                        ['descripcion' => 'Columna en madera 4"x5m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '4', 'MODERADO' => '6', 'SEVERO' => '9']],
                        ['descripcion' => 'Vigas de carga en madera 4"x4"x5m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '6', 'MODERADO' => '14', 'SEVERO' => '22']],
                        ['descripcion' => 'Puntillas de 2-1/2"', 'unidad' => 'Lb', 'cantidades' => ['LEVE' => '2', 'MODERADO' => '3', 'SEVERO' => '5']],
                    ],
                ],
                [
                    'kit' => 'Kit Muros',
                    'items' => [
                        ['descripcion' => 'Cuarton de 3x2"x3m', 'unidad' => 'm', 'cantidades' => ['MODERADO' => '8', 'SEVERO' => '12']],
                        ['descripcion' => 'Tablas una cara pulida 25 cm x 2,5 cm L= 3m', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '48', 'SEVERO' => '72']],
                        ['descripcion' => 'Puntillas de 2"', 'unidad' => 'Lb', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '4']],
                    ],
                ],
                [
                    'kit' => 'Kit Entrepisos',
                    'items' => [
                        ['descripcion' => 'Tablas una cara pulida 25 cm L= 3m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '25', 'MODERADO' => '36', 'SEVERO' => '75']],
                        ['descripcion' => 'Puntillas de 2"', 'unidad' => 'Lb', 'cantidades' => ['LEVE' => '2', 'MODERADO' => '4', 'SEVERO' => '6']],
                    ],
                ],
                [
                    'kit' => 'Kit Hidrosanitario',
                    'items' => [
                        ['descripcion' => 'Tubería Hidráulica PVC Presión 1/2" RDE 13,5 - 315 PSI L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '2', 'SEVERO' => '3']],
                        ['descripcion' => 'Tanque de agua 500 L', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Tubería PVC sanitaria de 2" L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '3', 'SEVERO' => '5']],
                        ['descripcion' => 'Tubería PVC sanitaria de 3" L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '3', 'SEVERO' => '5']],
                        ['descripcion' => 'Tubería PVC sanitaria de 4" L=6m', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '2', 'MODERADO' => '4', 'SEVERO' => '6']],
                        ['descripcion' => 'Tanque pozo séptico', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Rejilla metálica 3x2" con sosco', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '2', 'SEVERO' => '3']],
                        ['descripcion' => 'Pegante PVC PAVCO 1/4 galón (Soldadura)', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '1', 'SEVERO' => '1']],
                        ['descripcion' => 'Limpiador liquido PVC PAVCO 1/4 galón', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '1', 'MODERADO' => '1', 'SEVERO' => '1']],
                    ],
                ],
                [
                    'kit' => 'Kit Eléctrico',
                    'items' => [
                        ['descripcion' => 'Cable 10 AWG - THW', 'unidad' => 'm', 'cantidades' => ['MODERADO' => '25', 'SEVERO' => '50']],
                        ['descripcion' => 'Cable 12 AWG - THW', 'unidad' => 'm', 'cantidades' => ['MODERADO' => '25', 'SEVERO' => '50']],
                        ['descripcion' => 'Varilla polo a tierra - Copper Weld', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '1']],
                        ['descripcion' => 'Caja Sencilla Rectangular PVC para Electricidad de 4x2"', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '4']],
                        ['descripcion' => 'Caja Sencilla Rectangular PVC para Electricidad de 4x4"', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '4']],
                        ['descripcion' => 'Caja plástica eléctrica octagonal de 4"', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '4']],
                        ['descripcion' => 'Toma corriente doble', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '3', 'SEVERO' => '5']],
                        ['descripcion' => 'Interruptor Sencillo', 'unidad' => 'Und', 'cantidades' => ['MODERADO' => '3', 'SEVERO' => '5']],
                    ],
                ],
            ],
            'cubierta' => [
                'ZINC' => [
                    [
                        'kit' => 'Kit Cubierta Zinc',
                        'items' => [
                            ['descripcion' => 'Teja lámina de zinc (L=2,44 m)', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '4', 'MODERADO' => '10', 'SEVERO' => '20']],
                            ['descripcion' => 'Amarras', 'unidad' => 'Und', 'cantidades' => ['LEVE' => '24', 'MODERADO' => '60', 'SEVERO' => '120']],
                            ['descripcion' => 'Vigas de amarre en madera 3x4"', 'unidad' => 'm', 'cantidades' => ['SEVERO' => '14']],
                            ['descripcion' => 'Liston de Madera 2" x 3" x 3m para correas', 'unidad' => 'Und', 'cantidades' => ['SEVERO' => '6']],
                            ['descripcion' => 'Puntillas de 1"', 'unidad' => 'Lb', 'cantidades' => ['SEVERO' => '4']],
                        ],
                    ],
                ],
            ],
        ],    ];

    /**
     * Las tablas que el navegador necesita para replicar el cálculo.
     *
     * Se le mandan en vez de que las lleve escritas: así lo único que existe
     * dos veces es el algoritmo —una veintena de líneas, cubiertas por la misma
     * tabla de casos en las dos suites— y nunca los datos. Una tabla duplicada
     * es lo que un día dice cosas distintas en cada lado.
     */
    public static function combosParaApi(): array
    {
        return self::COMBOS;
    }

    /**
     * El Anexo 2 entero, para que el teléfono pueda armar la lista sin señal.
     *
     * Se manda completo y no filtrado porque el combo cambia mientras se llena
     * la tabla del 5.4, y pedir la lista al servidor en cada cambio no funciona
     * en una vereda. Son unos pocos KB.
     */
    public static function anexo2ParaApi(): array
    {
        return self::MATERIALES;
    }

    /**
     * El nivel que manda: el peor entre los elementos estructurales.
     *
     * @param  array<string, string|null>  $danos  nivel por elemento; null o ausente es «sin daño»
     * @return array{nivel: string|null, elemento: string|null}
     */
    public static function nivelEstructural(string $sistema, array $danos): array
    {
        $nivel = null;
        $elemento = null;

        foreach (NivelDano::ESTRUCTURALES[$sistema] ?? [] as $codigo) {
            $suyo = $danos[$codigo] ?? null;
            if ($suyo === null) {
                continue;
            }

            $peor = NivelDano::peor($nivel, $suyo);

            // Solo se cambia el responsable cuando el nivel de verdad empeora.
            // Con un empate manda el primero de la lista, que es el orden del
            // formato: así el motivo que se imprime es estable y no depende de
            // en qué orden se recorrió un arreglo.
            if ($peor !== $nivel) {
                $nivel = $peor;
                $elemento = $codigo;
            }
        }

        return ['nivel' => $nivel, 'elemento' => $elemento];
    }

    /**
     * Determina el combo a partir de la evaluación técnica.
     *
     * Devuelve siempre el porqué, no solo el qué: quien revisa el expediente
     * tiene que poder ver de dónde salió el combo sin rehacer el razonamiento.
     *
     * @param  array<string, string|null>  $danos
     * @return array{combo: string|null, etiqueta: string|null, nivel: string|null, motivo: string}
     */
    public static function determinar(string $sistema, array $danos, bool $colapsoTotal = false): array
    {
        if (! isset(self::COMBOS[$sistema])) {
            return ['combo' => null, 'etiqueta' => null, 'nivel' => null, 'motivo' => 'Sistema constructivo sin definir.'];
        }

        // El formato es explícito: «si la vivienda sufrió colapso estructural
        // total, marque solo esta casilla». Manda sobre la tabla por elementos.
        if ($colapsoTotal) {
            $c = self::COMBOS[$sistema]['COLAPSO_TOTAL'];

            return [
                'combo' => $c['codigo'],
                'etiqueta' => $c['etiqueta'],
                'nivel' => 'COLAPSO_TOTAL',
                'motivo' => 'La vivienda sufrió colapso estructural total.',
            ];
        }

        ['nivel' => $nivel, 'elemento' => $elemento] = self::nivelEstructural($sistema, $danos);

        if ($nivel === null) {
            return [
                'combo' => null,
                'etiqueta' => null,
                'nivel' => null,
                'motivo' => 'El sistema estructural no resultó afectado, así que no corresponde combo de materiales.',
            ];
        }

        $c = self::COMBOS[$sistema][$nivel];
        $nombre = NivelDano::ELEMENTOS[$sistema][$elemento] ?? $elemento;

        return [
            'combo' => $c['codigo'],
            'etiqueta' => $c['etiqueta'],
            'nivel' => $nivel,
            'motivo' => 'Daño '.mb_strtolower(NivelDano::ETIQUETA_NIVEL[$nivel]).' en '.mb_strtolower((string) $nombre).'.',
        ];
    }

    /**
     * Los materiales de un combo, con el kit de cubierta si se eligió.
     *
     * @return array{kits: list<array{kit: string, items: list<array{descripcion: string, unidad: string, cantidad: string}>}>, sin_lista: bool, nota: string}
     */
    public static function materiales(string $sistema, ?string $nivel, ?string $kitCubierta = null): array
    {
        $vacio = ['kits' => [], 'sin_lista' => true, 'nota' => ''];

        if ($nivel === null || ! isset(self::MATERIALES[$sistema])) {
            return $vacio;
        }

        // El Anexo 2 solo trae columnas para leve, moderado y severo. Para el
        // colapso total el formato nombra un combo pero NO lista sus
        // materiales, así que aquí no hay nada que devolver. Se dice, en vez de
        // rellenarlo con las cantidades del nivel severo: son materiales
        // públicos y una cifra inventada no se distingue de una correcta al
        // imprimirla.
        if ($nivel === 'COLAPSO_TOTAL') {
            return [
                'kits' => [],
                'sin_lista' => true,
                'nota' => 'El Anexo 2 no define lista de materiales para colapso total; la determina el Consejo Territorial.',
            ];
        }

        $kits = self::filtrar(self::MATERIALES[$sistema]['combo'], $nivel);

        if ($kitCubierta !== null && isset(self::MATERIALES[$sistema]['cubierta'][$kitCubierta])) {
            $kits = array_merge($kits, self::filtrar(self::MATERIALES[$sistema]['cubierta'][$kitCubierta], $nivel));
        }

        return ['kits' => $kits, 'sin_lista' => $kits === [], 'nota' => ''];
    }

    /**
     * Deja de cada kit solo los ítems que ese nivel lleva.
     *
     * Un kit que se queda sin ítems no se devuelve: una tarjeta vacía en la
     * pantalla del almacén solo confunde.
     */
    private static function filtrar(array $kits, string $nivel): array
    {
        $salida = [];

        foreach ($kits as $kit) {
            $items = [];

            foreach ($kit['items'] as $item) {
                if (isset($item['cantidades'][$nivel])) {
                    $items[] = [
                        'descripcion' => $item['descripcion'],
                        'unidad' => $item['unidad'],
                        'cantidad' => $item['cantidades'][$nivel],
                    ];
                }
            }

            if ($items !== []) {
                $salida[] = ['kit' => $kit['kit'], 'items' => $items];
            }
        }

        return $salida;
    }

    /** Cuántas filas del anexo lleva un nivel. Existe para poder cotejar con el impreso. */
    public static function contarItems(string $sistema, string $nivel, ?string $kitCubierta = null): int
    {
        $total = 0;

        foreach (self::materiales($sistema, $nivel, $kitCubierta)['kits'] as $kit) {
            $total += count($kit['items']);
        }

        return $total;
    }
}
