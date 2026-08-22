// El espejo de la sesión es lo que permite abrir el sistema en una vereda sin
// señal. Se prueba aquí porque el fallo que corrige NO se ve leyendo el código:
// se ve en un teléfono, en modo avión, cuando ya es tarde.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsuarioSesion } from '$lib/api/tipos';

// Las pruebas corren en Node, sin navegador. Se suplanta el almacenamiento con
// un mapa, igual que en `servicios.spec.ts`.
const almacen = new Map<string, string>();

vi.stubGlobal('window', {
	localStorage: {
		getItem: (k: string) => almacen.get(k) ?? null,
		setItem: (k: string, v: string) => void almacen.set(k, v),
		removeItem: (k: string) => void almacen.delete(k),
		clear: () => almacen.clear()
	}
});

const { borrarSesionGuardada, guardarSesion, leerSesion, momentoDeVencimiento, venceEn } =
	await import('./sesionCache');

const USUARIO: UsuarioSesion = {
	id: 7,
	nombre: 'Censadora de prueba',
	email: 'censo@jamundi.gov.co',
	rol: 'GESTOR',
	capacidades: ['rufe.crear']
};

beforeEach(() => {
	almacen.clear();
});

describe('momentoDeVencimiento', () => {
	it('entiende el formato que devuelve el servidor', () => {
		// `AAAA-MM-DD HH:MM:SS`, sin zona: se lee en la hora local del teléfono,
		// que es la misma del servidor.
		const ms = momentoDeVencimiento('2026-08-20 18:30:00');

		expect(ms).not.toBeNull();
		expect(new Date(ms as number).getHours()).toBe(18);
	});

	it('devuelve null ante una fecha que no entiende, en vez de inventarse una', () => {
		expect(momentoDeVencimiento('mañana')).toBeNull();
		expect(momentoDeVencimiento(null)).toBeNull();
		expect(momentoDeVencimiento('')).toBeNull();
	});
});

describe('guardarSesion / leerSesion', () => {
	it('devuelve el usuario mientras la sesión siga vigente', () => {
		const ahora = Date.now();
		guardarSesion(USUARIO, isoLocal(ahora + 6 * 3600_000), ahora);

		expect(leerSesion(ahora + 3600_000)?.email).toBe(USUARIO.email);
	});

	it('deja de devolverlo en cuanto pasa el vencimiento', () => {
		// Lo importante del caso: entrar con una credencial que el servidor ya no
		// acepta no ahorra nada, solo aplaza el rechazo hasta el envío de fichas,
		// que es el peor momento posible.
		const ahora = Date.now();
		guardarSesion(USUARIO, isoLocal(ahora + 3600_000), ahora);

		expect(leerSesion(ahora + 2 * 3600_000)).toBeNull();
	});

	it('sin fecha del servidor aplica el tope de doce horas', () => {
		const ahora = Date.now();
		guardarSesion(USUARIO, null, ahora);

		expect(leerSesion(ahora + 11 * 3600_000)).not.toBeNull();
		expect(leerSesion(ahora + 13 * 3600_000)).toBeNull();
	});

	it('no se cree una fecha absurda del servidor', () => {
		// Con el reloj del teléfono atrasado, un `expira_en` lejanísimo dejaría la
		// sesión offline viva para siempre.
		const ahora = Date.now();
		guardarSesion(USUARIO, isoLocal(ahora + 365 * 24 * 3600_000), ahora);

		const limite = venceEn() as number;
		expect(limite - ahora).toBeLessThanOrEqual(12 * 3600_000 * 30);
	});

	it('descarta lo guardado si está corrupto y no revienta', () => {
		almacen.set('sgr_sesion', '{no es json');

		expect(leerSesion()).toBeNull();
		expect(almacen.get('sgr_sesion')).toBeUndefined();
	});

	it('descarta lo guardado si no tiene la forma esperada', () => {
		almacen.set('sgr_sesion', JSON.stringify({ usuario: { nombre: 'x' } }));

		expect(leerSesion()).toBeNull();
	});

	it('borrar deja el teléfono sin identidad guardada', () => {
		guardarSesion(USUARIO);
		borrarSesionGuardada();

		expect(leerSesion()).toBeNull();
		expect(venceEn()).toBeNull();
	});
});

/** Una fecha local con el formato del servidor, para no depender de la zona. */
function isoLocal(ms: number): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');

	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
