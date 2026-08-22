// El panel que explica de dónde sale el combo.
//
// Lo que estas pruebas protegen no es el cálculo —ese ya lo fija `combo.spec.ts`
// contra la tabla compartida con PHP— sino algo más sutil y más peligroso: que
// lo explicado sea EXACTAMENTE lo decidido. Un panel que señalara un elemento
// distinto del que fijó el combo sería peor que no tener panel, porque daría por
// auditada una decisión que nadie auditó.

import { describe, expect, it } from 'vitest';
import { determinarCombo, type TablasCombo } from './combo';
import { explicarCombo } from './explicacion';
import type { ElementoEvaluable } from './tipos';

const TABLAS: TablasCombo = {
	niveles: ['LEVE', 'MODERADO', 'SEVERO', 'COLAPSO_TOTAL'],
	estructurales: {
		MAMPOSTERIA: ['VIGAS_COLUMNAS', 'MUROS_CARGA'],
		MADERA: ['VIGAS_COLUMNAS']
	},
	combos: {
		MAMPOSTERIA: {
			LEVE: { codigo: 'COMBO_1', etiqueta: 'Combo 1' },
			MODERADO: { codigo: 'COMBO_2', etiqueta: 'Combo 2' },
			SEVERO: { codigo: 'COMBO_3', etiqueta: 'Combo 3' },
			COLAPSO_TOTAL: {
				codigo: 'COLAPSO_MAMPOSTERIA',
				etiqueta: 'Combo vivienda colapso total — Mampostería'
			}
		},
		MADERA: {
			LEVE: { codigo: 'COMBO_4', etiqueta: 'Combo 4' },
			MODERADO: { codigo: 'COMBO_5', etiqueta: 'Combo 5' },
			SEVERO: { codigo: 'COMBO_6', etiqueta: 'Combo 6' },
			COLAPSO_TOTAL: {
				codigo: 'COLAPSO_MADERA',
				etiqueta: 'Combo vivienda colapso total — Madera'
			}
		}
	}
};

/** Un nivel con la forma que trae el catálogo. Los criterios no importan aquí. */
function nivel(codigo: string, etiqueta: string, alcance: string) {
	return { codigo, etiqueta, alcance, criterios: [] };
}

const TODOS = [
	nivel('LEVE', 'Leve', 'Reparación'),
	nivel('MODERADO', 'Moderado', 'Reforzamiento'),
	nivel('SEVERO', 'Severo', 'Reconstrucción parcial'),
	nivel('COLAPSO_TOTAL', 'Colapso total', 'Colapso total')
];

const ELEMENTOS: ElementoEvaluable[] = [
	{ codigo: 'VIGAS_COLUMNAS', etiqueta: 'Vigas y columnas', estructural: true, niveles: TODOS },
	{ codigo: 'MUROS_CARGA', etiqueta: 'Muros de carga', estructural: true, niveles: TODOS },
	{ codigo: 'MUROS_DIVISORIOS', etiqueta: 'Muros divisorios', estructural: false, niveles: TODOS },
	{ codigo: 'CUBIERTA', etiqueta: 'Cubierta', estructural: false, niveles: TODOS }
];

/** Explica lo que el propio cálculo decidió, que es como se usa en la pantalla. */
function explicar(danos: Record<string, string | null>, colapso = false) {
	const resultado = determinarCombo(TABLAS, 'MAMPOSTERIA', danos, colapso);

	return {
		resultado,
		explicacion: explicarCombo(TABLAS, 'MAMPOSTERIA', ELEMENTOS, danos, resultado, colapso)
	};
}

describe('lo explicado es lo decidido', () => {
	it('el elemento señalado es el mismo que fijó el combo', () => {
		// Si esto se separara, el panel daría por auditada una decisión distinta de
		// la tomada. Es la razón de ser de este archivo.
		const { resultado, explicacion } = explicar({
			VIGAS_COLUMNAS: 'LEVE',
			MUROS_CARGA: 'MODERADO'
		});

		const decide = explicacion.filas.filter((f) => f.decide);

		expect(decide).toHaveLength(1);
		expect(decide[0].codigo).toBe(resultado.elemento);
		expect(decide[0].codigo).toBe('MUROS_CARGA');
	});

	it('el combo resaltado en el mapa es el resultado', () => {
		const { resultado, explicacion } = explicar({ MUROS_CARGA: 'SEVERO' });
		const resaltado = explicacion.mapa.filter((f) => f.esElResultado);

		expect(resaltado).toHaveLength(1);
		expect(resaltado[0].combo).toBe(resultado.etiqueta);
	});
});

describe('el caso contraintuitivo: la cubierta no decide', () => {
	// Una cubierta arrancada sobre una estructura intacta NO sube el combo. Es la
	// regla impresa del numeral 6 y lo que cualquier revisor va a cuestionar, así
	// que el panel tiene que enseñarlo, no esconderlo.
	const { resultado, explicacion } = explicar({
		VIGAS_COLUMNAS: 'LEVE',
		CUBIERTA: 'SEVERO'
	});

	it('el combo sale del daño leve de la estructura', () => {
		expect(resultado.etiqueta).toBe('Combo 1');
	});

	it('la cubierta aparece con su daño real, pero no decide', () => {
		const cubierta = explicacion.filas.find((f) => f.codigo === 'CUBIERTA');

		expect(cubierta?.nivelEtiqueta).toBe('Severo');
		expect(cubierta?.estructural).toBe(false);
		expect(cubierta?.decide).toBe(false);
	});

	it('la escala llega solo hasta leve, no hasta severo', () => {
		const alcanzados = explicacion.escala.filter((p) => p.alcanzado).map((p) => p.codigo);

		expect(alcanzados).toEqual(['LEVE']);
	});
});

describe('la escala de gravedad', () => {
	it('se pinta llena hasta el nivel que mandó', () => {
		const { explicacion } = explicar({ MUROS_CARGA: 'SEVERO' });

		expect(explicacion.escala.map((p) => p.alcanzado)).toEqual([true, true, true, false]);
		expect(explicacion.escala.filter((p) => p.esElNivel).map((p) => p.codigo)).toEqual(['SEVERO']);
	});

	it('lleva el alcance del anexo, que es lo que le importa a la familia', () => {
		const { explicacion } = explicar({ MUROS_CARGA: 'MODERADO' });
		const moderado = explicacion.escala.find((p) => p.codigo === 'MODERADO');

		expect(moderado?.alcance).toBe('Reforzamiento');
	});
});

describe('colapso estructural total', () => {
	const { explicacion } = explicar({}, true);

	it('no lista elementos, porque esa tabla no se llena', () => {
		// El formato dice «marque solo esta casilla». Enseñar la tabla vacía
		// sugeriría que alguien se saltó unas filas.
		expect(explicacion.filas).toEqual([]);
		expect(explicacion.colapsoTotal).toBe(true);
	});

	it('el mapa apunta al combo de colapso', () => {
		const resaltado = explicacion.mapa.find((f) => f.esElResultado);

		expect(resaltado?.nivel).toBe('COLAPSO_TOTAL');
	});
});

describe('sin daño estructural', () => {
	// Es cuando más falta hace el panel: la familia que no accede al banco de
	// materiales es la que más va a preguntar por qué.
	const { resultado, explicacion } = explicar({ CUBIERTA: 'MODERADO' });

	it('no corresponde combo', () => {
		expect(resultado.combo).toBeNull();
	});

	it('aun así se listan los estructurales, en «no afectado»', () => {
		const estructurales = explicacion.filas.filter((f) => f.estructural);

		expect(estructurales).toHaveLength(2);
		expect(estructurales.every((f) => f.nivel === null)).toBe(true);
		expect(explicacion.filas.some((f) => f.decide)).toBe(false);
	});

	it('la escala queda entera apagada', () => {
		expect(explicacion.escala.every((p) => !p.alcanzado)).toBe(true);
	});
});

describe('empate entre dos estructurales', () => {
	it('decide el primero del formato, como el cálculo', () => {
		const { resultado, explicacion } = explicar({
			VIGAS_COLUMNAS: 'MODERADO',
			MUROS_CARGA: 'MODERADO'
		});

		expect(resultado.elemento).toBe('VIGAS_COLUMNAS');
		expect(explicacion.filas.find((f) => f.decide)?.codigo).toBe('VIGAS_COLUMNAS');
	});
});

describe('madera', () => {
	it('los muros de carga no son estructurales allí', () => {
		// En madera ese elemento ni siquiera existe en la tabla del 5.4. Lo que se
		// comprueba es que la marca de «estructural» sale de los catálogos y no de
		// una lista escrita a mano en el navegador.
		const elementos: ElementoEvaluable[] = [
			{ codigo: 'VIGAS_COLUMNAS', etiqueta: 'Vigas y columnas', estructural: true, niveles: TODOS },
			{ codigo: 'CUBIERTA', etiqueta: 'Cubierta', estructural: false, niveles: TODOS }
		];
		const danos = { VIGAS_COLUMNAS: 'SEVERO' };
		const resultado = determinarCombo(TABLAS, 'MADERA', danos);
		const explicacion = explicarCombo(TABLAS, 'MADERA', elementos, danos, resultado);

		expect(explicacion.mapa.find((f) => f.esElResultado)?.combo).toBe('Combo 6');
		expect(explicacion.filas.find((f) => f.decide)?.codigo).toBe('VIGAS_COLUMNAS');
	});
});
