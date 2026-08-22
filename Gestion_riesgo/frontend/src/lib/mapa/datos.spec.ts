// Qué se pinta en el mapa y qué no.
//
// Es la parte del mapa donde un error se paga caro: los puntos que se dibujan
// se usan para decidir a dónde va la ayuda, y un punto inventado desvía recursos
// de donde hacen falta.

import { describe, expect, it } from 'vitest';
import {
	calorDe,
	puntosDeFichas,
	sectorDe,
	ubicarEnCascada,
	colorDe,
	direccionesDe,
	puntosDe,
	ubicable,
	type FichaMapa,
	type Ubicacion
} from './datos';
import type { Hogar } from '$lib/rufe/types';

function hogar(cambios: Partial<Hogar> = {}): Hogar {
	return {
		hogar: '1',
		barrio: 'Terranova',
		zona: 'Urbana',
		direccion: 'Carrera 11 # 8-26',
		personas: 3,
		estadoBien: 'Averiado',
		tipoBien: 'Vivienda',
		tenencia: 'Propietario',
		visita: 'Sin dato',
		quienVisita: '',
		observacion: '',
		evacuada: 'Sin dato',
		...cambios
	};
}

function ubicacion(cambios: Partial<Ubicacion> = {}): Ubicacion {
	return { lat: 3.27, lon: -76.55, precision: 'EXACTA', fuente: 'NOMINATIM', ...cambios };
}

describe('qué se puede pintar', () => {
	it('acepta las tres precisiones útiles', () => {
		for (const p of ['EXACTA', 'CALLE', 'BARRIO'] as const) {
			expect(ubicable(ubicacion({ precision: p }))).toBe(true);
		}
	});

	// LA trampa de todo el mapa: una dirección que el geocodificador solo supo
	// resolver hasta «Jamundí» devuelve coordenadas perfectamente válidas y del
	// todo inútiles. Pintarlas amontonaría cientos de hogares sobre el parque
	// principal e inventaría una zona de calor donde no la hay.
	it('rechaza el punto que solo llegó al municipio', () => {
		expect(ubicable(ubicacion({ precision: 'MUNICIPIO' }))).toBe(false);
	});

	it('rechaza lo fallido y lo que no existe', () => {
		expect(ubicable(ubicacion({ precision: 'FALLIDA' }))).toBe(false);
		expect(ubicable(undefined)).toBe(false);
	});
});

describe('cruce de hogares con ubicaciones', () => {
	it('separa los ubicados de los que no', () => {
		const hogares = [
			hogar({ hogar: '1', direccion: 'Carrera 11 # 8-26' }),
			hogar({ hogar: '2', direccion: 'Sin dirección conocida' })
		];

		const { puntos, sinUbicar } = puntosDe(hogares, { 'Carrera 11 # 8-26': ubicacion() });

		expect(puntos.map((p) => p.hogar)).toEqual(['1']);
		expect(sinUbicar.map((h) => h.hogar)).toEqual(['2']);
	});

	// Un hogar con coordenadas del centroide debe contarse como NO ubicado, no
	// desaparecer en silencio: el contador de la pantalla depende de esto.
	it('un punto de precisión municipal cuenta como sin ubicar', () => {
		const { puntos, sinUbicar } = puntosDe(
			[hogar()],
			{ 'Carrera 11 # 8-26': ubicacion({ precision: 'MUNICIPIO' }) }
		);

		expect(puntos).toHaveLength(0);
		expect(sinUbicar).toHaveLength(1);
	});

	it('un hogar sin estado del bien no se queda sin color', () => {
		const { puntos } = puntosDe(
			[hogar({ estadoBien: '' })],
			{ 'Carrera 11 # 8-26': ubicacion() }
		);

		expect(puntos[0].estadoBien).toBe('No informa');
		expect(colorDe(puntos[0].estadoBien)).toBeTruthy();
	});

	it('los espacios sobrantes no impiden el cruce', () => {
		const { puntos } = puntosDe(
			[hogar({ direccion: '  Carrera 11 # 8-26  ' })],
			{ 'Carrera 11 # 8-26': ubicacion() }
		);

		expect(puntos).toHaveLength(1);
	});
});

describe('direcciones a consultar', () => {
	it('no repite la misma dirección', () => {
		const d = direccionesDe([hogar({ hogar: '1' }), hogar({ hogar: '2' })]);
		// La dirección una sola vez, y el barrio como respaldo por si no resuelve.
		expect(d.filter((x) => x === 'Carrera 11 # 8-26')).toHaveLength(1);
	});

	it('descarta las direcciones vacías', () => {
		const d = direccionesDe([hogar({ direccion: '' }), hogar({ direccion: '   ' })]);
		expect(d).not.toContain('');
		expect(d).not.toContain('   ');
	});

	// Sin dirección utilizable queda el barrio: es el tercer intento de la
	// cascada y evita perder el hogar del todo.
	it('el barrio se pide como respaldo', () => {
		expect(direccionesDe([hogar({ direccion: '', barrio: 'Terranova' })])).toEqual(['Terranova']);
	});
});

describe('intensidad de la mancha de calor', () => {
	// Un hogar de nueve personas debe pesar más que uno de una: la mancha sirve
	// para decidir a dónde mandar ayuda, y la ayuda va a personas, no a casas.
	it('pesa según cuánta gente vive en el hogar', () => {
		const { puntos } = puntosDe(
			[
				hogar({ hogar: '1', personas: 9, direccion: 'A 1' }),
				hogar({ hogar: '2', personas: 1, direccion: 'B 2' })
			],
			{ 'A 1': ubicacion(), 'B 2': ubicacion({ lat: 3.28 }) }
		);

		const [grande, chico] = calorDe(puntos);
		expect(grande[2]).toBeGreaterThan(chico[2]);
		expect(grande[2]).toBe(1);
	});

	it('ningún punto pesa cero: un hogar pequeño también se ve', () => {
		const { puntos } = puntosDe(
			[
				hogar({ hogar: '1', personas: 40, direccion: 'A 1' }),
				hogar({ hogar: '2', personas: 1, direccion: 'B 2' })
			],
			{ 'A 1': ubicacion(), 'B 2': ubicacion({ lat: 3.28 }) }
		);

		expect(calorDe(puntos)[1][2]).toBeGreaterThan(0);
	});

	it('sin puntos no revienta', () => {
		expect(calorDe([])).toEqual([]);
	});
});

describe('fichas del sistema en el mapa', () => {
	function ficha(cambios: Partial<FichaMapa> = {}): FichaMapa {
		return {
			radicado: 'RUFE-2026-ABCD1234',
			zona: 'Urbana',
			barrio: 'Terranova',
			direccion: 'Carrera 11 # 8-26',
			corregimiento: '',
			vereda: 'Terranova',
			personas: 4,
			estado: 'Recibido',
			estado_bien: 'Averiado',
			tipo_bien: 'Vivienda',
			latitud: null,
			longitud: null,
			precision_m: null,
			...cambios
		};
	}

	// El GPS del censador es el dato más preciso que puede haber: mejor que
	// cualquier dirección escrita, y además no gasta cupo del geocodificador.
	it('la ficha con GPS se dibuja sin geocodificar', () => {
		const { puntos, sinUbicar } = puntosDeFichas(
			[ficha({ latitud: 3.27, longitud: -76.55, precision_m: 8 })],
			{}
		);

		expect(sinUbicar).toHaveLength(0);
		expect(puntos[0]).toMatchObject({ lat: 3.27, lon: -76.55, precision: 'EXACTA', origen: 'sistema' });
	});

	it('sin GPS se ubica por su dirección', () => {
		const { puntos } = puntosDeFichas([ficha()], {
			'Carrera 11 # 8-26': { lat: 3.28, lon: -76.54, precision: 'CALLE', fuente: 'NOMINATIM' }
		});

		expect(puntos[0]).toMatchObject({ lat: 3.28, precision: 'CALLE', origen: 'sistema' });
	});

	it('sin GPS y sin dirección ubicable, cuenta como no ubicada', () => {
		const { puntos, sinUbicar } = puntosDeFichas([ficha()], {});

		expect(puntos).toHaveLength(0);
		expect(sinUbicar).toHaveLength(1);
	});

	it('el radicado identifica el punto, para poder volver a la ficha', () => {
		const { puntos } = puntosDeFichas([ficha({ latitud: 3.27, longitud: -76.55 })], {});
		expect(puntos[0].hogar).toBe('RUFE-2026-ABCD1234');
	});

	// Una misma casa puede estar en el censo en papel y en una ficha nueva.
	// Preguntar dos veces por ella gastaría el doble de cupo para nada.
	it('las direcciones de las dos fuentes se piden una sola vez', () => {
		const hogares = [hogar({ direccion: 'Carrera 11 # 8-26' })];
		const fichas = [ficha({ direccion: 'Carrera 11 # 8-26' }), ficha({ direccion: 'Calle 3 # 2-10' })];

		const d = direccionesDe(hogares, fichas);
		// Cada texto una sola vez, aunque la casa esté en las dos fuentes.
		expect(new Set(d).size).toBe(d.length);
		expect(d).toContain('Carrera 11 # 8-26');
		expect(d).toContain('Calle 3 # 2-10');
	});

	it('una ficha con GPS no añade su dirección a la cola de geocodificación', () => {
		const fichas = [ficha({ direccion: 'Ya ubicada', latitud: 3.27, longitud: -76.55 })];
		expect(direccionesDe([], fichas)).toEqual([]);
	});
});

describe('los tres intentos para ubicar una ficha', () => {
	const sinNada = {};

	// 1. Lo mejor que hay: el censador estaba delante de la casa.
	it('primero, las coordenadas tomadas en campo', () => {
		const u = ubicarEnCascada({ lat: 3.2608449, lon: -76.5424246 }, 'Carrera 11 # 8 26', 'Juan de ampudia', {
			'Carrera 11 # 8 26': { lat: 9, lon: 9, precision: 'EXACTA', fuente: 'GOOGLE' }
		});

		expect(u).toEqual({ lat: 3.2608449, lon: -76.5424246, precision: 'EXACTA', origen: 'gps' });
	});

	// 2. Sin GPS, la dirección escrita.
	it('después, la dirección', () => {
		const u = ubicarEnCascada({ lat: null, lon: null }, 'Carrera 11 # 8 26', 'Juan de ampudia', {
			'Carrera 11 # 8 26': { lat: 3.26, lon: -76.54, precision: 'CALLE', fuente: 'NOMINATIM' }
		});

		expect(u).toMatchObject({ lat: 3.26, origen: 'direccion', precision: 'CALLE' });
	});

	// 3. El caso de la ficha 9: «Caseta comunal 200 metros» no la ubica nadie,
	//    pero su corregimiento sí. Mejor un hogar en el sector correcto que un
	//    hogar invisible.
	it('por último, el sector', () => {
		const u = ubicarEnCascada({ lat: null, lon: null }, 'Caseta comunal 200 metros', 'La Liberia', {
			'La Liberia': { lat: 3.19, lon: -76.62, precision: 'CALLE', fuente: 'NOMINATIM' }
		});

		expect(u).toMatchObject({ lat: 3.19, origen: 'sector' });
	});

	// Se ubicó el sector, no el predio. Decir «CALLE» daría a entender que el
	// punto está sobre la casa, y no lo está.
	it('lo ubicado por sector se rebaja a aproximado aunque el servicio afine más', () => {
		const u = ubicarEnCascada({ lat: null, lon: null }, 'no ubicable', 'La Liberia', {
			'La Liberia': { lat: 3.19, lon: -76.62, precision: 'EXACTA', fuente: 'GOOGLE' }
		});

		expect(u?.precision).toBe('BARRIO');
	});

	it('sin nada que usar, devuelve null', () => {
		expect(ubicarEnCascada({ lat: null, lon: null }, 'x', 'y', sinNada)).toBeNull();
	});

	it('un sector que solo resolvió al municipio no se usa', () => {
		const u = ubicarEnCascada({ lat: null, lon: null }, 'no ubicable', 'La Liberia', {
			'La Liberia': { lat: 3.2611, lon: -76.5423, precision: 'MUNICIPIO', fuente: 'NOMINATIM' }
		});

		expect(u).toBeNull();
	});

	it('el sector sale del corregimiento, y si no, de la vereda', () => {
		expect(sectorDe({ corregimiento: 'La Liberia', vereda: 'El cabullo' })).toBe('La Liberia');
		expect(sectorDe({ corregimiento: '', vereda: 'El cabullo' })).toBe('El cabullo');
		expect(sectorDe({ barrio: 'Terranova' })).toBe('Terranova');
		expect(sectorDe({})).toBe('');
	});
});
