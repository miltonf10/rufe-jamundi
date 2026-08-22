// Almacén local de las fotos del reporte, en IndexedDB.
//
// Por qué IndexedDB y no localStorage, que es lo que usa el resto del borrador:
// localStorage solo guarda cadenas, así que una foto habría que codificarla en
// base64 (un 33 % más grande) y su cuota ronda los 5 MB — una sola foto de un
// teléfono actual ya la desborda. IndexedDB guarda `Blob` tal cual y su cuota se
// mide en cientos de megabytes.
//
// Todo lo de aquí falla en silencio a propósito: si el navegador tiene el
// almacenamiento bloqueado (modo privado de algunos navegadores, cuota llena),
// el formulario debe seguir funcionando sin fotos guardadas, no romperse.

const BASE = 'sgr_rufe';
const VERSION = 1;
const ALMACEN = 'evidencias';

import type { TipoEvidencia } from './tipos';

export type EvidenciaGuardada = {
	uid: string;
	claveBorrador: string;
	nombre: string;
	/** MIME del archivo. */
	tipo: string;
	/** DOCUMENTO, DANO o INSPECCION. */
	categoria: TipoEvidencia;
	blob: Blob;
	/** El «FOTOGRAFIA DE:» del numeral 11, si lo lleva. */
	descripcion?: string;
	/**
	 * ¿El blob guardado ya pasó por la compresión?
	 *
	 * Sin este dato no hay forma de distinguir una foto optimizada de una
	 * original guardada por una versión anterior del formulario, y al recuperar
	 * el borrador se subiría el original —justo lo que la optimización existe
	 * para impedir—. Ausente significa «no lo sé», y se vuelve a comprimir.
	 */
	optimizada?: boolean;
	/** Métricas del ahorro, para no perderlas al recuperar el borrador. */
	metricas?: unknown;
};

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
			if (!db.objectStoreNames.contains(ALMACEN)) {
				const almacen = db.createObjectStore(ALMACEN, { keyPath: 'uid' });
				// Se consulta siempre por borrador, nunca por archivo suelto.
				almacen.createIndex('claveBorrador', 'claveBorrador', { unique: false });
			}
		};
		solicitud.onsuccess = () => resolver(solicitud.result);
		solicitud.onerror = () => resolver(null);
		solicitud.onblocked = () => resolver(null);
	});
}

function transaccion<T>(
	modo: IDBTransactionMode,
	fn: (almacen: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
	return abrir().then(
		(db) =>
			new Promise<T | null>((resolver) => {
				if (!db) {
					resolver(null);

					return;
				}

				try {
					const tx = db.transaction(ALMACEN, modo);
					const solicitud = fn(tx.objectStore(ALMACEN));
					solicitud.onsuccess = () => resolver(solicitud.result);
					solicitud.onerror = () => resolver(null);
					tx.oncomplete = () => db.close();
				} catch {
					resolver(null);
				}
			})
	);
}

export async function guardarEvidencia(registro: EvidenciaGuardada): Promise<void> {
	await transaccion('readwrite', (a) => a.put(registro));
}

export async function leerEvidencias(claveBorrador: string): Promise<EvidenciaGuardada[]> {
	const db = await abrir();
	if (!db) return [];

	return new Promise((resolver) => {
		try {
			const tx = db.transaction(ALMACEN, 'readonly');
			const indice = tx.objectStore(ALMACEN).index('claveBorrador');
			const solicitud = indice.getAll(claveBorrador);
			solicitud.onsuccess = () => resolver((solicitud.result as EvidenciaGuardada[]) ?? []);
			solicitud.onerror = () => resolver([]);
			tx.oncomplete = () => db.close();
		} catch {
			resolver([]);
		}
	});
}

export async function borrarEvidencia(uid: string): Promise<void> {
	await transaccion('readwrite', (a) => a.delete(uid));
}

/** Se llama al enviar el reporte y al descartar el borrador. */
export async function borrarEvidenciasDe(claveBorrador: string): Promise<void> {
	const registros = await leerEvidencias(claveBorrador);
	await Promise.all(registros.map((r) => borrarEvidencia(r.uid)));
}
