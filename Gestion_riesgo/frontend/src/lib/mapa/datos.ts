// Qué se pinta en el mapa y con qué color.
//
// Se separa de la página para poder comprobarlo sin navegador: lo delicado no es
// dibujar, es decidir qué punto merece dibujarse. Un mapa que pinta lo que no
// sabe engaña, y este en concreto se usa para decidir a dónde va la ayuda.

import type { Hogar } from '$lib/rufe/types';

/** Una ubicación tal como la devuelve la API. */
export type Ubicacion = {
	lat: number;
	lon: number;
	precision: 'EXACTA' | 'CALLE' | 'BARRIO' | 'MUNICIPIO' | 'FALLIDA';
	fuente: string | null;
};

/** Una ficha del sistema, tal como la devuelve la API. */
export type FichaMapa = {
	radicado: string;
	zona: string;
	barrio: string;
	direccion: string;
	corregimiento: string;
	vereda: string;
	personas: number;
	estado: string;
	estado_bien: string;
	tipo_bien: string;
	latitud: number | null;
	longitud: number | null;
	precision_m: number | null;
};

/** Un hogar ya ubicado, listo para dibujar. */
export type PuntoHogar = {
	hogar: string;
	/** De dónde salió: del censo en papel digitalizado o del formulario. */
	origen: 'censo' | 'sistema';
	/** Con qué se pudo ubicar: GPS, dirección o sector. */
	ubicadoPor: Origen;
	barrio: string;
	zona: string;
	direccion: string;
	personas: number;
	estadoBien: string;
	lat: number;
	lon: number;
	precision: Ubicacion['precision'];
};

/**
 * Colores del estado del bien, los mismos de los planos que ya imprimió la
 * Alcaldía, para que quien tenga los dos delante lea lo mismo.
 */
export const COLOR_ESTADO: Record<string, string> = {
	Destruido: '#b5322a',
	'No habitable': '#c2258f',
	Averiado: '#e08a1e',
	Habitable: '#2f9e44',
	'No informa': '#5c6b7a'
};

export const COLOR_SIN_DATO = '#5c6b7a';

export function colorDe(estadoBien: string): string {
	return COLOR_ESTADO[estadoBien] ?? COLOR_SIN_DATO;
}

/**
 * Solo estas precisiones se dibujan.
 *
 * `MUNICIPIO` significa que el geocodificador contestó «Jamundí» y no la
 * dirección pedida. Son coordenadas válidas y del todo inútiles: pintarlas
 * amontonaría cientos de hogares sobre el parque principal e inventaría una
 * zona de calor donde no la hay.
 */
export function ubicable(u: Ubicacion | undefined): u is Ubicacion {
	return u !== undefined && (u.precision === 'EXACTA' || u.precision === 'CALLE' || u.precision === 'BARRIO');
}

/**
 * Cómo se ubicó un punto, para poder decirlo en pantalla.
 *
 * No es lo mismo el GPS que tomó el censador delante de la casa que el centro de
 * una vereda. Ambos sirven para ver dónde se concentra la afectación, pero solo
 * el primero sirve para ir a buscar el predio.
 */
export type Origen = 'gps' | 'direccion' | 'sector';

/**
 * El sitio con el que intentar ubicar algo cuando su dirección no basta.
 *
 * Es el tercer intento de la cascada: una dirección como «Caseta comunal 200
 * metros» no la encuentra ningún geocodificador, pero la vereda o el
 * corregimiento sí se sitúan. El punto queda aproximado —y así se dice—, pero un
 * hogar en el sector correcto informa mucho más que un hogar invisible.
 */
export function sectorDe(f: { corregimiento?: string; vereda?: string; barrio?: string }): string {
	return (f.corregimiento || f.vereda || f.barrio || '').trim();
}

/**
 * Las direcciones distintas que hay que preguntarle a la API.
 *
 * Se juntan las de las dos fuentes en una sola consulta: una misma casa puede
 * estar en el censo en papel y en una ficha del formulario, y preguntar dos
 * veces por ella gastaría el doble de cupo del geocodificador para nada.
 *
 * Las fichas que ya traen coordenadas del censador no aportan dirección: no hay
 * nada que resolver.
 */
export function direccionesDe(hogares: Hogar[], fichas: FichaMapa[] = []): string[] {
	const vistas = new Set<string>();

	for (const h of hogares) {
		const d = h.direccion.trim();
		if (d !== '') vistas.add(d);
	}

	for (const f of fichas) {
		if (f.latitud !== null && f.longitud !== null) continue;

		const d = f.direccion.trim();
		if (d !== '') vistas.add(d);

		// El sector también se pide: es el tercer intento cuando la dirección no
		// se puede resolver, y pedirlo ahora evita otra vuelta al servidor.
		const sector = sectorDe(f);
		if (sector !== '') vistas.add(sector);
	}

	// Los sectores del censo en papel, por lo mismo.
	for (const h of hogares) {
		const sector = sectorDe({ barrio: h.barrio });
		if (sector !== '') vistas.add(sector);
	}

	return [...vistas];
}

/**
 * Los tres intentos para ubicar algo, en orden de calidad.
 *
 *   1. Las coordenadas que tomó el censador con el botón de ubicación. Es el
 *      dato bueno: está delante de la casa y trae su margen de error.
 *   2. La dirección escrita, geocodificada contra el municipio.
 *   3. El sector —vereda o corregimiento—, cuando la dirección no se puede
 *      resolver. El punto queda aproximado, y la pantalla lo dice.
 *
 * El orden importa: nunca se degrada un punto bueno por uno peor, y nunca se
 * descarta un hogar por no tener la dirección bien escrita.
 */
export function ubicarEnCascada(
	gps: { lat: number | null; lon: number | null },
	direccion: string,
	sector: string,
	ubicaciones: Record<string, Ubicacion>
): { lat: number; lon: number; precision: Ubicacion['precision']; origen: Origen } | null {
	if (gps.lat !== null && gps.lon !== null) {
		return { lat: gps.lat, lon: gps.lon, precision: 'EXACTA', origen: 'gps' };
	}

	const porDireccion = ubicaciones[direccion.trim()];
	if (ubicable(porDireccion)) {
		return { ...porDireccion, origen: 'direccion' };
	}

	const porSector = ubicaciones[sector.trim()];
	if (ubicable(porSector)) {
		// Se rebaja a BARRIO aunque el servicio dijera algo más fino: lo que se
		// ubicó fue el sector, no este predio, y decir otra cosa sería mentir.
		return { lat: porSector.lat, lon: porSector.lon, precision: 'BARRIO', origen: 'sector' };
	}

	return null;
}

/** Cruza los hogares con las ubicaciones conocidas. */
export function puntosDe(
	hogares: Hogar[],
	ubicaciones: Record<string, Ubicacion>
): { puntos: PuntoHogar[]; sinUbicar: Hogar[] } {
	const puntos: PuntoHogar[] = [];
	const sinUbicar: Hogar[] = [];

	for (const h of hogares) {
		const u = ubicarEnCascada(
			{ lat: null, lon: null },
			h.direccion,
			sectorDe({ barrio: h.barrio }),
			ubicaciones
		);

		if (u === null) {
			sinUbicar.push(h);
			continue;
		}

		puntos.push({
			hogar: h.hogar,
			origen: 'censo',
			ubicadoPor: u.origen,
			barrio: h.barrio,
			zona: h.zona,
			direccion: h.direccion,
			personas: h.personas,
			estadoBien: h.estadoBien || 'No informa',
			lat: u.lat,
			lon: u.lon,
			precision: u.precision
		});
	}

	return { puntos, sinUbicar };
}

/**
 * Las fichas del sistema convertidas en puntos.
 *
 * Las que traen coordenadas del censador se usan tal cual: son el dato más
 * preciso que existe, mejor que cualquier dirección escrita, y no gastan una
 * consulta al geocodificador. Las demás se ubican por su dirección, igual que
 * las del censo en papel.
 */
export function puntosDeFichas(
	fichas: FichaMapa[],
	ubicaciones: Record<string, Ubicacion>
): { puntos: PuntoHogar[]; sinUbicar: FichaMapa[] } {
	const puntos: PuntoHogar[] = [];
	const sinUbicar: FichaMapa[] = [];

	for (const f of fichas) {
		const base = {
			hogar: f.radicado,
			origen: 'sistema' as const,
			barrio: f.barrio,
			zona: f.zona,
			direccion: f.direccion,
			personas: f.personas,
			estadoBien: f.estado_bien || 'No informa'
		};

		const u = ubicarEnCascada(
			{ lat: f.latitud, lon: f.longitud },
			f.direccion,
			sectorDe(f),
			ubicaciones
		);

		if (u === null) {
			sinUbicar.push(f);
			continue;
		}

		puntos.push({
			...base,
			ubicadoPor: u.origen,
			lat: u.lat,
			lon: u.lon,
			precision: u.precision
		});
	}

	return { puntos, sinUbicar };
}

/**
 * Los puntos que alimentan la capa de calor, con su intensidad.
 *
 * La intensidad es cuánta gente vive en el hogar, no «uno por marcador»: un
 * hogar de nueve personas pesa más que uno de una para decidir a dónde mandar
 * la ayuda. Se normaliza contra el hogar más numeroso para que la escala no
 * dependa del tamaño absoluto del censo.
 */
export function calorDe(puntos: PuntoHogar[]): [number, number, number][] {
	if (puntos.length === 0) return [];

	const mayor = Math.max(...puntos.map((p) => p.personas), 1);

	return puntos.map((p) => [p.lat, p.lon, Math.max(p.personas / mayor, 0.15)]);
}

/** Centro del casco urbano de Jamundí, para abrir el mapa antes de tener datos. */
export const CENTRO_JAMUNDI: [number, number] = [3.2611, -76.5423];
