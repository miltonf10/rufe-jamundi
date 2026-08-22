// Grabar un video en el teléfono y subirlo por trozos.
//
// Dos problemas que resolver, y ninguno es opcional:
//
// 1. **Cada teléfono graba distinto.** Android produce WebM con VP9 o VP8;
//    iPhone no sabe grabar WebM y da MP4 con H.264. No se puede pedir un formato
//    y confiar: hay que preguntarle al navegador qué sabe hacer y quedarse con
//    lo primero que acepte.
//
// 2. **El video no cabe en una petición.** El tope por archivo de este hosting
//    es 1 MiB y un video de 30 segundos a 480p pesa unos 3 MB. Se parte en
//    trozos de 1 MiB y se manda uno a uno. De paso, una subida cortada por falta
//    de señal se reanuda desde donde iba en vez de empezar de cero.

import { API_BASE } from '$lib/api/client';

/**
 * Los formatos que se intentan, en orden de preferencia.
 *
 * VP9 comprime bastante mejor que VP8 —y en una vereda cada megabyte son
 * segundos de subida—, así que va primero. Android suele darlo.
 *
 * El MP4 del final NO es un adorno: Safari, en iPhone y en Mac, **solo** sabe
 * grabar MP4 con H.264 y AAC, y no soporta WebM en absoluto. Es lo que dice
 * WebKit al anunciar la API (webkit.org/blog/11353/mediarecorder-api/). Sin esa
 * entrada, ningún iPhone podría grabar.
 */
const FORMATOS = [
	'video/webm;codecs=vp9',
	'video/webm;codecs=vp8',
	'video/webm',
	'video/mp4;codecs=avc1',
	'video/mp4'
];

/**
 * Resolución objetivo.
 *
 * 480p y no 720p a conciencia: a 720p un video de 30 segundos ronda los 15 MB y
 * son más de quince minutos de subida en una 3G rural. A 480p baja a unos 3 MB.
 * Para ver una grieta o un techo hundido sobra.
 */
export const RESTRICCIONES: MediaStreamConstraints = {
	video: {
		width: { ideal: 854 },
		height: { ideal: 480 },
		frameRate: { ideal: 24, max: 30 },
		facingMode: { ideal: 'environment' }
	},
	audio: true
};

/** El primer formato que este navegador sepa grabar, o null si no sabe ninguno. */
export function formatoSoportado(): string | null {
	if (typeof MediaRecorder === 'undefined') return null;

	// Hay implementaciones de Safari con MediaRecorder pero SIN `isTypeSupported`.
	// El propio WebKit documenta la salida: dar por bueno MP4, que es lo único
	// que graba. Sin este caso, esos teléfonos dirían «no se puede grabar»
	// teniendo la cámara perfectamente disponible.
	if (typeof MediaRecorder.isTypeSupported !== 'function') {
		return 'video/mp4';
	}

	return FORMATOS.find((f) => MediaRecorder.isTypeSupported(f)) ?? null;
}

/** El MIME sin los parámetros de códec, que es lo que entiende el servidor. */
export function mimeBase(formato: string): string {
	return formato.split(';')[0];
}

export type EstadoSubida = {
	subidos: number;
	total: number;
};

/**
 * Sube un video ya grabado, trozo a trozo.
 *
 * Reintenta cada trozo unas cuantas veces antes de rendirse: en una vereda una
 * petición suelta falla por nada y volver a empezar el video entero sería
 * castigar a quien peor señal tiene.
 */
export async function subirVideo(
	carga: string,
	categoriaId: number | null,
	blob: Blob,
	mime: string,
	segundos: number,
	alAvanzar?: (e: EstadoSubida) => void
): Promise<number> {
	// JSON, no `application/x-www-form-urlencoded`: el servidor lee el cuerpo con
	// `json_decode` y un formulario le llega vacío. El único sitio que va como
	// multipart es la subida del trozo, que por fuerza lleva un archivo.
	const inicio = await fetch(`${API_BASE}/preinscripcion/cargas/${carga}/videos`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			categoria_id: categoriaId === null ? '' : String(categoriaId),
			mime,
			bytes: String(blob.size),
			segundos: String(Math.round(segundos))
		})
	});

	if (!inicio.ok) throw await comoError(inicio);

	const { data } = await inicio.json();
	const idVideo: number = data.id;
	const bytesTrozo: number = data.bytes_trozo;
	const total: number = data.trozos;

	for (let i = 0; i < total; i++) {
		const trozo = blob.slice(i * bytesTrozo, (i + 1) * bytesTrozo);
		await subirTrozo(carga, idVideo, i, trozo);
		alAvanzar?.({ subidos: i + 1, total });
	}

	return idVideo;
}

const REINTENTOS = 3;

async function subirTrozo(carga: string, idVideo: number, indice: number, trozo: Blob): Promise<void> {
	let ultimoError: unknown = null;

	for (let intento = 0; intento < REINTENTOS; intento++) {
		try {
			const cuerpo = new FormData();
			cuerpo.append('indice', String(indice));
			cuerpo.append('trozo', trozo, `trozo-${indice}`);

			const r = await fetch(`${API_BASE}/preinscripcion/cargas/${carga}/videos/${idVideo}/trozos`, {
				method: 'POST',
				body: cuerpo
			});

			if (r.ok) return;

			// Un rechazo por validación no mejora reintentando: el trozo seguirá
			// siendo el mismo por mucho que se repita.
			if (r.status >= 400 && r.status < 500) throw await comoError(r);

			ultimoError = await comoError(r);
		} catch (e) {
			if (e instanceof ErrorDeVideo) throw e;
			ultimoError = e;
		}

		// Espera creciente: reintentar de inmediato sobre una red saturada solo
		// añade tráfico al problema.
		await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
	}

	throw ultimoError instanceof Error
		? ultimoError
		: new Error('No se pudo subir el video. Revise su conexión.');
}

export class ErrorDeVideo extends Error {}

async function comoError(r: Response): Promise<Error> {
	try {
		const cuerpo = await r.json();
		const mensaje = cuerpo?.errors?.video ?? cuerpo?.message ?? 'No se pudo subir el video.';

		return r.status >= 400 && r.status < 500 ? new ErrorDeVideo(mensaje) : new Error(mensaje);
	} catch {
		return new Error('No se pudo subir el video.');
	}
}
