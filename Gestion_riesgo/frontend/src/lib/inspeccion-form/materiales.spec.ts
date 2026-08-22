// La lista de materiales del navegador, contra la que produce PHP.
//
// El fixture lo genera el servidor a partir del Anexo 2; esta prueba comprueba
// que el filtro del navegador llega exactamente al mismo resultado. Es el mismo
// mecanismo que guarda el cálculo del combo: si las dos implementaciones se
// separan, falla una de las dos suites en vez de divergir en silencio.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { materialesDe, type Anexo2 } from './materiales';

const base = new URL('../../../../backend/', import.meta.url);

/** El Anexo 2 tal como lo manda el servidor en los catálogos. */
const anexo: Anexo2 = JSON.parse(
	readFileSync(fileURLToPath(new URL('tests/fixtures/anexo2.json', base)), 'utf8')
);

type Caso = {
	sistema: string;
	nivel: string;
	kit: string | null;
	total: number;
	sin_lista: boolean;
	kits: string[];
};

const casos: Caso[] = JSON.parse(
	readFileSync(fileURLToPath(new URL('tests/fixtures/materiales.json', base)), 'utf8')
).casos;

describe('la lista de materiales coincide con la del servidor', () => {
	it('el fixture cubre los dos sistemas y los cuatro niveles', () => {
		expect(casos.length).toBe(24);
	});

	it.each(casos.map((c) => [`${c.sistema} · ${c.nivel} · ${c.kit ?? 'sin cubierta'}`, c] as const))(
		'%s',
		(_nombre, caso) => {
			const r = materialesDe(anexo, caso.sistema, caso.nivel, caso.kit);

			expect(r).not.toBeNull();
			expect(r!.kits.map((k) => k.kit)).toEqual(caso.kits);
			expect(r!.kits.reduce((s, k) => s + k.items.length, 0)).toBe(caso.total);
			expect(r!.sin_lista).toBe(caso.sin_lista);
		}
	);
});

describe('casos límite', () => {
	it('sin sistema constructivo todavía no hay lista', () => {
		expect(materialesDe(anexo, '', 'LEVE', null)).toBeNull();
	});

	it('sin daño estructural no hay nivel y por tanto no hay lista', () => {
		expect(materialesDe(anexo, 'MAMPOSTERIA', null, 'ZINC')).toBeNull();
	});

	it('el colapso total se declara sin lista, con su explicación', () => {
		// No se rellena con las cantidades del severo: son materiales públicos y
		// una cifra inventada no se distingue de una correcta al imprimirla.
		const r = materialesDe(anexo, 'MADERA', 'COLAPSO_TOTAL', 'ZINC');

		expect(r!.kits).toEqual([]);
		expect(r!.sin_lista).toBe(true);
		expect(r!.nota).toContain('Anexo 2 no define');
	});

	it('un kit de cubierta que ese sistema no tiene no añade nada', () => {
		const solo = materialesDe(anexo, 'MADERA', 'SEVERO', null)!;
		const conFalso = materialesDe(anexo, 'MADERA', 'SEVERO', 'FIBROCEMENTO')!;

		expect(conFalso.kits.length).toBe(solo.kits.length);
	});

	it('un kit sin ítems en ese nivel no se muestra vacío', () => {
		// Una tarjeta vacía en la pantalla del almacén solo confunde.
		const r = materialesDe(anexo, 'MAMPOSTERIA', 'LEVE', null)!;

		for (const kit of r.kits) expect(kit.items.length).toBeGreaterThan(0);
	});
});
