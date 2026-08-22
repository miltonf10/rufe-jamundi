// Que cada llamada del RUFE lleve la cabecera Authorization.
//
// Esto fija una regresión real y cara: cuando el formulario era público, las
// rutas de captura se llamaban a propósito sin token. Al volverse internas se
// cambió la autorización en el router de PHP, pero no estas llamadas. El
// resultado fue un 401 en cada envío — el censador volvía a iniciar sesión, veía
// otra vez «Su sesión venció», y una ficha llegó a acumular 50 intentos sin
// salir jamás. Nada en las pruebas lo detectaba porque las de backend mandaban
// la cabecera a mano.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const almacen = new Map<string, string>();

vi.stubGlobal('window', {
	location: { hostname: 'grj.oticjamundi.com' },
	localStorage: {
		getItem: (k: string) => almacen.get(k) ?? null,
		setItem: (k: string, v: string) => void almacen.set(k, v),
		removeItem: (k: string) => void almacen.delete(k)
	}
});

const { rufeApi } = await import('./servicios');

let peticiones: { url: string; init: RequestInit }[] = [];

function cabecera(i: number, nombre: string): string | undefined {
	return (peticiones[i].init.headers as Record<string, string>)[nombre];
}

beforeEach(() => {
	peticiones = [];
	almacen.set('sgr_token', 'token-de-la-sesion');

	vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
		peticiones.push({ url, init });

		return Promise.resolve(
			new Response(JSON.stringify({ ok: true, data: {} }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
	});
});

describe('las rutas de captura van autenticadas', () => {
	it('enviar una ficha lleva el token de la sesión', async () => {
		await rufeApi.enviarReporte({ evento: 'Terremoto' });

		expect(cabecera(0, 'Authorization')).toBe('Bearer token-de-la-sesion');
	});

	it('abrir una carga de evidencias lleva el token', async () => {
		await rufeApi.abrirCarga();

		expect(cabecera(0, 'Authorization')).toBe('Bearer token-de-la-sesion');
	});

	it('pedir los catálogos lleva el token', async () => {
		await rufeApi.catalogos();

		expect(cabecera(0, 'Authorization')).toBe('Bearer token-de-la-sesion');
	});

	it('ninguna ruta del RUFE sale sin cabecera de autorización', async () => {
		await rufeApi.catalogos();
		await rufeApi.abrirCarga();
		await rufeApi.enviarReporte({ evento: 'Terremoto' });

		expect(peticiones).toHaveLength(3);
		for (let i = 0; i < peticiones.length; i++) {
			expect(cabecera(i, 'Authorization')).toBe('Bearer token-de-la-sesion');
		}
	});
});
