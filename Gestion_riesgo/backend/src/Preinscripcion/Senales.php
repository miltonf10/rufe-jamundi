<?php

declare(strict_types=1);

namespace App\Preinscripcion;

use App\Inspeccion\NivelDano;

/**
 * Las señales de daño que un ciudadano puede reconocer mirando su casa.
 *
 * Es la traducción del numeral 5.4 del formato de inspección a algo que se
 * puede contestar sin ser ingeniero. Y es una TRADUCCIÓN, no una copia: el
 * formato pide clasificar cada elemento en Leve / Moderado / Severo / Colapso
 * según los criterios del Anexo 1, y eso exige criterio técnico. Pedírselo al
 * afectado produciría una clasificación inventada que después alguien tendría
 * que desmentir en la visita —y de esa clasificación depende cuántos bultos de
 * cemento se entregan—.
 *
 * Por eso aquí el ciudadano solo marca QUÉ VE. El nivel de daño lo sigue
 * poniendo el profesional con tarjeta.
 *
 * Cada señal declara a qué elemento del formato apunta (`elemento`), y esa es
 * la razón de que esta lista viva al lado de `NivelDano` y no suelta en el
 * frontend: cuando la solicitud se convierta en inspección, lo que el ciudadano
 * marcó le dice al profesional en qué filas de la tabla mirar primero. Una
 * prueba comprueba que ningún `elemento` se refiera a algo que el formato no
 * conoce.
 *
 * `icono` no es decoración. Andrés pidió que cada criterio se reconociera «con
 * sola verla», y en una vereda con mala señal eso no puede depender de que
 * carguen ocho fotografías: son dibujos SVG que el frontend trae dentro del
 * propio archivo.
 */
final class Senales
{
    /**
     * Ocho señales que cubren los siete grupos de elementos del formato.
     *
     * Muros y cubierta llevan dos cada uno —agrietado / caído, tejas rotas /
     * techo caído— porque son las dos afectaciones que la gente distingue sin
     * dudar y que más separan un caso leve de uno grave. Los demás elementos no
     * admiten esa distinción a ojo desde el patio de la casa.
     *
     * @var list<array{codigo: string, etiqueta: string, ayuda: string, elemento: string, icono: string}>
     */
    public const CATALOGO = [
        [
            'codigo' => 'PARED_AGRIETADA',
            'etiqueta' => 'Paredes agrietadas',
            'ayuda' => 'Grietas o rajaduras en los muros, aunque sigan en pie.',
            'elemento' => 'MUROS_CARGA',
            'icono' => 'pared-agrietada',
        ],
        [
            'codigo' => 'PARED_CAIDA',
            'etiqueta' => 'Paredes caídas o inclinadas',
            'ayuda' => 'Un muro se vino abajo, se abombó o quedó torcido.',
            'elemento' => 'MUROS_CARGA',
            'icono' => 'pared-caida',
        ],
        [
            'codigo' => 'COLUMNA_DANADA',
            'etiqueta' => 'Columnas o vigas partidas',
            'ayuda' => 'Las columnas o vigas que sostienen la casa están rotas, peladas o torcidas.',
            'elemento' => 'VIGAS_COLUMNAS',
            'icono' => 'columna-danada',
        ],
        [
            'codigo' => 'TECHO_TEJAS',
            'etiqueta' => 'Tejas rotas o corridas',
            'ayuda' => 'Faltan tejas, se rompieron o se movieron de su sitio.',
            'elemento' => 'CUBIERTA',
            'icono' => 'techo-tejas',
        ],
        [
            'codigo' => 'TECHO_CAIDO',
            'etiqueta' => 'Techo caído',
            'ayuda' => 'El techo se vino abajo, entero o por partes.',
            'elemento' => 'CUBIERTA',
            'icono' => 'techo-caido',
        ],
        [
            'codigo' => 'PISO_DANADO',
            'etiqueta' => 'Piso agrietado o hundido',
            'ayuda' => 'El piso se rajó, se hundió o quedó desnivelado.',
            'elemento' => 'PLACA_PISO',
            'icono' => 'piso-danado',
        ],
        [
            'codigo' => 'AGUA_DANADA',
            'etiqueta' => 'Tubería rota o fugas de agua',
            'ayuda' => 'Se rompió la tubería, hay fugas, o el tanque o el pozo quedaron dañados.',
            'elemento' => 'HIDROSANITARIAS',
            'icono' => 'agua-danada',
        ],
        [
            'codigo' => 'LUZ_DANADA',
            'etiqueta' => 'Instalación eléctrica dañada',
            'ayuda' => 'Cables sueltos o rotos, o la casa quedó sin luz por daño propio.',
            'elemento' => 'ELECTRICAS',
            'icono' => 'luz-danada',
        ],
    ];

    /** @return list<string> */
    public static function codigos(): array
    {
        return array_column(self::CATALOGO, 'codigo');
    }

    public static function existe(string $codigo): bool
    {
        return in_array($codigo, self::codigos(), true);
    }

    /**
     * La etiqueta, para guardarla junto a la solicitud.
     *
     * Se copia en la fila igual que hace el video con el nombre de su categoría:
     * si algún día se reescribe un texto de esta lista, el expediente tiene que
     * seguir diciendo qué fue lo que la persona marcó, no lo que hoy diría la
     * pantalla.
     */
    public static function etiqueta(string $codigo): string
    {
        foreach (self::CATALOGO as $s) {
            if ($s['codigo'] === $codigo) {
                return $s['etiqueta'];
            }
        }

        return $codigo;
    }

    /**
     * El dibujo que le corresponde a un código.
     *
     * A diferencia de la etiqueta, el icono NO se guarda con la solicitud: se
     * resuelve contra el catálogo de hoy. La etiqueta es prueba de qué se le
     * mostró a la persona y tiene que quedar congelada; el dibujo es solo la
     * forma de enseñárselo a quien revisa, y ahí conviene lo contrario — que
     * mejorar un dibujo lo mejore también en los expedientes viejos.
     *
     * Devuelve cadena vacía si el código ya no existe. `IconoSenal` dibuja
     * entonces su marca de «señal sin dibujo», que se ve y se corrige, en vez
     * de dejar un hueco en blanco que nadie nota.
     */
    public static function icono(string $codigo): string
    {
        foreach (self::CATALOGO as $s) {
            if ($s['codigo'] === $codigo) {
                return $s['icono'];
            }
        }

        return '';
    }

    /**
     * Los elementos del formato a los que apunta lo que marcó el ciudadano.
     *
     * Se usa al convertir la solicitud en inspección: no llena la tabla del
     * numeral 5.4 —eso sería clasificar por el profesional— pero sí le señala
     * qué filas revisar primero.
     *
     * @param  list<string>  $codigos
     * @return list<string>
     */
    public static function elementosApuntados(array $codigos): array
    {
        $elementos = [];

        foreach (self::CATALOGO as $s) {
            if (in_array($s['codigo'], $codigos, true)) {
                $elementos[$s['elemento']] = true;
            }
        }

        return array_keys($elementos);
    }

    /**
     * Todos los elementos que el formato conoce, en cualquiera de sus sistemas.
     *
     * Existe para que la prueba pueda comprobar que ninguna señal apunte a un
     * elemento inventado.
     *
     * @return list<string>
     */
    public static function elementosDelFormato(): array
    {
        $todos = [];

        foreach (NivelDano::SISTEMAS as $sistema) {
            foreach (NivelDano::elementos($sistema) as $elemento) {
                $todos[$elemento] = true;
            }
        }

        return array_keys($todos);
    }

    /**
     * El catálogo tal como lo consume el formulario público.
     *
     * Sin el `elemento`: al ciudadano no le dice nada y publicarlo solo invita a
     * que alguien intente deducir la clasificación técnica desde fuera.
     *
     * @return list<array{codigo: string, etiqueta: string, ayuda: string, icono: string}>
     */
    public static function paraApi(): array
    {
        return array_map(
            static fn (array $s): array => [
                'codigo' => $s['codigo'],
                'etiqueta' => $s['etiqueta'],
                'ayuda' => $s['ayuda'],
                'icono' => $s['icono'],
            ],
            self::CATALOGO
        );
    }
}
