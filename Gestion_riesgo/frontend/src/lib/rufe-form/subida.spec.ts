// Que las fotos de una ficha diferida lleguen al servidor.
//
// El fallo que esto fija: esta lógica vivía solo dentro del Service Worker. En
// los navegadores sin Background Sync —Firefox, Safari y Brave— envía la propia
// pestaña, y esa ruta mandaba el cuerpo tal cual: con el token de carga que el
// formulario había abierto al tomar las fotos, caducado a las dos horas, y sin
// subir ninguna evidencia. La ficha se rechazaba o entraba sin fotos.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.stubGlobal('location', { hostname: 'grj.oticjamundi.com' });

const { ErrorDeRed, subirFotosDe } = await import('./subida');
const { borrarFicha, guardarFoto, todasLasFichas } = await import('./cola');

const UNA_HORA = 3600 * 1000;

function ficha(cambios: Record<string, unknown> = {}) {
	return {
		envioId: 'e1',
		cuerpo: { evento: 'Terremoto' } as Record<string, unknown>,
		estado: 'pendiente' as const,
		intentos: 0,
		creadoEn: Date.now(),
		actualizadoEn: Date.now(),
		resumen: { evento: 'Terremoto', direccion: 'Carrera 11 # 8 26', personas: 1 },
		...cambios
	};
}

async function ponerFoto(uid: string, subida = false) {
	await guardarFoto({
		uid,
		envioId: 'e1',
		tipo: 'DANO',
		nombre: `${uid}.webp`,
		mime: 'image/webp',
		blob: new Blob(['x']),
		subida
	});
}

let peticiones: string[] = [];

function responder(cuerpo: unknown, status = 200) {
	return Promise.resolve(
		new Response(JSON.stringify(cuerpo), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})
	);
}

beforeEach(async () => {
	for (const f of await todasLasFichas()) await borrarFicha(f.envioId);
	await borrarFicha('e1');
	peticiones = [];

	vi.stubGlobal('fetch', (url: string) => {
		peticiones.push(url);

		return url.endsWith('/rufe/cargas')
			? responder({ ok: true, data: { carga: 'carga-nueva' } })
			: responder({ ok: true, data: {} });
	});
});

describe('una ficha que esperó más que la carga', () => {
	it('abre una carga nueva y sube todas sus fotos', async () => {
		await ponerFoto('a');
		await ponerFoto('b');

		const carga = await subirFotosDe(
			ficha({ cuerpo: { carga: 'carga-caducada' }, creadoEn: Date.now() - 3 * UNA_HORA }),
			'tok'
		);

		expect(carga).toBe('carga-nueva');
		expect(peticiones.filter((u) => u.endsWith('/rufe/cargas'))).toHaveLength(1);
		expect(peticiones.filter((u) => u.includes('/carga-nueva/archivos'))).toHaveLength(2);
	});

	// Aunque estén marcadas como subidas: ese `subida` se refería a una carga
	// que a estas alturas el servidor ya borró.
	it('resube incluso las que se habían subido a la carga vieja', async () => {
		await ponerFoto('a', true);

		await subirFotosDe(
			ficha({ cuerpo: { carga: 'carga-caducada' }, creadoEn: Date.now() - 3 * UNA_HORA }),
			'tok'
		);

		expect(peticiones.filter((u) => u.includes('/carga-nueva/archivos'))).toHaveLength(1);
	});
});

describe('una ficha que sale enseguida', () => {
	// Las fotos ya están arriba: volver a subirlas gastaría dos veces los datos
	// móviles del censador, que es justo lo que la compresión intenta ahorrar.
	it('reutiliza la carga del formulario y no sube nada', async () => {
		await ponerFoto('a', true);

		const carga = await subirFotosDe(ficha({ cuerpo: { carga: 'carga-viva' } }), 'tok');

		expect(carga).toBeNull();
		expect(peticiones).toHaveLength(0);
	});

	it('sube solo las que falten', async () => {
		await ponerFoto('a', true);
		await ponerFoto('b');

		const carga = await subirFotosDe(ficha({ cuerpo: { carga: 'carga-viva' } }), 'tok');

		expect(carga).toBeNull();
		expect(peticiones).toEqual([expect.stringContaining('/carga-viva/archivos')]);
	});
});

describe('casos límite', () => {
	it('una ficha sin fotos no abre ninguna carga', async () => {
		expect(await subirFotosDe(ficha(), 'tok')).toBeNull();
		expect(peticiones).toHaveLength(0);
	});

	it('sin carga previa abre una, aunque la ficha sea recién hecha', async () => {
		await ponerFoto('a');

		expect(await subirFotosDe(ficha(), 'tok')).toBe('carga-nueva');
	});

	it('si la red falla avisa como error de red, no como rechazo', async () => {
		await ponerFoto('a');
		vi.stubGlobal('fetch', () => Promise.reject(new Error('sin red')));

		await expect(subirFotosDe(ficha(), 'tok')).rejects.toBeInstanceOf(ErrorDeRed);
	});

	// La ficha vale más que la evidencia: se pierde la foto, no el hogar.
	it('una foto rechazada por formato no impide que la ficha salga', async () => {
		await ponerFoto('a');
		vi.stubGlobal('fetch', (url: string) => {
			peticiones.push(url);

			return url.endsWith('/rufe/cargas')
				? responder({ ok: true, data: { carga: 'carga-nueva' } })
				: responder({ ok: false, message: 'Formato no admitido' }, 422);
		});

		await expect(subirFotosDe(ficha(), 'tok')).resolves.toBe('carga-nueva');
	});
});

describe('una foto ya subida no se sube dos veces', () => {
	// El fallo que esto fija: al encolar, TODA foto se marcaba como pendiente,
	// incluidas las que el formulario ya había subido a la carga. Al enviar, se
	// volvían a subir a esa misma carga y la ficha quedaba con la misma evidencia
	// repetida. Se vio en la ficha 9: el mismo archivo, dos veces, mismo peso.
	it('las marcadas como subidas se saltan si la carga sigue viva', async () => {
		await ponerFoto('ya-estaba', true);
		await ponerFoto('nueva', false);

		const carga = await subirFotosDe(ficha({ cuerpo: { carga: 'carga-viva' } }), 'tok');

		expect(carga).toBeNull();
		// Solo sube la que faltaba.
		expect(peticiones).toEqual([expect.stringContaining('/carga-viva/archivos')]);
	});

	it('si todas están subidas no se hace ninguna petición', async () => {
		await ponerFoto('a', true);
		await ponerFoto('b', true);

		expect(await subirFotosDe(ficha({ cuerpo: { carga: 'carga-viva' } }), 'tok')).toBeNull();
		expect(peticiones).toEqual([]);
	});
});
