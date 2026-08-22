// Optimización de las fotos del RUFE, en el propio teléfono.
//
// La foto original NUNCA sale del dispositivo. Una cámara de gama media entrega
// entre 4 y 25 MB por foto; cinco de esas, por una red móvil de vereda, son una
// carga que no termina nunca. Se comprime aquí y se sube solo el resultado.
//
// Además hace viable la cola sin conexión: cinco fotos sin comprimir ocupan unos
// 40 MB en IndexedDB, y comprimidas rondan los 2 MB. Sin este paso, encolar
// fotos habría sido temerario.
//
// Tres decisiones que explican el resto del archivo:
//
// 1. Se quitan los metadatos EXIF, incluida la geolocalización. No es una
//    pérdida: la ubicación se toma aparte, con consentimiento explícito. Guardar
//    en silencio las coordenadas incrustadas en una foto contradiría eso.
//
// 2. La cédula y las fotos del daño no se comprimen igual. En la cédula hay que
//    poder leer un número de documento: se prioriza legibilidad y nunca se baja
//    de 1600 px. En el daño interesa el conjunto, no el detalle.
//
// 3. Si tras agotar la escalera la foto no cabe en el límite, se rechaza con un
//    mensaje. Degradar en silencio hasta volver ilegible una evidencia es peor
//    que no tenerla: nadie se entera de que ya no sirve.

import comprimir from 'browser-image-compression';
import type { TipoEvidencia } from './tipos';

/** Nunca se envía nada por encima de esto. */
export const LIMITE_ABSOLUTO = 900 * 1024;

/** Objetivo en condiciones normales. */
export const OBJETIVO_NORMAL = 500 * 1024;

export type PasoEscalera = {
	/** Lado mayor, en píxeles. */
	lado: number;
	calidad: number;
	/** Meta de peso de este intento, en bytes. */
	meta: number;
};

/**
 * Escalera para las fotos del daño. Empieza cómoda y aprieta solo si hace falta.
 */
export const ESCALERA_NORMAL: PasoEscalera[] = [
	{ lado: 1920, calidad: 0.84, meta: 500 * 1024 },
	{ lado: 1920, calidad: 0.78, meta: 700 * 1024 },
	{ lado: 1600, calidad: 0.76, meta: 900 * 1024 },
	{ lado: 1440, calidad: 0.72, meta: 900 * 1024 }
];

/**
 * Escalera para el documento de identidad.
 *
 * Apunta directo al límite alto y baja la calidad antes que la resolución,
 * porque lo que se juega es leer un número de cédula. No baja de 1600 px: por
 * debajo, un documento fotografiado con luz de tarde deja de ser legible y la
 * evidencia no sirve para nada.
 */
export const ESCALERA_DETALLE: PasoEscalera[] = [
	{ lado: 1920, calidad: 0.88, meta: 900 * 1024 },
	{ lado: 1920, calidad: 0.82, meta: 900 * 1024 },
	{ lado: 1920, calidad: 0.76, meta: 900 * 1024 },
	{ lado: 1600, calidad: 0.74, meta: 900 * 1024 }
];

export function escaleraPara(tipo: TipoEvidencia): PasoEscalera[] {
	return tipo === 'DOCUMENTO' ? ESCALERA_DETALLE : ESCALERA_NORMAL;
}

/** ¿Hay que seguir apretando, o ya cabe? */
export function cumple(bytes: number, paso: PasoEscalera): boolean {
	return bytes <= paso.meta;
}

export function dentroDelLimite(bytes: number): boolean {
	return bytes <= LIMITE_ABSOLUTO;
}

// ── Resultado ────────────────────────────────────────────────────────────────

export type MetricasImagen = {
	nombreOriginal: string;
	mimeOriginal: string;
	bytesOriginal: number;
	bytesOptimizada: number;
	/** Entero de 0 a 100. */
	reduccion: number;
	ancho: number;
	alto: number;
	mimeFinal: string;
	/** En qué escalón de la escalera se logró. Útil para diagnosticar. */
	intentos: number;
};

export type ResultadoImagen =
	| { ok: true; archivo: File; vistaPrevia: string; metricas: MetricasImagen }
	| { ok: false; motivo: string };

export function reduccion(original: number, optimizada: number): number {
	if (original <= 0) return 0;

	return Math.max(0, Math.round((1 - optimizada / original) * 100));
}

// ── Formato de salida ────────────────────────────────────────────────────────

let soporteWebp: boolean | null = null;

/**
 * ¿Este navegador sabe CODIFICAR WebP?
 *
 * Se comprueba codificando de verdad, no por la cadena del navegador: hay
 * navegadores que muestran WebP pero no lo generan, y ahí `toDataURL` devuelve
 * un PNG sin avisar.
 */
export function soportaWebp(): boolean {
	if (soporteWebp !== null) return soporteWebp;

	try {
		const lienzo = document.createElement('canvas');
		lienzo.width = 1;
		lienzo.height = 1;
		soporteWebp = lienzo.toDataURL('image/webp').startsWith('data:image/webp');
	} catch {
		soporteWebp = false;
	}

	return soporteWebp;
}

export function mimeDeSalida(): 'image/webp' | 'image/jpeg' {
	// JPEG y no PNG como respaldo: para una fotografía, PNG produce archivos
	// varias veces más pesados, que es justo lo contrario de lo que se busca.
	return soportaWebp() ? 'image/webp' : 'image/jpeg';
}

export function extensionDe(mime: string): string {
	return mime === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * Nombre con el que viaja la foto.
 *
 * No se reutiliza el del archivo original: puede traer el nombre de la persona,
 * caracteres que rompan una ruta, o simplemente delatar el modelo del teléfono.
 * El servidor lo vuelve a renombrar de todos modos.
 */
export function nombreSeguro(tipo: TipoEvidencia, mime: string): string {
	const azar =
		typeof crypto !== 'undefined' && crypto.randomUUID
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10);

	return `${tipo.toLowerCase()}-${Date.now().toString(36)}-${azar}.${extensionDe(mime)}`;
}

export function tamanoLegible(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;

	return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function liberarVistaPrevia(url: string | undefined): void {
	if (url) URL.revokeObjectURL(url);
}

// ── Validación ───────────────────────────────────────────────────────────────

/**
 * ¿Es una imagen que este navegador puede abrir?
 *
 * Se decodifica de verdad. Ni la extensión ni el MIME que declara el sistema son
 * de fiar: un `.jpg` puede ser cualquier cosa, y un HEIC de iPhone se anuncia
 * como imagen pero Chrome en Android no sabe leerlo.
 */
export async function validarImagen(archivo: File): Promise<{ ok: true } | { ok: false; motivo: string }> {
	if (archivo.size === 0) {
		return { ok: false, motivo: 'El archivo está vacío.' };
	}

	if (!archivo.type.startsWith('image/')) {
		return { ok: false, motivo: 'Ese archivo no es una imagen.' };
	}

	try {
		const bitmap = await createImageBitmap(archivo);
		const valido = bitmap.width > 0 && bitmap.height > 0;
		bitmap.close();

		if (!valido) return { ok: false, motivo: 'La imagen está dañada.' };

		return { ok: true };
	} catch {
		// El caso frecuente y concreto: una foto HEIC de iPhone abierta en Chrome
		// de Android. Decirlo así evita que el técnico crea que el sistema falló.
		const esHeic = /heic|heif/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name);

		return {
			ok: false,
			motivo: esHeic
				? 'Este teléfono no puede leer fotos en formato HEIC. Tómela con la cámara desde aquí, o cambie el formato de la cámara del iPhone a «Más compatible».'
				: 'No se pudo abrir la imagen. Puede estar dañada o en un formato que este teléfono no reconoce.'
		};
	}
}

// ── Compresión ───────────────────────────────────────────────────────────────

/**
 * Comprime una evidencia recorriendo la escalera hasta que quepa.
 *
 * @param alProgresar recibe 0..100 del intento en curso
 */
export async function comprimirEvidencia(
	archivo: File,
	tipo: TipoEvidencia,
	alProgresar?: (porcentaje: number) => void
): Promise<ResultadoImagen> {
	const validez = await validarImagen(archivo);
	if (!validez.ok) return { ok: false, motivo: validez.motivo };

	const mime = mimeDeSalida();
	const escalera = escaleraPara(tipo);

	let mejor: Blob | null = null;
	let intentos = 0;

	for (const paso of escalera) {
		intentos++;

		try {
			const salida = await comprimir(archivo, {
				fileType: mime,
				maxWidthOrHeight: paso.lado,
				initialQuality: paso.calidad,
				maxSizeMB: paso.meta / (1024 * 1024),
				// El hilo principal debe seguir respondiendo: en un teléfono de gama
				// baja, comprimir 20 MB en el hilo de la interfaz la congela varios
				// segundos y parece que la aplicación se colgó.
				useWebWorker: true,
				// Fuera EXIF: con él viajaría la geolocalización de la foto, que es
				// justo lo que el formulario pide aparte y con consentimiento.
				preserveExif: false,
				onProgress: (p: number) => alProgresar?.(Math.round(p))
			});

			mejor = salida;

			if (cumple(salida.size, paso)) break;
		} catch {
			// Un escalón puede fallar por memoria en un teléfono modesto. Se sigue
			// con el siguiente, que pide menos.
			continue;
		}
	}

	if (!mejor) {
		return { ok: false, motivo: 'No se pudo procesar la imagen en este teléfono.' };
	}

	if (!dentroDelLimite(mejor.size)) {
		return {
			ok: false,
			motivo:
				'No fue posible optimizar esta foto sin afectar su legibilidad. Tómela más cerca, con buena iluminación, o elija otra imagen.'
		};
	}

	const medidas = await medir(mejor);
	const optimizada = new File([mejor], nombreSeguro(tipo, mime), { type: mime });

	return {
		ok: true,
		archivo: optimizada,
		// La vista previa es de la versión optimizada, no del original: lo que se
		// ve tiene que ser lo que se va a enviar.
		vistaPrevia: URL.createObjectURL(optimizada),
		metricas: {
			nombreOriginal: archivo.name,
			mimeOriginal: archivo.type,
			bytesOriginal: archivo.size,
			bytesOptimizada: optimizada.size,
			reduccion: reduccion(archivo.size, optimizada.size),
			ancho: medidas.ancho,
			alto: medidas.alto,
			mimeFinal: mime,
			intentos
		}
	};
}

async function medir(blob: Blob): Promise<{ ancho: number; alto: number }> {
	try {
		const bitmap = await createImageBitmap(blob);
		const medidas = { ancho: bitmap.width, alto: bitmap.height };
		bitmap.close();

		return medidas;
	} catch {
		return { ancho: 0, alto: 0 };
	}
}
