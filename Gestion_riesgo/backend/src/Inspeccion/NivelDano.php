<?php

declare(strict_types=1);

namespace App\Inspeccion;

/**
 * El Anexo 1 del formato de inspección: qué significa cada nivel de daño.
 *
 * Es la pieza que ordena todo el numeral 5.4, y por una razón que no salta a la
 * vista al mirar el papel: las casillas marcadas «N/A» en la tabla de
 * evaluación NO son arbitrarias. Son exactamente las combinaciones
 * (elemento, nivel) que este anexo deja sin definir.
 *
 *   • En mampostería, el daño Leve no describe la placa de piso ni las
 *     instalaciones eléctricas — y son justo las dos casillas N/A de esa tabla.
 *   • En madera, el daño Leve no describe los muros ni las instalaciones
 *     eléctricas — otra vez, las dos casillas N/A.
 *
 * Coinciden una por una. Por eso los niveles que se pueden elegir para cada
 * elemento se DERIVAN de aquí (`nivelesDe`) en vez de escribirse aparte: si se
 * escribieran dos veces, un día dirían cosas distintas y el formulario dejaría
 * clasificar un daño que el anexo no sabe describir.
 *
 * Los descriptores también se muestran en pantalla al elegir el nivel. Hoy el
 * profesional los consulta en una hoja impresa; tenerlos donde se toma la
 * decisión es la diferencia entre clasificar con el criterio de la norma y
 * clasificar de memoria.
 */
final class NivelDano
{
    public const MAMPOSTERIA = 'MAMPOSTERIA';

    public const MADERA = 'MADERA';

    /** @var list<string> */
    public const SISTEMAS = [self::MAMPOSTERIA, self::MADERA];

    /**
     * Los cuatro niveles, del más leve al más grave.
     *
     * El orden importa: la regla del numeral 6 elige el peor nivel entre los
     * elementos estructurales, y «peor» se decide por esta posición.
     */
    public const NIVELES = ['LEVE', 'MODERADO', 'SEVERO', 'COLAPSO_TOTAL'];

    public const ETIQUETA_NIVEL = [
        'LEVE' => 'Leve',
        'MODERADO' => 'Moderado',
        'SEVERO' => 'Severo',
        'COLAPSO_TOTAL' => 'Colapso total',
    ];

    /**
     * Qué se repara en cada nivel, según los títulos del propio anexo.
     *
     * Se muestra junto al nivel porque cambia la conversación con la familia:
     * no es lo mismo decir «daño moderado» que «hay que reforzar».
     */
    public const ALCANCE_NIVEL = [
        'LEVE' => 'Reparación',
        'MODERADO' => 'Reforzamiento',
        'SEVERO' => 'Reconstrucción parcial',
        'COLAPSO_TOTAL' => 'Colapso total',
    ];

    /**
     * Los elementos de cada sistema, EN EL ORDEN DE LA TABLA DEL NUMERAL 5.4.
     *
     * No en el del anexo, que los lista en otro orden: quien llena el formulario
     * va siguiendo el papel, y hacerle saltar de fila sería pedirle que se
     * equivoque.
     */
    public const ELEMENTOS = [
        self::MAMPOSTERIA => [
            'VIGAS_COLUMNAS' => 'Vigas y columnas',
            'MUROS_CARGA' => 'Muros de carga',
            'MUROS_DIVISORIOS' => 'Muros divisorios',
            'PLACA_PISO' => 'Placa de piso',
            'CUBIERTA' => 'Cubierta',
            'HIDROSANITARIAS' => 'Instalaciones hidrosanitarias',
            'ELECTRICAS' => 'Instalaciones eléctricas',
        ],
        self::MADERA => [
            'VIGAS_COLUMNAS' => 'Vigas y columnas',
            'ENTREPISOS' => 'Entrepisos',
            'MUROS_MADERA' => 'Muros en madera',
            'CUBIERTA' => 'Cubierta',
            'HIDROSANITARIAS' => 'Instalaciones hidrosanitarias',
            'ELECTRICAS' => 'Instalaciones eléctricas',
        ],
    ];

    /**
     * Los elementos que el numeral 6 llama «el sistema estructural».
     *
     * De ellos, y solo de ellos, sale el combo de materiales. Una cubierta
     * destruida sobre una estructura intacta no convierte la vivienda en un caso
     * severo, y el banco de materiales tiene que reflejar eso.
     *
     * El formato nombra «Vigas y Columnas, Muros de Carga», que es terminología
     * de mampostería: en madera no existe el muro de carga. Ahí queda solo
     * «Vigas y columnas», que es el equivalente estructural — es una lectura de
     * un texto escrito pensando en el otro sistema, y conviene saberlo.
     */
    public const ESTRUCTURALES = [
        self::MAMPOSTERIA => ['VIGAS_COLUMNAS', 'MUROS_CARGA'],
        self::MADERA => ['VIGAS_COLUMNAS'],
    ];

    /**
     * El Anexo 1, tal cual, con una corrección: en madera / moderado /
     * hidrosanitarias el original repite el texto («Desacople de los accesorios
     * de la tuberíaDesacople de los accesorios de la tubería») y arrastra el
     * nombre del elemento dentro de la descripción. Se transcribe limpio.
     *
     * @var array<string, array<string, array<string, list<string>>>>
     */
    private const DESCRIPTORES = [
        'MAMPOSTERIA' => [
            'VIGAS_COLUMNAS' => [
                'LEVE' => ['Pérdida de recubrimiento de concreto.'],
                'MODERADO' => [
                    'Pérdida de recubrimiento de concreto.',
                    'Pandeo local (desplazamiento lateral del eje del elemento)',
                ],
                'SEVERO' => [
                    'Pandeo local (desplazamiento lateral del eje del elemento)',
                    'Falla en la sección transversal del elemento estructural por compresión, cortante, flexión y flexo-compresión',
                    'Deformación del acero de refuerzo (longitudinal y transversal)',
                ],
                'COLAPSO_TOTAL' => [
                    'Aplastamiento del concreto',
                    'Falla en la sección transversal del elemento estructural por compresión, cortante, flexión y flexo-compresión',
                    'Falla entre la conexión (nodos) viga-columna',
                    'Deformación y fractura del acero de refuerzo (longitudinal y transversal)',
                    'Desplome de vigas y columnas',
                ],
            ],
            'MUROS_CARGA' => [
                'LEVE' => [
                    'Formación de grietas verticales y  horizontales en un 10% de las hiladas del muro y mortero fisurado.',
                    'Grietas orientadas diagonalmente pero no continuas a través del muro, se forman las grietas sin que evidencien desplazamiento horizontal',
                ],
                'MODERADO' => [
                    'Formación de grietas verticales y  horizontales en un 30% de las hiladas del muro y mortero fisurado.',
                    'Las grietas diagonales llegan a alcanzar las esquinas.',
                    'Se presentan roturas locales en la mampostería',
                ],
                'SEVERO' => [
                    'Se presentan roturas locales en la mampostería',
                    'Desplazamiento horizontal a lo largo de grietas escalonadas.',
                    'Grietas que atraviesan la totalidad de la mampostería',
                    'Falla por tracción diagonal por carecer de vigas y columnas de amarre',
                ],
                'COLAPSO_TOTAL' => [
                    'Aplastamiento local de la mampostería',
                    'Desplome o inclinación apreciable de los muros',
                ],
            ],
            'MUROS_DIVISORIOS' => [
                'LEVE' => [
                    'Mortero fisurado en la parte superior e inferior, (entre marcos y muros)',
                ],
                'MODERADO' => [
                    'Grietas escalonadas y continuas a través del muro.',
                    'Mortero fisurado a lo largo de las grietas presentadas.',
                ],
                'SEVERO' => [
                    'Grietas escalonadas y continuas que atraviesan la totalidad del muro.',
                    'Mortero fisurado a lo largo de las grietas presentadas.',
                ],
                'COLAPSO_TOTAL' => [
                    'Mortero fisurado a lo largo de las grietas presentadas.',
                    'Aplastamiento local de la mampostería.',
                    'Desplome o inclinación apreciable de los muros',
                ],
            ],
            'PLACA_PISO' => [
                'MODERADO' => [
                    'Grietas en la placa de piso, las cuales se presentan en ambas direcciones',
                ],
                'SEVERO' => [
                    'Grietas longitudinales y transversales, asentamientos diferenciales de  la placa de piso (inclinación)',
                ],
                'COLAPSO_TOTAL' => ['Desplome de la placa'],
            ],
            'CUBIERTA' => [
                'LEVE' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con perdida, falla o rotura (entre el 10% y 30% del área total de la cubierta)',
                ],
                'MODERADO' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (entre el 31% y 50% del área total de la cubierta)',
                ],
                'SEVERO' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (entre el 51% y 80% del área total de la cubierta)',
                    'Deformación en el 50% de los elementos de la estructura o armazón de soporte (correas, cumbrera, puntales, riostras, viguetas)',
                ],
                'COLAPSO_TOTAL' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (100% del área total de la cubierta)',
                    'Colapso de la estructura o armazón de soporte (correas, cumbrera, puntales, riostras, viguetas)',
                ],
            ],
            'HIDROSANITARIAS' => [
                'LEVE' => ['Fisuras o roturas en la tubería'],
                'MODERADO' => [
                    'Fisuras o roturas en la tubería',
                    'Desacople de los accesorios de la tubería',
                ],
                'SEVERO' => [
                    'Desacople de accesorios o fugas en la tubería',
                    'Afectación estructural con presencia de grietas y obstrucción del flujo e infiltraciones en tanques de almacenamiento de agua y/o pozos sépticos.',
                ],
                'COLAPSO_TOTAL' => [
                    'Desacople de accesorios y fugas en la tubería',
                    'Afectación estructural con presencia de grietas y obstrucción del flujo e infiltraciones en tanques de almacenamiento de agua y/o pozos sépticos.',
                ],
            ],
            'ELECTRICAS' => [
                'MODERADO' => ['Desacople de los accesorios de la tubería'],
                'SEVERO' => [
                    'Desacople de accesorios en tubería',
                    'Corto circuito de la red eléctrica',
                ],
                'COLAPSO_TOTAL' => [
                    'Desacople de accesorios en tubería',
                    'Corto circuito de la red eléctrica',
                ],
            ],
        ],
        'MADERA' => [
            'VIGAS_COLUMNAS' => [
                'LEVE' => [
                    'Fisuras en los elementos',
                    'Pérdida de la estructura fibrosa de la madera',
                ],
                'MODERADO' => [
                    'Grietas y fisuras en los elementos',
                    'Desplazamiento de los elementos de su posición inicial',
                ],
                'SEVERO' => [
                    'Disminución en la sección transversal de los elementos',
                    'Perdida de anclaje entre el elemento y el sistema estructural',
                    'Fractura del elemento',
                ],
                'COLAPSO_TOTAL' => [
                    'Perdida de anclaje entre el elemento y el sistema estructural',
                    'Falla entre la conexión (nodos) viga-columna',
                    'Desplome de vigas y columnas',
                ],
            ],
            'ENTREPISOS' => [
                'LEVE' => ['Pérdida de su estructura fibrosa de la madera'],
                'MODERADO' => ['Grietas longitudinales y transversales'],
                'SEVERO' => ['Grietas longitudinales y transversales y pandeo del entrepiso'],
                'COLAPSO_TOTAL' => ['Desplome o inclinación apreciable'],
            ],
            'MUROS_MADERA' => [
                'MODERADO' => ['Perdida de anclaje entre el elemento y el sistema estructural'],
                'SEVERO' => [
                    'Perdida de anclaje entre el elemento y el sistema estructural',
                    'Fractura del elemento',
                ],
                'COLAPSO_TOTAL' => [
                    'Perdida de anclaje entre el elemento y el sistema estructural',
                    'Desplome o inclinación apreciable',
                ],
            ],
            'CUBIERTA' => [
                'LEVE' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (entre el 10% y 30% del área total de la cubierta)',
                ],
                'MODERADO' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (entre el 31% y 50% del área total de la cubierta)',
                ],
                'SEVERO' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (51 y 80% del área total de la cubierta)',
                    'Deformación en el 50% de los elementos de la estructura o armazón de soporte (correas, cumbrera, puntales, riostras, viguetas)',
                ],
                'COLAPSO_TOTAL' => [
                    'Desplazamiento de una o varias tejas de su posición inicial, con falla o rotura (100% del área total de la cubierta)',
                    'Colapso de la estructura o armazón de soporte (correas, cumbrera, puntales, riostras, viguetas)',
                ],
            ],
            'HIDROSANITARIAS' => [
                'LEVE' => ['Fisuras o roturas en la tubería'],
                'MODERADO' => [
                    'Fisuras o roturas en la tubería',
                    'Desacople de los accesorios de la tubería',
                ],
                'SEVERO' => [
                    'Desacople de accesorios o fugas en la tubería',
                    'Afectación estructural con presencia de grietas y obstrucción del flujo e infiltraciones en tanques de almacenamiento de agua y/o pozos sépticos.',
                ],
                'COLAPSO_TOTAL' => [
                    'Desacople de accesorios o fugas en la tubería',
                    'Afectación estructural con presencia de grietas y obstrucción del flujo e infiltraciones en tanques de almacenamiento de agua y/o pozos sépticos.',
                ],
            ],
            'ELECTRICAS' => [
                'MODERADO' => ['Desacople de los accesorios de la red eléctrica'],
                'SEVERO' => [
                    'Desacople de los accesorios de la red eléctrica',
                    'Corto circuito de la red eléctrica',
                ],
                'COLAPSO_TOTAL' => [
                    'Desacople de los accesorios de la red eléctrica',
                    'Corto circuito de la red eléctrica',
                ],
            ],
        ],    ];

    /** @return list<string> los elementos de un sistema, en el orden del formato */
    public static function elementos(string $sistema): array
    {
        return array_keys(self::ELEMENTOS[$sistema] ?? []);
    }

    /**
     * Los niveles que se pueden elegir para un elemento.
     *
     * Derivado del anexo, no escrito a mano: un elemento solo admite los niveles
     * que el anexo sabe describir.
     *
     * @return list<string>
     */
    public static function nivelesDe(string $sistema, string $elemento): array
    {
        $porNivel = self::DESCRIPTORES[$sistema][$elemento] ?? [];

        // Se recorre NIVELES y no las claves del anexo para que el resultado
        // salga siempre de leve a colapso, sin depender del orden en que se
        // transcribió.
        return array_values(array_filter(
            self::NIVELES,
            static fn (string $n): bool => isset($porNivel[$n])
        ));
    }

    public static function permite(string $sistema, string $elemento, string $nivel): bool
    {
        return isset(self::DESCRIPTORES[$sistema][$elemento][$nivel]);
    }

    /** @return list<string> los criterios del anexo para ese daño */
    public static function descriptores(string $sistema, string $elemento, string $nivel): array
    {
        return self::DESCRIPTORES[$sistema][$elemento][$nivel] ?? [];
    }

    /**
     * El peor de dos niveles. `null` es «sin daño» y pierde contra cualquiera.
     */
    public static function peor(?string $a, ?string $b): ?string
    {
        if ($a === null) {
            return $b;
        }
        if ($b === null) {
            return $a;
        }

        return array_search($a, self::NIVELES, true) >= array_search($b, self::NIVELES, true)
            ? $a
            : $b;
    }

    /**
     * Todo lo que el formulario necesita para dibujar el numeral 5.4.
     *
     * Va junto en una sola respuesta —elementos, niveles permitidos y los
     * criterios de cada uno— porque el teléfono tiene que poder llenar la tabla
     * sin señal, y pedir los criterios elemento por elemento no funcionaría en
     * una vereda.
     */
    public static function paraApi(): array
    {
        $salida = [];

        foreach (self::SISTEMAS as $sistema) {
            foreach (self::ELEMENTOS[$sistema] as $codigo => $etiqueta) {
                $niveles = [];

                foreach (self::nivelesDe($sistema, $codigo) as $nivel) {
                    $niveles[] = [
                        'codigo' => $nivel,
                        'etiqueta' => self::ETIQUETA_NIVEL[$nivel],
                        'alcance' => self::ALCANCE_NIVEL[$nivel],
                        'criterios' => self::descriptores($sistema, $codigo, $nivel),
                    ];
                }

                $salida[$sistema][] = [
                    'codigo' => $codigo,
                    'etiqueta' => $etiqueta,
                    'estructural' => in_array($codigo, self::ESTRUCTURALES[$sistema], true),
                    'niveles' => $niveles,
                ];
            }
        }

        return $salida;
    }
}
