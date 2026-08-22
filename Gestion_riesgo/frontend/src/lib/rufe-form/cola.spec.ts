// La cola es la pieza más delicada del formulario: guarda datos de hogares
// damnificados que todavía no llegaron al servidor. Si se pierde, se pierde el
// trabajo de una jornada de campo y no hay forma de recuperarlo.
//
// Se prueba contra una IndexedDB real en memoria (fake-indexeddb), no con dobles
// de prueba: lo que interesa comprobar es el comportamiento del almacén —claves,
// índices, transacciones—, y un doble lo daría por bueno por construcción.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	borrarFicha,
	borrarFotosDe,
	espejarToken,
	fichasPendientes,
	fotosDe,
	guardarFicha,
	guardarFoto,
	leerFicha,
	todasLasFichas,
	tokenEspejado,
	type FichaEnCola
} from './cola';

function ficha(envioId: string, cambios: Partial<FichaEnCola> = {}): FichaEnCola {
	return {
		envioId,
		cuerpo: { evento: 'Terremoto', direccion: 'Calle 10 # 5-32' },
		estado: 'pendiente',
		intentos: 0,
		creadoEn: Date.now(),
		actualizadoEn: Date.now(),
		resumen: { evento: 'Terremoto', direccion: 'Calle 10 # 5-32', personas: 3 },
		...cambios
	};
}

async function vaciar() {
	for (const f of await todasLasFichas()) await borrarFicha(f.envioId);
	await espejarToken(null);
}

beforeEach(vaciar);

describe('fichas en cola', () => {
	it('guarda y recupera una ficha', async () => {
		await guardarFicha(ficha('a1'));

		const leida = await leerFicha('a1');
		expect(leida?.envioId).toBe('a1');
		expect(leida?.resumen.personas).toBe(3);
	});

	it('el envioId es la clave: guardar dos veces actualiza, no duplica', async () => {
		await guardarFicha(ficha('a1'));
		await guardarFicha(ficha('a1', { intentos: 5 }));

		expect(await todasLasFichas()).toHaveLength(1);
		expect((await leerFicha('a1'))?.intentos).toBe(5);
	});

	it('pendientes trae las que faltan por salir, y no las enviadas', async () => {
		await guardarFicha(ficha('a1', { estado: 'pendiente' }));
		await guardarFicha(ficha('a2', { estado: 'error' }));
		await guardarFicha(ficha('a3', { estado: 'enviada' }));
		await guardarFicha(ficha('a4', { estado: 'enviando' }));

		const ids = (await fichasPendientes()).map((f) => f.envioId);
		expect(ids).toEqual(expect.arrayContaining(['a1', 'a2']));
		expect(ids).not.toContain('a3');
	});

	it('salen en el orden en que se levantaron', async () => {
		await guardarFicha(ficha('nueva', { creadoEn: 3000 }));
		await guardarFicha(ficha('vieja', { creadoEn: 1000 }));
		await guardarFicha(ficha('media', { creadoEn: 2000 }));

		expect((await fichasPendientes()).map((f) => f.envioId)).toEqual(['vieja', 'media', 'nueva']);
	});

	it('borrar una ficha se lleva sus fotos', async () => {
		await guardarFicha(ficha('a1'));
		await guardarFoto({
			uid: 'f1',
			envioId: 'a1',
			tipo: 'DANO',
			nombre: 'x.webp',
			mime: 'image/webp',
			blob: new Blob(['x']),
			subida: false
		});

		expect(await fotosDe('a1')).toHaveLength(1);

		await borrarFicha('a1');

		expect(await leerFicha('a1')).toBeNull();
		expect(await fotosDe('a1')).toHaveLength(0);
	});
});

describe('fotos en cola', () => {
	it('cada foto queda atada a su ficha', async () => {
		for (const [uid, envio] of [
			['f1', 'a1'],
			['f2', 'a1'],
			['f3', 'a2']
		]) {
			await guardarFoto({
				uid,
				envioId: envio,
				tipo: 'DANO',
				nombre: `${uid}.webp`,
				mime: 'image/webp',
				blob: new Blob(['x']),
				subida: false
			});
		}

		expect(await fotosDe('a1')).toHaveLength(2);
		expect(await fotosDe('a2')).toHaveLength(1);

		await borrarFotosDe('a1');

		expect(await fotosDe('a1')).toHaveLength(0);
		// Borrar las de una ficha no debe tocar las de otra.
		expect(await fotosDe('a2')).toHaveLength(1);
	});

	it('conserva el binario, no solo los metadatos', async () => {
		await guardarFoto({
			uid: 'f1',
			envioId: 'a1',
			tipo: 'DOCUMENTO',
			nombre: 'cedula.webp',
			mime: 'image/webp',
			blob: new Blob(['contenido de prueba']),
			subida: false
		});

		const [foto] = await fotosDe('a1');
		expect(foto.tipo).toBe('DOCUMENTO');
		expect(await foto.blob.text()).toBe('contenido de prueba');
	});
});

describe('las fotos viajan con su ficha', () => {
	// El fallo que esto fija: mientras se llena el formulario las fotos viven en
	// otro almacén, atado al borrador. Si no se copian a la cola al encolar la
	// ficha, el Service Worker no las encuentra y la envía SIN evidencias, sin
	// que nadie se entere.
	it('el Service Worker encuentra por envioId lo que se guardó con la ficha', async () => {
		await guardarFicha(ficha('envio-1'));

		for (const uid of ['a', 'b']) {
			await guardarFoto({
				uid,
				envioId: 'envio-1',
				tipo: uid === 'a' ? 'DOCUMENTO' : 'DANO',
				nombre: `${uid}.webp`,
				mime: 'image/webp',
				blob: new Blob([uid]),
				subida: false
			});
		}

		const fotos = await fotosDe('envio-1');
		expect(fotos).toHaveLength(2);
		expect(fotos.map((f) => f.tipo).sort()).toEqual(['DANO', 'DOCUMENTO']);
	});

	it('una ficha sin fotos devuelve una lista vacía, no un error', async () => {
		await guardarFicha(ficha('envio-sin-fotos'));
		expect(await fotosDe('envio-sin-fotos')).toEqual([]);
	});

	it('las fotos de dos fichas encoladas no se mezclan', async () => {
		await guardarFicha(ficha('casa-1'));
		await guardarFicha(ficha('casa-2'));

		await guardarFoto({
			uid: 'f1', envioId: 'casa-1', tipo: 'DANO', nombre: 'f1.webp',
			mime: 'image/webp', blob: new Blob(['1']), subida: false
		});
		await guardarFoto({
			uid: 'f2', envioId: 'casa-2', tipo: 'DANO', nombre: 'f2.webp',
			mime: 'image/webp', blob: new Blob(['2']), subida: false
		});

		expect((await fotosDe('casa-1')).map((f) => f.uid)).toEqual(['f1']);
		expect((await fotosDe('casa-2')).map((f) => f.uid)).toEqual(['f2']);

		// Enviar una no puede llevarse las evidencias de la otra.
		await borrarFicha('casa-1');
		expect(await fotosDe('casa-1')).toEqual([]);
		expect(await fotosDe('casa-2')).toHaveLength(1);
	});
});

describe('varias fichas en cola a la vez', () => {
	// Es el caso que motivó todo: el censador levanta tres casas seguidas sin
	// señal y ninguna puede perderse ni estorbar a las otras.
	it('conviven y salen en el orden en que se levantaron', async () => {
		await guardarFicha(ficha('casa-a', { creadoEn: 1000 }));
		await guardarFicha(ficha('casa-b', { creadoEn: 2000 }));
		await guardarFicha(ficha('casa-c', { creadoEn: 3000 }));

		expect((await fichasPendientes()).map((f) => f.envioId)).toEqual([
			'casa-a',
			'casa-b',
			'casa-c'
		]);

		// La primera sale; las otras dos siguen esperando intactas.
		await borrarFicha('casa-a');
		expect((await fichasPendientes()).map((f) => f.envioId)).toEqual(['casa-b', 'casa-c']);
	});
});

describe('espejo del token', () => {
	// El Service Worker no puede leer localStorage. Sin este espejo no podría
	// enviar nada con la aplicación cerrada, que es el punto de todo esto.
	it('guarda y recupera el token', async () => {
		await espejarToken('abc123');
		expect(await tokenEspejado()).toBe('abc123');
	});

	it('cerrar sesión lo borra', async () => {
		await espejarToken('abc123');
		await espejarToken(null);
		expect(await tokenEspejado()).toBeNull();
	});

	it('sin token guardado devuelve null, no revienta', async () => {
		expect(await tokenEspejado()).toBeNull();
	});
});

describe('fichas levantadas con una versión anterior', () => {
	// Una ficha puede esperar días en el teléfono mientras el formulario cambia.
	// Cuando las cuatro casillas de consentimiento pasaron a ser una, las que ya
	// estaban en cola quedaron atascadas: el servidor las rechazaba por un campo
	// que no existía al levantarlas, y en la cola no hay formulario donde
	// marcarlo. La única salida habría sido descartar los datos del hogar.
	function vieja(extra: Record<string, unknown> = {}) {
		return ficha('antigua', {
			cuerpo: {
				evento: 'Terremoto',
				declara_veracidad: true,
				declara_representacion: true,
				autoriza_datos: true,
				autoriza_sensibles: true,
				...extra
			}
		});
	}

	it('las cuatro casillas viejas equivalen a la autorización única', async () => {
		await guardarFicha(vieja());

		expect((await leerFicha('antigua'))?.cuerpo.autoriza_tratamiento).toBe(true);
	});

	// Lo que prueba qué autorizó esa persona es la versión del aviso que leyó.
	// Estampar la vigente afirmaría que aceptó un texto que nunca vio.
	it('conserva el aviso que el ciudadano leyó de verdad', async () => {
		await guardarFicha(vieja());

		expect((await leerFicha('antigua'))?.cuerpo.aviso_version).toBe('habeas-data-v1');
	});

	it('también al listar las pendientes', async () => {
		await guardarFicha(vieja());

		const [f] = await fichasPendientes();
		expect(f.cuerpo.autoriza_tratamiento).toBe(true);
	});

	// El consentimiento no se inventa: si alguna casilla no se aceptó, la ficha
	// se queda como está y el servidor la seguirá rechazando, que es lo correcto.
	it('no da por otorgado lo que no se otorgó', async () => {
		await guardarFicha(vieja({ autoriza_sensibles: false }));

		expect((await leerFicha('antigua'))?.cuerpo.autoriza_tratamiento).toBeUndefined();
	});

	it('no toca una ficha que ya trae la autorización única', async () => {
		await guardarFicha(
			ficha('nueva', {
				cuerpo: { evento: 'Terremoto', autoriza_tratamiento: true, aviso_version: 'habeas-data-v2' }
			})
		);

		const f = await leerFicha('nueva');
		expect(f?.cuerpo.aviso_version).toBe('habeas-data-v2');
	});

	it('tampoco una que la trae explícitamente en falso', async () => {
		await guardarFicha(vieja({ autoriza_tratamiento: false }));

		expect((await leerFicha('antigua'))?.cuerpo.autoriza_tratamiento).toBe(false);
	});
});
