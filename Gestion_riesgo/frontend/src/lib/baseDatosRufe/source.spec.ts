// La lista de barrios se lee en caliente, no viene compilada.
//
// Es lo que permite que agregar un barrio sea subir un JSON en vez de
// recompilar y volver a publicar el sitio entero — que es exactamente lo que
// venía pisando el resto del trabajo desplegado.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BARRIO_TABS, pestanasVigentes, RUTA_PESTANAS } from './source';

function responder(cuerpo: unknown, ok = true) {
	return Promise.resolve({
		ok,
		json: () => Promise.resolve(cuerpo)
	} as Response);
}

const VIVA = [
	...BARRIO_TABS.map((t) => ({ ...t })),
	{ nombre: 'BARRIO NUEVO', gid: '999999' }
];

beforeEach(() => vi.unstubAllGlobals());

describe('lista de barrios vigente', () => {
	it('se pide al servidor, no al paquete', async () => {
		const visto: string[] = [];
		vi.stubGlobal('fetch', (url: string) => {
			visto.push(url);

			return responder(VIVA);
		});

		const lista = await pestanasVigentes();

		expect(visto).toEqual([RUTA_PESTANAS]);
		expect(lista).toHaveLength(BARRIO_TABS.length + 1);
		expect(lista.at(-1)?.nombre).toBe('BARRIO NUEVO');
	});

	// Sin conexión o con el archivo ausente, el tablero debe seguir mostrando
	// cifras: quedarse sin datos es peor que quedarse con una lista vieja.
	it('si el archivo no está, usa la lista compilada', async () => {
		vi.stubGlobal('fetch', () => responder(null, false));
		expect(await pestanasVigentes()).toEqual(BARRIO_TABS);
	});

	it('si la red falla, usa la lista compilada', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new Error('sin red')));
		expect(await pestanasVigentes()).toEqual(BARRIO_TABS);
	});

	it('si el archivo no es una lista, usa la compilada', async () => {
		vi.stubGlobal('fetch', () => responder({ barrios: [] }));
		expect(await pestanasVigentes()).toEqual(BARRIO_TABS);
	});

	// Un archivo a medio subir tiene menos barrios que el compilado. Perder un
	// barrio del tablero es peor que tardar en ver uno nuevo.
	it('una lista más corta que la compilada se descarta', async () => {
		vi.stubGlobal('fetch', () => responder([{ nombre: 'SOLO UNO', gid: '1' }]));
		expect(await pestanasVigentes()).toEqual(BARRIO_TABS);
	});

	it('descarta entradas mal formadas antes de compararlas', async () => {
		vi.stubGlobal('fetch', () => responder([...VIVA, { nombre: 'sin gid' }, null, 'texto']));

		const lista = await pestanasVigentes();

		expect(lista).toHaveLength(VIVA.length);
		expect(lista.every((t) => typeof t.gid === 'string')).toBe(true);
	});
});
