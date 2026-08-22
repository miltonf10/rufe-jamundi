// Cola de fichas pendientes de enviar, compartida entre la página y el Service
// Worker.
//
// Es el único punto donde los dos se hablan, y por eso no importa nada de
// SvelteKit: el Service Worker corre fuera de la aplicación, sin DOM, sin
// `$app/environment` y sin acceso a localStorage. IndexedDB es lo único que
// ambos ven.
//
// Qué guarda cada ficha: el CUERPO del reporte, no una petición ya firmada. La
// diferencia importa. Si guardáramos la petición con su cabecera Authorization,
// una ficha que pasa la noche sin señal se reintentaría con un token vencido y
// fallaría con un 401 silencioso dentro del Service Worker. Guardando el cuerpo,
// el token se toma en el momento de enviar; si no hay sesión válida, la ficha
// espera y la aplicación avisa.

const BASE = 'sgr_rufe_cola';
const VERSION = 1;

/** Fichas pendientes de enviar. */
const FICHAS = 'fichas';

/** Fotos pendientes, atadas a la ficha que las lleva. */
const FOTOS = 'fotos';

/** Espejo del token de sesión, para que el Service Worker pueda leerlo. */
const SESION = 'sesion';

/** Etiqueta del evento de Background Sync. Debe coincidir en el Service Worker. */
export const ETIQUETA_SYNC = 'sgr-enviar-fichas';

import type { TipoEvidencia } from './tipos';

export type EstadoFicha = 'pendiente' | 'enviando' | 'enviada' | 'error';

/**
 * Qué formato se está enviando.
 *
 * Ausente significa RUFE: las fichas que ya estaban en la cola de un teléfono
 * antes de que existiera la inspección no tienen este campo, y no hay forma de
 * migrarlas —viven en el IndexedDB de cada aparato, no en el servidor—. Se lee
 * siempre con `tipoDe()`, nunca directamente.
 */
export type TipoFicha = 'RUFE' | 'INSPECCION';

export type FichaEnCola = {
	/** Identificador de envío. Es lo que hace seguro reintentar. */
	envioId: string;
	tipo?: TipoFicha;
	cuerpo: Record<string, unknown>;
	estado: EstadoFicha;
	intentos: number;
	creadoEn: number;
	actualizadoEn: number;
	/** Radicado devuelto por el servidor, cuando ya se envió. */
	radicado?: string;
	/** Último error, para poder explicarlo sin adivinar. */
	error?: string;
	/**
	 * Detalle por campo cuando el servidor rechaza la ficha.
	 *
	 * Sin esto, «Revise los datos marcados» es un callejón sin salida: en la cola
	 * no hay formulario donde estén marcados, así que el censador no tiene forma
	 * de saber qué corregir ni de decidir si vale la pena descartarla.
	 */
	errores?: Record<string, string>;
	/** Número o radicado devuelto por el servidor, según el formato. */
	numero?: string;
	/** Resumen mínimo para poder listarla sin abrir el cuerpo entero. */
	resumen: { evento: string; direccion: string; personas: number };
};

/** El tipo de una ficha, tratando la ausencia como RUFE. */
export function tipoDe(f: Pick<FichaEnCola, 'tipo'>): TipoFicha {
	return f.tipo ?? 'RUFE';
}

/**
 * A dónde va cada formato y con qué nombre vuelve su identificador.
 *
 * En un solo sitio para que añadir un tercer formato sea una línea y no una
 * cacería por el Service Worker.
 */
export const DESTINO: Record<TipoFicha, { ruta: string; clave: string; etiqueta: string }> = {
	RUFE: { ruta: '/rufe/reportes', clave: 'radicado', etiqueta: 'Ficha del censo' },
	INSPECCION: { ruta: '/inspeccion/fichas', clave: 'numero', etiqueta: 'Inspección de vivienda' }
};

export type FotoEnCola = {
	uid: string;
	envioId: string;
	// El mismo tipo que maneja el gestor de evidencias. En la práctica la cola
	// solo lleva los internos —el formulario ciudadano envía en el momento, no
	// difiere—, pero mantener dos listas paralelas ya se separó una vez.
	tipo: TipoEvidencia;
	nombre: string;
	mime: string;
	blob: Blob;
	subida: boolean;
	/** El «FOTOGRAFIA DE:» del numeral 11. Solo lo llevan las de inspección. */
	descripcion?: string;
};

// ── Apertura ─────────────────────────────────────────────────────────────────

function abrir(): Promise<IDBDatabase | null> {
	return new Promise((resolver) => {
		if (typeof indexedDB === 'undefined') {
			resolver(null);

			return;
		}

		let solicitud: IDBOpenDBRequest;
		try {
			solicitud = indexedDB.open(BASE, VERSION);
		} catch {
			resolver(null);

			return;
		}

		solicitud.onupgradeneeded = () => {
			const db = solicitud.result;

			if (!db.objectStoreNames.contains(FICHAS)) {
				const almacen = db.createObjectStore(FICHAS, { keyPath: 'envioId' });
				almacen.createIndex('estado', 'estado', { unique: false });
			}

			if (!db.objectStoreNames.contains(FOTOS)) {
				const almacen = db.createObjectStore(FOTOS, { keyPath: 'uid' });
				almacen.createIndex('envioId', 'envioId', { unique: false });
			}

			if (!db.objectStoreNames.contains(SESION)) {
				db.createObjectStore(SESION);
			}
		};

		solicitud.onsuccess = () => resolver(solicitud.result);
		solicitud.onerror = () => resolver(null);
		solicitud.onblocked = () => resolver(null);
	});
}

/**
 * Envuelve una operación sobre un almacén. Todo falla en silencio devolviendo
 * el valor por omisión: si el navegador tiene el almacenamiento bloqueado, el
 * formulario debe seguir usable aunque no pueda encolar.
 */
async function conAlmacen<T>(
	nombre: string,
	modo: IDBTransactionMode,
	fn: (almacen: IDBObjectStore) => IDBRequest,
	porDefecto: T
): Promise<T> {
	const db = await abrir();
	if (!db) return porDefecto;

	return new Promise<T>((resolver) => {
		try {
			const tx = db.transaction(nombre, modo);
			const solicitud = fn(tx.objectStore(nombre));
			solicitud.onsuccess = () => resolver((solicitud.result as T) ?? porDefecto);
			solicitud.onerror = () => resolver(porDefecto);
			tx.oncomplete = () => db.close();
		} catch {
			resolver(porDefecto);
		}
	});
}

// ── Fichas ───────────────────────────────────────────────────────────────────

export async function guardarFicha(ficha: FichaEnCola): Promise<void> {
	await conAlmacen(FICHAS, 'readwrite', (a) => a.put(ficha), undefined);
}

/**
 * Pone al día una ficha levantada con una versión anterior de la aplicación.
 *
 * Una ficha puede quedarse días en el teléfono mientras el formulario cambia
 * bajo sus pies. Cuando eso pasa, el servidor la rechaza por un campo que no
 * existía al levantarla, y el censador no tiene forma de arreglarlo: en la cola
 * no hay formulario donde marcar nada. La única alternativa sería descartarla,
 * es decir, perder los datos de un hogar damnificado.
 *
 * Hoy hay una sola migración: las cuatro casillas de consentimiento pasaron a
 * ser una. Solo se da por otorgada la nueva si las cuatro viejas estaban
 * aceptadas — que es lo que el formulario de entonces exigía para dejar enviar,
 * y cubre lo mismo que la actual. Se conserva además el aviso que esa persona
 * leyó de verdad, `habeas-data-v1`: la prueba de qué autorizó es esa versión, no
 * la que rija el día en que la ficha por fin sale.
 */
export function alDia(ficha: FichaEnCola): FichaEnCola {
	const c = ficha.cuerpo;
	if (c.autoriza_tratamiento !== undefined) return ficha;

	const cuatroViejas =
		c.declara_veracidad === true &&
		c.declara_representacion === true &&
		c.autoriza_datos === true &&
		c.autoriza_sensibles === true;

	if (!cuatroViejas) return ficha;

	return {
		...ficha,
		cuerpo: { ...c, autoriza_tratamiento: true, aviso_version: 'habeas-data-v1' }
	};
}

export async function leerFicha(envioId: string): Promise<FichaEnCola | null> {
	const ficha = await conAlmacen<FichaEnCola | null>(
		FICHAS,
		'readonly',
		(a) => a.get(envioId),
		null
	);

	return ficha ? alDia(ficha) : null;
}

export async function borrarFicha(envioId: string): Promise<void> {
	await conAlmacen(FICHAS, 'readwrite', (a) => a.delete(envioId), undefined);
	await borrarFotosDe(envioId);
}

export async function todasLasFichas(): Promise<FichaEnCola[]> {
	const fichas = await conAlmacen<FichaEnCola[]>(FICHAS, 'readonly', (a) => a.getAll(), []);

	return fichas.map(alDia);
}

/** Las que todavía deben salir. Es lo que recorre el Service Worker. */
export async function fichasPendientes(): Promise<FichaEnCola[]> {
	const todas = await todasLasFichas();

	return todas
		.filter((f) => f.estado === 'pendiente' || f.estado === 'error')
		.sort((a, b) => a.creadoEn - b.creadoEn);
}

// ── Fotos ────────────────────────────────────────────────────────────────────

export async function guardarFoto(foto: FotoEnCola): Promise<void> {
	await conAlmacen(FOTOS, 'readwrite', (a) => a.put(foto), undefined);
}

export async function fotosDe(envioId: string): Promise<FotoEnCola[]> {
	const db = await abrir();
	if (!db) return [];

	return new Promise((resolver) => {
		try {
			const tx = db.transaction(FOTOS, 'readonly');
			const solicitud = tx.objectStore(FOTOS).index('envioId').getAll(envioId);
			solicitud.onsuccess = () => resolver((solicitud.result as FotoEnCola[]) ?? []);
			solicitud.onerror = () => resolver([]);
			tx.oncomplete = () => db.close();
		} catch {
			resolver([]);
		}
	});
}

export async function borrarFoto(uid: string): Promise<void> {
	await conAlmacen(FOTOS, 'readwrite', (a) => a.delete(uid), undefined);
}

export async function borrarFotosDe(envioId: string): Promise<void> {
	const fotos = await fotosDe(envioId);
	await Promise.all(fotos.map((f) => borrarFoto(f.uid)));
}

// ── Sesión ───────────────────────────────────────────────────────────────────

/**
 * El token vive en localStorage, que el Service Worker no puede leer. Se espeja
 * aquí en cada arranque de la aplicación y al iniciar o cerrar sesión.
 *
 * No es una copia con menos protección: localStorage e IndexedDB tienen el mismo
 * alcance de origen y la misma exposición ante un XSS. Lo que cambia es quién
 * puede leerlo dentro del propio navegador.
 */
export async function espejarToken(token: string | null): Promise<void> {
	await conAlmacen(
		SESION,
		'readwrite',
		(a) => (token === null ? a.delete('token') : a.put(token, 'token')),
		undefined
	);
}

export async function tokenEspejado(): Promise<string | null> {
	return conAlmacen<string | null>(SESION, 'readonly', (a) => a.get('token'), null);
}

// ── Almacenamiento persistente ───────────────────────────────────────────────

/**
 * Pide que el navegador no borre esta cola cuando el teléfono se quede sin
 * espacio.
 *
 * Sin esto, IndexedDB se desaloja por «usado menos recientemente» y se borra el
 * origen ENTERO de golpe: se perderían todas las fichas levantadas y sin enviar.
 * Chrome concede o niega solo, según el historial de uso del sitio, sin
 * preguntar; instalar la aplicación mejora mucho las probabilidades.
 */
export async function pedirAlmacenamientoPersistente(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;

	try {
		if (await navigator.storage.persisted()) return true;

		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

/** Cuánto espacio hay, para avisar antes de que se acabe. */
export async function espacioDisponible(): Promise<{ usado: number; total: number } | null> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;

	try {
		const { usage, quota } = await navigator.storage.estimate();

		return { usado: usage ?? 0, total: quota ?? 0 };
	} catch {
		return null;
	}
}

// ── Registro del envío en segundo plano ──────────────────────────────────────

/**
 * Le pide al navegador que entregue el evento `sync` cuando vuelva la
 * conectividad, aunque para entonces el censador ya haya cerrado la aplicación.
 *
 * Devuelve false donde no hay soporte —Firefox y Safari no implementan
 * Background Sync—; ahí la aplicación se queda con el reintento en primer plano,
 * que ya funciona mientras la pestaña esté abierta.
 */
export async function pedirEnvioEnSegundoPlano(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;

	try {
		const registro = await navigator.serviceWorker.ready;

		if (!('sync' in registro)) return false;

		await (registro as ServiceWorkerRegistration & {
			sync: { register: (etiqueta: string) => Promise<void> };
		}).sync.register(ETIQUETA_SYNC);

		return true;
	} catch {
		return false;
	}
}
