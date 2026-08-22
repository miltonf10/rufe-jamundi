import Papa from 'papaparse';
import type { Barrio, Dataset, Hogar, Zona } from './types';

/**
 * Parser único del CSV del RUFE — corre igual en el navegador (fetch en
 * vivo, ver `live.ts`) y en Node (script de refresco del snapshot de
 * respaldo, ver `scripts/refresh-snapshot.ts`). Que sea la MISMA función en
 * los dos casos es intencional: dos implementaciones (una en Python, otra
 * en TS) ya causaron una vez un desacuerdo silencioso entre el snapshot y
 * los datos reales (ver el bug de los hogares 91/117 corregido antes de
 * publicar la primera versión).
 *
 * Mapeo de columnas (0-index) del CSV exportado por Google Sheets — export
 * directo, sin el relleno de celdas combinadas que sí trae un copiar/pegar
 * manual desde Excel/Sheets. Verificado contra la hoja en vivo el
 * 2026-08-14:
 *
 *   0 ITEMS · 1 HOGAR No. · 2 CORREGIMIENTO · 3 SECTOR/BARRIO · 4 DIRECCION
 *   5 NOMBRE(S) · 6 APELLIDO(S) · 7 TIPO DOC · 8 NUMERO DOC · 9 PARENTESCO
 *   10 GENERO (M/F/T directo) · 11 DIA · 12 MES · 13 AÑO · 14 EDAD
 *   15 ETNIA · 16 TELEFONO · 17 TENENCIA · 18 ESTADO BIEN · 19 TIPO BIEN
 *   20 EVACUADA · 21 VISITA · 22 QUIEN VISITA · 23 OBSERVACIONES
 */
const HEADER_ROWS = 8;
const COL = {
	hogar: 1,
	corregimiento: 2,
	barrio: 3,
	// La dirección la ignoraba el tablero, que agrega por barrio. La sección
	// Mapas sí la necesita: es lo único con lo que se puede ubicar un predio.
	direccion: 4,
	nombre: 5,
	apellido: 6,
	documento: 8,
	genero: 10,
	edad: 14,
	tenencia: 17,
	estadoBien: 18,
	tipoBien: 19,
	evacuada: 20,
	visita: 21,
	quienVisita: 22,
	observacion: 23
} as const;
const MIN_COLS = 25;

/** Estado/tipo de bien son de la vivienda, no de la persona: solo el primer
 * integrante del hogar suele traerlos diligenciados (a veces un par más, a
 * veces ninguno), así que se toma el primer valor no vacío visto para ese
 * hogar — igual que corregimiento/barrio. */
const CANON_ESTADO_BIEN: Record<string, string> = {
	AVERIADA: 'Averiado',
	AVERIDO: 'Averiado',
	AVERIADO: 'Averiado',
	HABITABLE: 'Habitable',
	'NO HABITABLE': 'No habitable',
	'NO HABITABE': 'No habitable',
	DESTRUIDO: 'Destruido',
	'NO INFORMA': 'No informa',
	'SIN DATOS': 'No informa'
};

const CANON_TIPO_BIEN: Record<string, string> = {
	VIVIENDA: 'Vivienda',
	VIVENDA: 'Vivienda',
	'LOCAL COMERCIAL': 'Local comercial',
	FINCA: 'Finca',
	'CENTRO DE BIENESTAR': 'Centro de bienestar',
	'CENTRO EDUCATIVO / ESCUELA': 'Centro educativo'
};

const CANON_TENENCIA: Record<string, string> = {
	PROPIETARIO: 'Propietario',
	ARRENDATARIO: 'Arrendatario',
	POSEEDOR: 'Poseedor',
	OCUPANTE: 'Ocupante',
	'NO INFORMA': 'No informa',
	'SIN DATOS': 'No informa'
};

/** Corregimientos rurales conocidos de Jamundí (Valle del Cauca). Cualquier
 * corregimiento fuera de esta lista (incluido vacío, o "JAMUNDI"/"TERRANOVA",
 * que en este formulario a veces aparecen por error en esa columna) se
 * clasifica como Urbana.
 *
 * Sin acentos a propósito: la comparación contra esta lista siempre pasa
 * primero por `stripAccents()`, así que un valor de origen como "Jordán" o
 * "Puente Vélez" (frecuentes en BASE-DATOS RUFE, ver `baseDatosRufe/`)
 * calzan igual que su versión sin tilde. Ampliada el 2026-08-15 con LA
 * LIBERIA, JORDAN, LA VENTURA y LA MESETA al incorporar esa hoja. */
const RURAL = new Set([
	'QUINAMAYO',
	'ROBLES',
	'CHAGRES',
	'POTRERITO',
	'SAN ANTONIO',
	'TIMBA',
	'AMPUDIA',
	'PUENTE VELEZ',
	'VILLA PAZ',
	'VILLA COLOMBIA',
	'SAN ISIDRO',
	'SAN VICENTE',
	'LA FERRERIRA',
	'CHONTADURO',
	'PEON',
	'CLAVELLINAS',
	'GUACHINTE',
	'LA LIBERIA',
	'JORDAN',
	'EL JORDAN',
	'LA VENTURA',
	'LA MESETA'
]);

const CANON_CORE: Record<string, string> = {
	VILLACOLOMBIA: 'VILLA COLOMBIA',
	CLAVELLINA: 'CLAVELLINAS',
	'EL JORDAN': 'JORDAN'
};

const CANON_BARRIO: Record<string, string> = {
	'OASIS - TERRANOVA': 'OASIS DE TERRANOVA',
	'PAISAJE LAS FLORES': 'PAISAJE DE LAS FLORES',
	'PARQUES DE CASTILLO': 'PARQUES DE CASTILLA',
	'TERRANOVA-SECTOR J': 'TERRANOVA SECTOR J',
	'SECTOR LA J': 'TERRANOVA SECTOR J',
	'PANGOLA-': 'PANGOLA',
	'PANGOLA TORRE 1 APTO 1008': 'PANGOLA',
	'PANGOLA MIRADOR DEL RIO': 'PANGOLA',
	'CIUDADELA DE TERRANOVA': 'TERRANOVA',
	'ALAMEDA DE RIO CLARO': 'ALAMEDA RIO CLARO',
	'VILLA LAS PALMAS': 'LAS PALMAS',
	'BONANZA - TULIPANES': 'BONANZA TULIPANES'
};

const ACCENT_WORDS: Record<string, string> = {
	JORDAN: 'JORDÁN',
	ESTACION: 'ESTACIÓN',
	RIO: 'RÍO',
	BOLIVAR: 'BOLÍVAR',
	MARIA: 'MARÍA'
};

const SMALL_WORDS = new Set(['de', 'la', 'las', 'los', 'del', 'el', 'y']);

function clean(s: string | undefined | null): string {
	return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Para comparar contra RURAL/CANON_CORE/CANON_BARRIO sin que un acento
 * (frecuente en BASE-DATOS RUFE: "Vélez", "Jordán") haga fallar una
 * coincidencia que en el fondo es la misma palabra. Nunca se usa para lo que
 * se muestra en pantalla — eso sigue pasando por `titleCase`/`fixAccents`. */
// Unicode "Combining Diacritical Marks" block is U+0300–U+036F. Filtrado por
// código de carácter (no por rango literal en una clase de regex) para que
// el archivo fuente no dependa de tener esos caracteres combinantes escritos
// tal cual — son casi invisibles y frágiles de editar a mano.
function stripAccents(s: string): string {
	return Array.from(s.normalize('NFD'))
		.filter((ch) => {
			const code = ch.codePointAt(0) ?? 0;
			return code < 0x0300 || code > 0x036f;
		})
		.join('');
}

function fixAccents(s: string): string {
	return s
		.split(' ')
		.map((w) => ACCENT_WORDS[w] ?? w)
		.join(' ');
}

function titleCase(s: string): string {
	return fixAccents(s)
		.split(' ')
		.map((w, i) => {
			const lw = w.toLowerCase();
			return i > 0 && SMALL_WORDS.has(lw) ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
		})
		.join(' ');
}

function zonaDe(corregimientoUpper: string): Zona {
	return RURAL.has(corregimientoUpper) ? 'Rural' : 'Urbana';
}

function ageBucket(
	edad: number | null
): 'Ninos' | 'Jovenes' | 'Adultos' | 'AdultosMayores' | 'SinDato' {
	if (edad === null) return 'SinDato';
	if (edad <= 11) return 'Ninos';
	if (edad <= 28) return 'Jovenes';
	if (edad <= 59) return 'Adultos';
	return 'AdultosMayores';
}

/**
 * `documento` viaja en este tipo interno para que `baseDatosRufe/merge.ts`
 * pueda cruzar personas entre las dos hojas del RUFE — pero `buildDataset()`
 * nunca lo lee, así que ningún identificador de persona sale jamás de este
 * módulo hacia el `Dataset` público (ver "Privacidad" en el README).
 */
export interface PersonRecord {
	hogar: string;
	corregimiento: string;
	barrio: string;
	/** Dirección del predio, para poder ubicarlo en el mapa. */
	direccion: string;
	documento: string;
	/** Cuando la fuente trae la zona directa por predio (BASE-DATOS RUFE:
	 * "Ubicación del Bien") en vez de haber que inferirla del corregimiento.
	 * Un mismo corregimiento puede tener su cabecera urbana y veredas
	 * rurales alrededor, así que un predio puntual puede no coincidir con la
	 * clasificación general de su corregimiento — cuando se conoce el dato
	 * exacto del predio, gana sobre la inferencia. La hoja original nunca la
	 * trae (queda `undefined`), así que su comportamiento no cambia. */
	zonaDirecta?: Zona;
	genero: 'M' | 'F' | null;
	edad: number | null;
	tenencia: string;
	estadoBien: string;
	tipoBien: string;
	visita: 'SI' | 'NO' | '';
	quienVisita: string;
	observacion: string;
	evacuada: 'SI' | 'NO' | '';
}

function parseRows(rows: string[][]): PersonRecord[] {
	const dataRows = rows.slice(HEADER_ROWS);
	const coreByHogar = new Map<string, string>();
	const barrioByHogar = new Map<string, string>();
	const direccionByHogar = new Map<string, string>();
	const records: PersonRecord[] = [];

	for (const raw of dataRows) {
		const r = raw.length < MIN_COLS ? [...raw, ...Array(MIN_COLS - raw.length).fill('')] : raw;

		const hogar = clean(r[COL.hogar]);
		let corregimiento = clean(r[COL.corregimiento]);
		let barrio = clean(r[COL.barrio]);
		let direccion = clean(r[COL.direccion]);
		const nombre = clean(r[COL.nombre]);
		const apellido = clean(r[COL.apellido]);
		const documento = clean(r[COL.documento]);
		const generoRaw = clean(r[COL.genero]).toUpperCase();
		const edadRaw = clean(r[COL.edad]);
		const tenencia = clean(r[COL.tenencia]);
		const estadoBien = clean(r[COL.estadoBien]);
		const tipoBien = clean(r[COL.tipoBien]);
		const visitaRaw = clean(r[COL.visita]).toUpperCase();
		const quienVisita = clean(r[COL.quienVisita]);
		const observacion = clean(r[COL.observacion]);
		const evacuadaRaw = clean(r[COL.evacuada]).toUpperCase();

		if (hogar) {
			if (corregimiento) coreByHogar.set(hogar, corregimiento);
			else if (coreByHogar.has(hogar)) corregimiento = coreByHogar.get(hogar)!;
			if (barrio) barrioByHogar.set(hogar, barrio);
			else if (barrioByHogar.has(hogar)) barrio = barrioByHogar.get(hogar)!;
			// La dirección es del predio, no de la persona: suele venir solo en el
			// primer integrante, igual que corregimiento y barrio.
			if (direccion) direccionByHogar.set(hogar, direccion);
			else if (direccionByHogar.has(hogar)) direccion = direccionByHogar.get(hogar)!;
		}

		// Filas de relleno del formulario (sin nombre/apellido/documento).
		if (!nombre && !apellido && !documento) continue;

		const genero: 'M' | 'F' | null = generoRaw === 'M' ? 'M' : generoRaw === 'F' ? 'F' : null;

		let edad: number | null = null;
		const parsed = Number.parseInt(edadRaw, 10);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 115) edad = parsed;

		const visita: 'SI' | 'NO' | '' = visitaRaw === 'SI' ? 'SI' : visitaRaw === 'NO' ? 'NO' : '';
		const evacuada: 'SI' | 'NO' | '' =
			evacuadaRaw === 'SI' ? 'SI' : evacuadaRaw === 'NO' ? 'NO' : '';

		records.push({
			hogar,
			corregimiento,
			barrio,
			direccion,
			documento,
			genero,
			edad,
			tenencia,
			estadoBien,
			tipoBien,
			visita,
			quienVisita,
			observacion,
			evacuada
		});
	}

	return records;
}

/** A qué grupo de barrio pertenece un registro, y con qué zona — separado de
 * `buildDataset` porque hace falta calcularlo dos veces: una vez para saber
 * de antemano qué nombres de barrio tienen algún dato de zona directa por
 * predio (ver `labelsConZonaDirecta` más abajo), y otra vez para agregar de
 * verdad. Calcularlo una sola vez y cachearlo no alcanza, porque la
 * clasificación de UN registro no depende solo de sí mismo. */
function clasificar(rec: PersonRecord): { label: string; zona: Zona } {
	const coreClean = clean(rec.corregimiento).toUpperCase();
	const barrioClean = clean(rec.barrio).toUpperCase();
	let coreU = CANON_CORE[stripAccents(coreClean)] ?? coreClean;
	const barrioU = CANON_BARRIO[stripAccents(barrioClean)] ?? barrioClean;

	// Corregimiento vacío pero el nombre de un corregimiento rural quedó
	// escrito en el campo de barrio (ver hogares 91/117 del sismo de agosto
	// 2026: "SAN ISIDRO"/"CHAGRES" en barrio, corregimiento vacío). Sin
	// esto, esas personas quedan mal clasificadas como Urbana y corrompen
	// la zona de todo el grupo de barrio al que se terminan uniendo.
	if (!coreU && RURAL.has(stripAccents(barrioU))) coreU = barrioU;

	const zona = rec.zonaDirecta ?? zonaDe(stripAccents(coreU));
	const labelRaw =
		zona === 'Rural'
			? coreU || barrioU || 'SIN ESPECIFICAR'
			: barrioU || coreU || 'SIN ESPECIFICAR';
	const label = labelRaw === 'SIN ESPECIFICAR' ? 'Sin especificar' : titleCase(labelRaw);
	return { label, zona };
}

function buildDataset(records: PersonRecord[], asOf: string): Dataset {
	const barrioAgg = new Map<
		string,
		{
			name: string;
			total: number;
			M: number;
			F: number;
			Ninos: number;
			Jovenes: number;
			Adultos: number;
			AdultosMayores: number;
			zona: Zona | null;
		}
	>();
	const warnings: string[] = [];
	const hogaresMap = new Map<string, Hogar>();

	// Nombres de barrio que en ALGÚN registro (de cualquier hogar, en
	// cualquier posición del arreglo) tienen zona directa por predio — no
	// solo "el registro que se está procesando ahora mismo la tiene". Sin
	// este pre-cálculo, el resultado dependería del orden de `records`: un
	// registro de zona inferida procesado ANTES que el primer registro de
	// zona directa de su mismo barrio terminaría en un grupo sin partir por
	// zona, y uno procesado DESPUÉS en uno partido — dos grupos que se ven
	// idénticos en pantalla para lo que en el fondo es un solo barrio+zona.
	const labelsConZonaDirecta = new Set<string>();
	for (const rec of records) {
		if (rec.zonaDirecta) labelsConZonaDirecta.add(clasificar(rec).label);
	}

	for (const rec of records) {
		const { label, zona } = clasificar(rec);

		// Cuando la zona viene directa por predio en ALGÚN registro de este
		// barrio (BASE-DATOS RUFE), un mismo nombre de barrio puede tener
		// personas en las dos zonas de verdad (un corregimiento suele tener
		// cabecera urbana y veredas rurales alrededor) — no es un error de
		// digitación que haya que aplanar a una sola, así que esas dos
		// mitades se agrupan aparte, y CUALQUIER registro de ese barrio
		// (tenga o no su propia zona directa) usa la llave partida por zona
		// para que los dos orígenes de dato se junten en el mismo grupo.
		// Cuando ningún registro del barrio trae zona directa (hoja
		// original sola), se mantiene el criterio de siempre: un solo grupo
		// por nombre, con advertencia si la zona inferida no calza entre
		// integrantes de un mismo hogar.
		const groupKey = labelsConZonaDirecta.has(label) ? `${zona}::${label}` : label;

		let b = barrioAgg.get(groupKey);
		if (!b) {
			b = {
				name: label,
				total: 0,
				M: 0,
				F: 0,
				Ninos: 0,
				Jovenes: 0,
				Adultos: 0,
				AdultosMayores: 0,
				zona: null
			};
			barrioAgg.set(groupKey, b);
		}
		b.total += 1;
		if (b.zona !== null && b.zona !== zona) {
			// No detenemos el parseo por esto: la hoja está en edición activa y
			// una fila con un corregimiento/barrio inconsistente no debe tumbar
			// el tablero para todo el mundo. Se mantiene la zona ya asignada al
			// grupo y se registra la advertencia para revisar el dato fuente.
			warnings.push(
				`Zona inconsistente para "${label}" (hogar ${rec.hogar}): se mantuvo ${b.zona}, se ignoró ${zona}.`
			);
		} else {
			b.zona = zona;
		}

		if (rec.genero === 'M') b.M += 1;
		else if (rec.genero === 'F') b.F += 1;

		const bucket = ageBucket(rec.edad);
		if (bucket === 'Ninos') b.Ninos += 1;
		else if (bucket === 'Jovenes') b.Jovenes += 1;
		else if (bucket === 'Adultos') b.Adultos += 1;
		else if (bucket === 'AdultosMayores') b.AdultosMayores += 1;

		if (rec.hogar) {
			let h = hogaresMap.get(rec.hogar);
			if (!h) {
				h = {
					hogar: rec.hogar,
					barrio: label,
					zona,
					direccion: '',
					personas: 0,
					estadoBien: '',
					tipoBien: '',
					tenencia: '',
					visita: 'Sin dato',
					quienVisita: '',
					observacion: '',
					evacuada: 'Sin dato'
				};
				hogaresMap.set(rec.hogar, h);
			}
			h.personas += 1;
			// Estado/tipo de bien, tenencia, visita, evacuación y observación
			// quedan diligenciados de forma pareja entre los integrantes de un
			// mismo hogar en la práctica (a veces solo el primero, a veces
			// varios, a veces ninguno) — se toma el primer valor no vacío visto.
			if (!h.estadoBien && rec.estadoBien) {
				h.estadoBien = CANON_ESTADO_BIEN[rec.estadoBien.toUpperCase()] ?? titleCase(rec.estadoBien);
			}
			if (!h.tipoBien && rec.tipoBien) {
				h.tipoBien = CANON_TIPO_BIEN[rec.tipoBien.toUpperCase()] ?? titleCase(rec.tipoBien);
			}
			if (!h.tenencia && rec.tenencia) {
				h.tenencia = CANON_TENENCIA[rec.tenencia.toUpperCase()] ?? titleCase(rec.tenencia);
			}
			if (!h.direccion && rec.direccion) h.direccion = rec.direccion;
			if (h.visita === 'Sin dato' && rec.visita) h.visita = rec.visita;
			if (h.evacuada === 'Sin dato' && rec.evacuada) h.evacuada = rec.evacuada;
			if (!h.quienVisita && rec.quienVisita) h.quienVisita = rec.quienVisita;
			if (!h.observacion && rec.observacion) h.observacion = rec.observacion;
		}
	}

	const barrios: Barrio[] = [...barrioAgg.values()]
		.map((b) => ({ ...b, zona: b.zona as Zona }))
		.sort((a, b) => b.total - a.total);

	const hogares = [...hogaresMap.values()];

	return {
		total: records.length,
		asOf,
		barrios,
		hogares,
		...(warnings.length ? { warnings } : {})
	};
}

/**
 * Parsea el texto crudo del CSV exportado del RUFE y devuelve el mismo
 * `Dataset` que consume la UI (agregado por barrio/vereda, sin datos
 * personales — ningún nombre, cédula ni teléfono sale de esta función).
 */
export function parseRufeCsv(csvText: string, asOf: string): Dataset {
	const records = parseRufeRecords(csvText);
	return buildDataset(records, asOf);
}

/**
 * Igual que `parseRufeCsv`, pero devuelve los registros por persona antes de
 * agregarlos — incluido `documento`. Uso exclusivo de
 * `baseDatosRufe/merge.ts` para cruzar personas entre las dos hojas del
 * RUFE; el resto de la aplicación sigue usando `parseRufeCsv`.
 */
export function parseRufeRecords(csvText: string): PersonRecord[] {
	const { data, errors } = Papa.parse<string[]>(csvText, { skipEmptyLines: false });
	const blockingErrors = errors.filter((e) => e.type !== 'FieldMismatch');
	if (blockingErrors.length > 0) {
		throw new Error(`Error al leer el CSV del RUFE: ${blockingErrors[0].message}`);
	}
	return parseRows(data);
}

export { buildDataset, CANON_ESTADO_BIEN, CANON_TENENCIA, CANON_TIPO_BIEN, titleCase, ageBucket };
