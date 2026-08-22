// Qué pasa con una ficha cuando el servidor la rechaza.
//
// Es el caso más delicado de todo el formulario: los datos de un hogar
// damnificado existen ÚNICAMENTE en ese teléfono hasta que el envío tiene
// éxito. Perderlos ahí es perder el trabajo de campo, y no hay copia en ningún
// otro sitio.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

vi.stubGlobal('window', {
	location: { hostname: 'grj.oticjamundi.com' },
	localStorage: { getItem: () => 'token-de-la-sesion', setItem() {}, removeItem() {} },
	addEventListener() {},
	removeEventListener() {}
});
vi.stubGlobal('navigator', { onLine: true });

// Se intercepta `api.post` y no `rufeApi.enviarReporte` porque el envío ya no
// conoce una sola ruta: la saca de DESTINO según el formato. La ruta recibida es
// justamente lo que hay que poder comprobar.
const enviarReporte = vi.fn();
const rutasUsadas: string[] = [];

vi.mock('$lib/api/client', async (original) => {
	const real = await original<typeof import('$lib/api/client')>();

	return {
		...real,
		api: {
			...real.api,
			post: (ruta: string, cuerpo: unknown) => {
				rutasUsadas.push(ruta);

				return enviarReporte(cuerpo);
			}
		}
	};
});

const { ApiError } = await import('$lib/api/client');
const { GestorEnvio } = await import('./envio.svelte');
const { borrarFicha, fichasPendientes, guardarFicha, leerFicha, todasLasFichas } =
	await import('./cola');

function ficha(envioId: string, cambios: Record<string, unknown> = {}) {
	return {
		envioId,
		cuerpo: { evento: 'Terremoto' },
		estado: 'pendiente' as const,
		intentos: 0,
		creadoEn: Date.now(),
		actualizadoEn: Date.now(),
		resumen: { evento: 'Terremoto', direccion: 'Carrera 11 # 8 26', personas: 1 },
		...cambios
	};
}

beforeEach(async () => {
	for (const f of await todasLasFichas()) await borrarFicha(f.envioId);
	enviarReporte.mockReset();
	rutasUsadas.length = 0;
});

describe('a qué ruta va cada formato', () => {
	// El fallo que esto fija: `#intentar` tenía escrita `/rufe/reportes` a mano,
	// así que una inspección enviada CON señal iba al endpoint del censo y el
	// servidor la rechazaba. Sin señal salía bien, porque el Service Worker sí
	// consultaba DESTINO — de ahí que costara verlo.
	it('una inspección va a /inspeccion/fichas, no a /rufe/reportes', async () => {
		await guardarFicha(ficha('i1', { tipo: 'INSPECCION' }));
		enviarReporte.mockResolvedValue({ numero: 'INSP-0001' });

		await new GestorEnvio().reintentarPendiente();

		expect(rutasUsadas).toEqual(['/inspeccion/fichas']);
	});

	it('una ficha del censo sigue yendo a /rufe/reportes', async () => {
		await guardarFicha(ficha('r1'));
		enviarReporte.mockResolvedValue({ radicado: 'RUFE-0001' });

		await new GestorEnvio().reintentarPendiente();

		expect(rutasUsadas).toEqual(['/rufe/reportes']);
	});

	it('una ficha vieja sin `tipo` se trata como censo', async () => {
		// Las que ya estaban en el IndexedDB de un teléfono antes de que existiera
		// la inspección no tienen el campo y no hay forma de migrarlas.
		await guardarFicha(ficha('v1', { tipo: undefined }));
		enviarReporte.mockResolvedValue({ radicado: 'RUFE-0002' });

		await new GestorEnvio().reintentarPendiente();

		expect(rutasUsadas).toEqual(['/rufe/reportes']);
	});
});

describe('una ficha rechazada por el servidor', () => {
	// El fallo que esto fija: un 4xx borraba la ficha. Bastaba un cambio de
	// esquema en el servidor para que las fichas guardadas sin señal se
	// destruyeran solas al reintentar, en silencio y sin recuperación posible.
	it('no se borra: sigue en el dispositivo con el motivo del rechazo', async () => {
		await guardarFicha(ficha('a1'));
		enviarReporte.mockRejectedValue(new ApiError('Falta la autorización del ciudadano.', 422));

		const gestor = new GestorEnvio();
		await expect(gestor.reintentarPendiente()).rejects.toThrow();

		const guardada = await leerFicha('a1');
		expect(guardada).not.toBeNull();
		expect(guardada?.estado).toBe('error');
		expect(guardada?.error).toBe('Falta la autorización del ciudadano.');
	});

	// Los 50 intentos sobre una sola ficha salieron de aquí: la rechazada era
	// siempre la primera de la cola, se reintentaba cada 30 segundos para
	// siempre, y las de atrás no llegaban a salir nunca.
	it('no bloquea a las que están detrás', async () => {
		await guardarFicha(ficha('rechazada', { estado: 'error', error: 'Datos inválidos', creadoEn: 1000 }));
		await guardarFicha(ficha('buena', { creadoEn: 2000 }));

		enviarReporte.mockResolvedValue({ radicado: 'RUFE-2026-ABCD1234' });

		await new GestorEnvio().reintentarPendiente();

		expect(enviarReporte).toHaveBeenCalledTimes(1);
		expect(enviarReporte.mock.calls[0][0].envio_id).toBe('buena');
		expect(await leerFicha('buena')).toBeNull();
		expect(await leerFicha('rechazada')).not.toBeNull();
	});

	it('el reintento a mano sí la vuelve a intentar', async () => {
		await guardarFicha(ficha('rechazada', { estado: 'error', error: 'Datos inválidos' }));
		enviarReporte.mockResolvedValue({ radicado: 'RUFE-2026-ABCD1234' });

		await new GestorEnvio().reintentarTodo();

		expect(enviarReporte).toHaveBeenCalledTimes(1);
		expect(await leerFicha('rechazada')).toBeNull();
	});

	it('el reintento a mano no propaga el error a la pantalla', async () => {
		await guardarFicha(ficha('a1'));
		enviarReporte.mockRejectedValue(new ApiError('Datos inválidos', 422));

		const gestor = new GestorEnvio();
		await expect(gestor.reintentarTodo()).resolves.toBeUndefined();
		expect(gestor.error).toBe('Datos inválidos');
		expect(await fichasPendientes()).toHaveLength(1);
	});
});

describe('sesión vencida', () => {
	it('un 401 conserva la ficha y pide iniciar sesión', async () => {
		await guardarFicha(ficha('a1'));
		enviarReporte.mockRejectedValue(new ApiError('No autorizado', 401));

		const gestor = new GestorEnvio();
		await gestor.reintentarPendiente();

		expect(gestor.sesionRequerida).toBe(true);
		expect(await leerFicha('a1')).not.toBeNull();
	});

	it('un envío exitoso posterior levanta el aviso de sesión', async () => {
		await guardarFicha(ficha('a1'));
		const gestor = new GestorEnvio();

		enviarReporte.mockRejectedValue(new ApiError('No autorizado', 401));
		await gestor.reintentarPendiente();
		expect(gestor.sesionRequerida).toBe(true);

		enviarReporte.mockResolvedValue({ radicado: 'RUFE-2026-ABCD1234' });
		await gestor.reintentarPendiente();

		expect(gestor.sesionRequerida).toBe(false);
		expect(await leerFicha('a1')).toBeNull();
	});
});
