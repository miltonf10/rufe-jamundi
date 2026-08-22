// A dónde va cada formato de la cola.
//
// Dos formatos comparten una sola cola en IndexedDB, y quien los despacha es el
// Service Worker, que no se puede probar. Por eso la decisión —ruta y nombre
// del identificador— vive en una tabla de datos que sí se puede: un error aquí
// mandaría una inspección al endpoint del censo, que la rechazaría con un 4xx y
// la marcaría como «error» sin que nadie entendiera por qué.

import { describe, expect, it } from 'vitest';
import { DESTINO, tipoDe, type FichaEnCola } from './cola';

describe('tipoDe', () => {
	it('una ficha sin tipo es del censo', () => {
		// Las fichas que ya estaban en la cola de un teléfono antes de que
		// existiera la inspección no tienen el campo, y no hay forma de migrarlas:
		// viven en el IndexedDB de cada aparato, no en el servidor.
		expect(tipoDe({} as FichaEnCola)).toBe('RUFE');
		expect(tipoDe({ tipo: undefined } as FichaEnCola)).toBe('RUFE');
	});

	it('respeta el tipo cuando viene', () => {
		expect(tipoDe({ tipo: 'INSPECCION' } as FichaEnCola)).toBe('INSPECCION');
	});
});

describe('DESTINO', () => {
	it('cada formato va a su propia ruta', () => {
		expect(DESTINO.RUFE.ruta).toBe('/rufe/reportes');
		expect(DESTINO.INSPECCION.ruta).toBe('/inspeccion/fichas');
	});

	it('cada uno devuelve su identificador con su propio nombre', () => {
		// El censo lo llama «radicado» y la inspección «número». Leer la clave
		// equivocada dejaría la ficha enviada pero sin número que enseñar.
		expect(DESTINO.RUFE.clave).toBe('radicado');
		expect(DESTINO.INSPECCION.clave).toBe('numero');
	});

	it('todos tienen etiqueta para poder distinguirlos en Pendientes', () => {
		for (const destino of Object.values(DESTINO)) {
			expect(destino.etiqueta.length).toBeGreaterThan(3);
		}
	});

	it('ninguna ruta apunta al mismo sitio que otra', () => {
		const rutas = Object.values(DESTINO).map((d) => d.ruta);

		expect(new Set(rutas).size).toBe(rutas.length);
	});
});
