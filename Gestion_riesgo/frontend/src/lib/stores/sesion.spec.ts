// Qué hace la sesión cuando el servidor no contesta.
//
// Esto fija el fallo de la captura del 19 de agosto de 2026: en modo avión, la
// aplicación instalada arrancaba, se pintaba entera y se quedaba en el login
// diciendo «No se pudo conectar con el servidor». El armazón estaba guardado; lo
// que faltaba era distinguir «el servidor dijo que no» de «no se pudo preguntar».
//
// La distinción es de seguridad, no de comodidad: un 401 SÍ tiene que expulsar.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsuarioSesion } from '$lib/api/tipos';

const almacen = new Map<string, string>();

vi.stubGlobal('window', {
	// `client.ts` mira el hostname al cargarse para decidir la URL de la API.
	location: { hostname: 'grj.oticjamundi.com' },
	localStorage: {
		getItem: (k: string) => almacen.get(k) ?? null,
		setItem: (k: string, v: string) => void almacen.set(k, v),
		removeItem: (k: string) => void almacen.delete(k)
	}
});

vi.mock('$app/environment', () => ({ browser: true }));

// El espejo del token para el Service Worker vive en IndexedDB y aquí no aporta.
vi.mock('$lib/rufe-form/cola', () => ({ espejarToken: vi.fn() }));

const get = vi.fn();
const post = vi.fn();

vi.mock('$lib/api/client', async (original) => {
	const real = await original<typeof import('$lib/api/client')>();

	return {
		...real,
		api: { get: (r: string) => get(r), post: (r: string, b?: unknown) => post(r, b) },
		leerToken: () => almacen.get('sgr_token') ?? null,
		guardarToken: (t: string) => void almacen.set('sgr_token', t),
		borrarToken: () => {
			almacen.delete('sgr_token');
			almacen.delete('sgr_sesion');
		}
	};
});

const { ApiError } = await import('$lib/api/client');
const { sesion } = await import('./sesion.svelte');
const { guardarSesion, leerSesion } = await import('./sesionCache');

const USUARIO: UsuarioSesion = {
	id: 3,
	nombre: 'Censador de prueba',
	email: 'censo@jamundi.gov.co',
	rol: 'GESTOR',
	capacidades: ['rufe.crear']
};

beforeEach(() => {
	almacen.clear();
	get.mockReset();
	post.mockReset();
	sesion.usuario = null;
	sesion.verificada = false;
	sesion.sinConexion = false;
});

describe('restaurar', () => {
	it('con señal, manda el servidor y la sesión queda verificada', async () => {
		almacen.set('sgr_token', 'un-token');
		get.mockResolvedValue({ usuario: USUARIO });

		await sesion.restaurar();

		expect(sesion.usuario?.email).toBe(USUARIO.email);
		expect(sesion.verificada).toBe(true);
		expect(sesion.sinConexion).toBe(false);
	});

	it('sin señal, entra con el usuario guardado y se marca como no verificada', async () => {
		// Este es el caso de la vereda. Antes acababa en el login.
		almacen.set('sgr_token', 'un-token');
		guardarSesion(USUARIO, null);
		get.mockRejectedValue(new ApiError('No se pudo conectar con el servidor.', 0));

		await sesion.restaurar();

		expect(sesion.autenticado).toBe(true);
		expect(sesion.usuario?.rol).toBe('GESTOR');
		expect(sesion.verificada).toBe(false);
		expect(sesion.sinConexion).toBe(true);
	});

	it('un 401 sí expulsa, aunque haya usuario guardado', async () => {
		// La credencial murió de verdad: dejar entrar aquí sería abrir el sistema
		// con una sesión que el servidor ya rechaza.
		almacen.set('sgr_token', 'un-token-muerto');
		guardarSesion(USUARIO, null);
		get.mockRejectedValue(new ApiError('No autorizado.', 401));

		await sesion.restaurar();

		expect(sesion.usuario).toBeNull();
		expect(sesion.sinConexion).toBe(false);
		expect(leerSesion()).toBeNull();
	});

	it('un servidor caído no expulsa a nadie', async () => {
		// Un 500 no dice nada sobre la credencial. Cerrarle la sesión a todo el
		// mundo por una avería del servidor sería añadir un problema al problema.
		almacen.set('sgr_token', 'un-token');
		guardarSesion(USUARIO, null);
		get.mockRejectedValue(new ApiError('Error del servidor.', 500));

		await sesion.restaurar();

		expect(sesion.autenticado).toBe(true);
		expect(sesion.verificada).toBe(false);
	});

	it('sin token no se usa el espejo', async () => {
		// Sin token no hay con qué enviar nada: entrar solo llevaría a un callejón.
		guardarSesion(USUARIO, null);

		await sesion.restaurar();

		expect(sesion.usuario).toBeNull();
		expect(leerSesion()).toBeNull();
	});

	it('con el espejo vencido no se entra, aunque quede token', async () => {
		almacen.set('sgr_token', 'un-token');
		guardarSesion(USUARIO, null, Date.now() - 24 * 3600_000);
		get.mockRejectedValue(new ApiError('No se pudo conectar con el servidor.', 0));

		await sesion.restaurar();

		expect(sesion.usuario).toBeNull();
	});
});

describe('iniciar', () => {
	it('guarda el espejo con el vencimiento que dio el servidor', async () => {
		const dentroDeSeisHoras = new Date(Date.now() + 6 * 3600_000);
		const p = (n: number) => String(n).padStart(2, '0');
		const expira =
			`${dentroDeSeisHoras.getFullYear()}-${p(dentroDeSeisHoras.getMonth() + 1)}-${p(dentroDeSeisHoras.getDate())} ` +
			`${p(dentroDeSeisHoras.getHours())}:${p(dentroDeSeisHoras.getMinutes())}:00`;

		post.mockResolvedValue({ token: 'nuevo', usuario: USUARIO, expira_en: expira });

		await sesion.iniciar('censo@jamundi.gov.co', 'clave');

		expect(sesion.verificada).toBe(true);
		expect(leerSesion()?.email).toBe(USUARIO.email);
		// Vencido ya, no debe seguir valiendo.
		expect(leerSesion(Date.now() + 7 * 3600_000)).toBeNull();
	});
});

describe('cerrar', () => {
	it('se lleva el espejo consigo', async () => {
		almacen.set('sgr_token', 'un-token');
		guardarSesion(USUARIO, null);
		post.mockResolvedValue({});

		await sesion.cerrar();

		expect(sesion.usuario).toBeNull();
		expect(leerSesion()).toBeNull();
	});
});
