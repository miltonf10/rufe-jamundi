// El cálculo del combo, contra la MISMA tabla de casos que ejecuta PHP.
//
// Es la prueba que impide que las dos implementaciones se separen. Si alguien
// toca una y no la otra, aquí o en `backend/tests/run.php` falla algo. Sin esto
// divergirían en silencio: el papel diría un combo y la pantalla otro, y de eso
// depende cuántos bultos de cemento recibe una familia.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { determinarCombo, motivoDelCombo, nivelEstructural, peor, type TablasCombo } from './combo';

/**
 * Las tablas, tal como las manda el servidor en `/inspeccion/catalogos`.
 *
 * Se escriben aquí y no se importan de PHP porque una prueba no puede ejecutar
 * el backend; que coincidan con las de allá lo garantiza la tabla de casos, que
 * fallaría en cuanto una de las dos se moviera.
 */
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

type Caso = {
	nombre: string;
	sistema: string;
	danos: Record<string, string | null>;
	colapso_total?: boolean;
	espera: { combo: string | null; nivel: string | null; elemento: string | null };
};

const ruta = fileURLToPath(new URL('../../../../backend/tests/fixtures/combos.json', import.meta.url));
const casos: Caso[] = JSON.parse(readFileSync(ruta, 'utf8')).casos;

describe('la tabla de casos compartida con PHP', () => {
	it('no se encogió sin que nadie se diera cuenta', () => {
		expect(casos.length).toBeGreaterThanOrEqual(20);
	});

	it.each(casos.map((c) => [c.nombre, c] as const))('%s', (_nombre, caso) => {
		const r = determinarCombo(TABLAS, caso.sistema, caso.danos, caso.colapso_total ?? false);

		expect(r.combo).toBe(caso.espera.combo);
		expect(r.nivel).toBe(caso.espera.nivel);

		if (!caso.colapso_total) {
			expect(nivelEstructural(TABLAS, caso.sistema, caso.danos).elemento).toBe(
				caso.espera.elemento
			);
		}
	});
});

describe('peor', () => {
	it('ordena por gravedad y trata la ausencia como sin daño', () => {
		expect(peor('LEVE', 'SEVERO', TABLAS.niveles)).toBe('SEVERO');
		expect(peor('SEVERO', 'LEVE', TABLAS.niveles)).toBe('SEVERO');
		expect(peor(null, 'LEVE', TABLAS.niveles)).toBe('LEVE');
		expect(peor(null, null, TABLAS.niveles)).toBeNull();
	});
});

describe('motivoDelCombo', () => {
	const elemento = (c: string) => ({ VIGAS_COLUMNAS: 'Vigas y columnas', MUROS_CARGA: 'Muros de carga' })[c] ?? c;
	const nivel = (c: string) => ({ LEVE: 'Leve', MODERADO: 'Moderado', SEVERO: 'Severo' })[c] ?? c;

	it('dice qué elemento decidió, no solo el resultado', () => {
		const r = determinarCombo(TABLAS, 'MAMPOSTERIA', { MUROS_CARGA: 'SEVERO' });

		expect(motivoDelCombo(r, elemento, nivel)).toBe('Daño severo en muros de carga.');
	});

	it('explica el colapso total sin señalar un elemento', () => {
		const r = determinarCombo(TABLAS, 'MADERA', {}, true);

		expect(motivoDelCombo(r, elemento, nivel)).toContain('colapso estructural total');
	});

	it('explica que sin daño estructural no corresponde combo', () => {
		const r = determinarCombo(TABLAS, 'MAMPOSTERIA', { CUBIERTA: 'SEVERO' });

		expect(motivoDelCombo(r, elemento, nivel)).toContain('no resultó afectado');
	});
});
