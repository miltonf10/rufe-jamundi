// De dónde sale el combo: la cadena de razonamiento, lista para pintar.
//
// El numeral 6 muestra un veredicto —«Combo 2»— y una frase. Es cierto, pero
// quien revisa el expediente, o la familia que pregunta por qué le dan el 2 y no
// el 3, no puede seguir el razonamiento sin rehacerlo con los dos anexos
// impresos delante. Y de este combo sale una entrega de materiales públicos: una
// decisión que reparte recursos y no se puede auditar se parece demasiado a una
// decisión arbitraria, aunque no lo sea.
//
// Esto NO calcula nada. El combo lo decide `determinarCombo()` —espejo del
// servidor, que es quien manda— y aquí solo se reordena lo ya decidido para
// enseñarlo. Que el elemento señalado como «decide» sea el mismo que devolvió el
// cálculo está fijado por una prueba: explicar una decisión distinta de la
// tomada sería peor que no explicar nada.
//
// Va en un archivo aparte de `combo.ts` a propósito. Ese es el espejo exacto de
// `backend/src/Inspeccion/BancoMateriales.php` y se ejercita contra la tabla
// compartida `backend/tests/fixtures/combos.json`; meterle funciones que PHP no
// tiene emborronaría el único contrato que impide que las dos implementaciones
// se separen en silencio.

import type { Danos, NivelDano, ResultadoCombo, TablasCombo } from './combo';
import type { ElementoEvaluable } from './tipos';

/** La regla del numeral 6, textual. Se cita, no se parafrasea. */
export const REGLA_NUMERAL_6 =
	'Prevalece el nivel de daño identificado sobre el sistema estructural (Vigas y Columnas, Muros de Carga).';

export type FilaEvaluacion = {
	codigo: string;
	etiqueta: string;
	/** Si pesa en la decisión del combo. */
	estructural: boolean;
	nivel: NivelDano | null;
	nivelEtiqueta: string | null;
	/** El estructural cuyo nivel fijó el combo. Solo uno, o ninguno. */
	decide: boolean;
};

export type PeldanoEscala = {
	codigo: NivelDano;
	etiqueta: string;
	alcance: string;
	/** El daño estructural llegó hasta aquí. */
	alcanzado: boolean;
	/** Es exactamente el nivel que fijó el combo. */
	esElNivel: boolean;
};

export type FilaCombo = {
	nivel: NivelDano;
	nivelEtiqueta: string;
	combo: string;
	esElResultado: boolean;
};

export type Explicacion = {
	regla: string;
	colapsoTotal: boolean;
	/** Vacío con colapso total: la tabla del 5.4 no se llena. */
	filas: FilaEvaluacion[];
	escala: PeldanoEscala[];
	mapa: FilaCombo[];
};

/**
 * Las etiquetas de cada nivel, recogidas de los elementos del sistema.
 *
 * No hay un catálogo suelto de niveles con nombre: viven dentro de cada elemento
 * porque el Anexo 1 no define todos los niveles para todos los elementos. Se
 * toma la primera aparición de cada uno, que basta —la etiqueta de «Moderado» es
 * la misma la defina quien la defina—.
 */
function etiquetasDeNivel(
	elementos: ElementoEvaluable[]
): Map<string, { etiqueta: string; alcance: string }> {
	const mapa = new Map<string, { etiqueta: string; alcance: string }>();

	for (const elemento of elementos) {
		for (const nivel of elemento.niveles) {
			if (!mapa.has(nivel.codigo)) {
				mapa.set(nivel.codigo, { etiqueta: nivel.etiqueta, alcance: nivel.alcance });
			}
		}
	}

	return mapa;
}

/**
 * La explicación del combo ya decidido.
 *
 * `resultado` viene de `determinarCombo()` y no se recalcula: esta función lo
 * toma como un hecho y se limita a mostrar de dónde salió.
 */
export function explicarCombo(
	tablas: TablasCombo,
	sistema: string,
	elementos: ElementoEvaluable[],
	danos: Danos,
	resultado: ResultadoCombo,
	colapsoTotal = false
): Explicacion {
	const nombres = etiquetasDeNivel(elementos);
	const orden = tablas.niveles;
	const estructurales = tablas.estructurales[sistema] ?? [];

	// Con colapso total la tabla por elementos no se llena —«marque solo esta
	// casilla», dice el formato—, así que enseñarla vacía sugeriría que alguien
	// se saltó unas filas.
	const filas: FilaEvaluacion[] = colapsoTotal
		? []
		: elementos.map((elemento) => {
				const nivel = danos[elemento.codigo] ?? null;

				return {
					codigo: elemento.codigo,
					etiqueta: elemento.etiqueta,
					estructural: estructurales.includes(elemento.codigo),
					nivel,
					nivelEtiqueta: nivel ? (nombres.get(nivel)?.etiqueta ?? nivel) : null,
					decide: elemento.codigo === resultado.elemento
				};
			});

	const hasta = resultado.nivel === null ? -1 : orden.indexOf(resultado.nivel);

	const escala: PeldanoEscala[] = orden.map((codigo, i) => ({
		codigo,
		etiqueta: nombres.get(codigo)?.etiqueta ?? codigo,
		alcance: nombres.get(codigo)?.alcance ?? '',
		alcanzado: hasta >= 0 && i <= hasta,
		esElNivel: codigo === resultado.nivel
	}));

	const porSistema = tablas.combos[sistema] ?? {};

	const mapa: FilaCombo[] = orden
		.filter((nivel) => porSistema[nivel])
		.map((nivel) => ({
			nivel,
			nivelEtiqueta: nombres.get(nivel)?.etiqueta ?? nivel,
			combo: porSistema[nivel].etiqueta,
			esElResultado: porSistema[nivel].codigo === resultado.combo
		}));

	return { regla: REGLA_NUMERAL_6, colapsoTotal, filas, escala, mapa };
}
