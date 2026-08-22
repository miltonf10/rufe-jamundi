// Dejar el teléfono listo para salir a campo sin señal.
//
// Hasta ahora la preparación ocurría de refilón: el Service Worker guardaba la
// aplicación al instalarse y el permiso de almacenamiento se pedía al encolar la
// primera ficha, o sea cuando ya se estaba en la vereda. El censador no tenía
// forma de saber si estaba preparado hasta que fallaba.
//
// Esto lo hace a propósito, con señal, y sobre todo lo COMPRUEBA: mirar la caché
// y decir qué hay de verdad, en vez de suponer que salió bien.

import { pedirAlmacenamientoPersistente } from '$lib/rufe-form/cola';
import { API_BASE, leerToken } from '$lib/api/client';
import { RUTA_PLANTILLA } from '$lib/ficha-pdf/coordenadas';
import { RUTA_PLANTILLA as RUTA_INSPECCION } from '$lib/inspeccion-pdf/coordenadas';

/** Los catálogos del formulario. Sin ellos no hay formulario que dibujar. */
const CATALOGOS = `${API_BASE}/rufe/catalogos`;

/** Los del formato de inspección: elementos, Anexo 1 y Anexo 2. */
const CATALOGOS_INSPECCION = `${API_BASE}/inspeccion/catalogos`;

export type Parte = {
	/** ¿Se puede abrir y usar el formulario sin señal? Es lo único imprescindible. */
	listo: boolean;
	aplicacion: boolean;
	catalogos: boolean;
	formato: boolean;
	almacenamientoPersistente: boolean;
	/** Qué faltó, en palabras, para poder decírselo a quien mira la pantalla. */
	faltantes: string[];
};

const hayCaches = () => typeof caches !== 'undefined';

/**
 * Descarga y comprueba todo lo que hace falta para trabajar sin internet.
 *
 * No lanza: un teléfono a medio preparar debe poder contarlo, no romperse. Quien
 * llama decide qué mostrar con el parte.
 */
export async function prepararParaCampo(): Promise<Parte> {
	// Primero el permiso de almacenamiento. Sin él, el navegador puede desalojar
	// el origen ENTERO cuando falte espacio, y con él se irían las fichas
	// levantadas y sin enviar. Pedirlo al final sería pedirlo tarde.
	const almacenamientoPersistente = await pedirAlmacenamientoPersistente();

	// En paralelo: son descargas independientes y el censador está esperando.
	const [catalogosRufe, catalogosInspeccion, formatoRufe, formatoInspeccion] = await Promise.all([
		guardar(CATALOGOS),
		guardar(CATALOGOS_INSPECCION),
		guardar(RUTA_PLANTILLA),
		guardar(RUTA_INSPECCION)
	]);

	// Los dos formularios de campo tienen que estar completos: quien sale a
	// censar también inspecciona, y descubrir en la vereda que falta uno es
	// exactamente lo que esta pantalla existe para evitar.
	const catalogos = catalogosRufe && catalogosInspeccion;
	const formato = formatoRufe && formatoInspeccion;

	const aplicacion = await aplicacionGuardada();

	const faltantes: string[] = [];
	if (!aplicacion) faltantes.push('la aplicación');
	if (!catalogos) faltantes.push('los formularios');
	if (!formato) faltantes.push('los formatos oficiales para descargar fichas');

	return {
		// El formato no entra en la cuenta: sirve para descargar PDF, que es
		// trabajo de escritorio. Sin él se sigue pudiendo censar, que es a lo que
		// se sale.
		listo: aplicacion && catalogos,
		aplicacion,
		catalogos,
		formato,
		almacenamientoPersistente,
		faltantes
	};
}

/**
 * Pide un recurso para que el Service Worker lo guarde de paso.
 *
 * Se pide a través de `fetch` normal —y no escribiendo en la caché desde aquí—
 * para que las reglas de qué se guarda y dónde vivan en un solo sitio: el
 * Service Worker. Dos sitios decidiendo lo mismo terminan discrepando.
 */
async function guardar(ruta: string): Promise<boolean> {
	// Los catálogos están detrás de sesión: sin la credencial el servidor
	// responde 401, no se guardaría nada y el parte diría «listo» sobre una
	// caché vacía. Los archivos estáticos ignoran la cabecera de más.
	const token = leerToken();
	const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

	try {
		const res = await fetch(ruta, { credentials: 'same-origin', headers });

		return res.ok;
	} catch {
		return false;
	}
}

/**
 * ¿Está la aplicación realmente guardada?
 *
 * Se comprueba que exista el armazón —lo que responde al abrir cualquier ruta—,
 * que es la condición de que la aplicación arranque sin señal. Decirle a alguien
 * «listo» sin mirar sería justo el error que esta pantalla viene a evitar.
 */
async function aplicacionGuardada(): Promise<boolean> {
	if (!hayCaches()) return false;

	try {
		const claves = (await caches.keys()).filter((n) => n.startsWith('sgr-'));

		for (const clave of claves) {
			const cache = await caches.open(clave);
			if ((await cache.match('/')) || (await cache.match('/200.html'))) return true;
		}

		return false;
	} catch {
		return false;
	}
}

/**
 * ¿Se está ejecutando como aplicación instalada?
 *
 * Importa más de lo que parece: instalada, el navegador conserva el
 * almacenamiento mucho mejor, y en iPhone es la única forma de que la caché no
 * se desaloje a los pocos días.
 */
export function estaInstalada(): boolean {
	if (typeof window === 'undefined') return false;

	return (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		// Safari en iOS no implementa `display-mode` y usa su propia propiedad.
		(navigator as unknown as { standalone?: boolean }).standalone === true
	);
}

/** ¿Es un iPhone o iPad? Ahí no existe el botón de instalar y hay que explicarlo. */
export function esIOS(): boolean {
	if (typeof navigator === 'undefined') return false;

	const ua = navigator.userAgent;

	// El iPad se anuncia como Mac desde iPadOS 13; lo delata que tenga táctil.
	return /iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
