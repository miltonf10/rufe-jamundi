/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Service Worker del Sistema de Gestión del Riesgo.
//
// Existe por un escenario concreto de campo: se levanta la ficha en una vereda
// sin cobertura, se guarda el teléfono en el bolsillo y la señal vuelve tres
// horas después, camino al casco urbano.
//
// Hace tres cosas para que eso funcione:
//
// - Guarda la aplicación al instalarse, para que se pueda abrir sin señal.
// - Guarda los catálogos del formulario, sin los cuales no hay nada que dibujar.
// - Envía las fichas de la cola cuando vuelve la conexión, aunque el censador ya
//   haya cerrado el navegador.
//
// Lo que sigue SIN guardarse, y esa es la regla que ordena todo: cualquier otra
// respuesta de la API. Llevan nombres, cédulas y direcciones de hogares
// damnificados, y servir eso rancio desde un teléfono sería un problema serio.
//
// El Service Worker solo corre en contexto seguro. De ahí la cabecera HSTS del
// .htaccess: sin ella, quien entre por http:// se queda sin envío en segundo
// plano y sin enterarse.

import { base, build, files, version } from '$service-worker';
import { RUTA_PLANTILLA } from '$lib/ficha-pdf/coordenadas';
import { RUTA_PLANTILLA as RUTA_INSPECCION } from '$lib/inspeccion-pdf/coordenadas';
import { seGuardaDeLaApi } from '$lib/offline/cacheables';
import { baseApi, ErrorDeRed, subirFotosDe } from '$lib/rufe-form/subida';
import {
	DESTINO,
	ETIQUETA_SYNC,
	borrarFotosDe,
	fichasPendientes,
	fotosDe,
	guardarFicha,
	tipoDe,
	tokenEspejado,
	type FichaEnCola,
	type FotoEnCola
} from '$lib/rufe-form/cola';

const sw = self as unknown as ServiceWorkerGlobalScope;

// ── La aplicación guardada en el teléfono ────────────────────────────────────
//
// Sin esto el sistema tenía una contradicción: se podía levantar una ficha sin
// señal, pero solo si la aplicación YA estaba abierta cuando se cayó la
// conexión. Un censador que la cerrara, o que llegara a una vereda sin datos, no
// tenía de dónde cargarla y no veía nada.
//
// El nombre de la caché lleva la versión del build. Al desplegar una versión
// nueva se crea otra caché y se borran las anteriores, así que es imposible
// quedarse servido de archivos viejos para siempre.

const CACHE = `sgr-${version}`;

/**
 * Caché aparte para las respuestas de la API que sí se pueden guardar.
 *
 * Hoy es UNA sola: los catálogos del formulario. Va separada del armazón para
 * que se vea de un vistazo qué datos vive el teléfono y para poder vaciarla sin
 * tocar la aplicación guardada.
 */
const CACHE_DATOS = `sgr-datos-${version}`;

/**
 * El armazón: lo que hay que tener guardado para que la aplicación arranque.
 *
 * Se deja fuera lo que no sirve sin conexión o que el servidor ni siquiera
 * entrega: `.htaccess` lo deniega Apache siempre, y `robots.txt` y la imagen de
 * vista previa solo los usan buscadores y redes sociales, que necesitan internet
 * por definición.
 */
const FUERA = [
	'.htaccess',
	'/robots.txt',
	'/og-sgr.jpg',
	// El formato oficial en blanco pesa 290 KB y solo lo necesita quien descarga
	// una ficha desde la bandeja, que es trabajo de escritorio. Descargarlo en la
	// instalación le costaría esos datos a cada censador que solo va a levantar
	// fichas. Se guarda igual la primera vez que alguien lo usa, así que a partir
	// de ahí la descarga funciona sin conexión.
	RUTA_PLANTILLA,
	// Y por lo mismo el formato de inspección, que pesa otros 220 KB.
	RUTA_INSPECCION,

	// Los iconos de la aplicación instalada. Desde que llevan el escudo oficial
	// en vez de tres letras sobre un cuadrado azul pesan unos 210 KB cada uno de
	// los grandes, y no los pide NUNCA la aplicación en marcha: los descarga el
	// sistema operativo al instalarla y a partir de ahí vive con su copia.
	// Guardarlos en el armazón le costaba medio mega de datos a cada censador
	// para dibujar algo que ya está en su pantalla de inicio.
	'/icono-512.png',
	'/icono-maskable-512.png',
	'/apple-touch-icon.png'
];

const ARMAZON = [`${base}/`, ...build, ...files].filter(
	(ruta) => !FUERA.some((f) => ruta.endsWith(f))
);

sw.addEventListener('install', (evento) => {
	const e = evento as ExtendableEvent;

	e.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);

			// Uno a uno y tolerando fallos: con `addAll`, un solo archivo que no
			// responda aborta la instalación entera y el teléfono se queda sin
			// aplicación guardada.
			await Promise.all(
				ARMAZON.map(async (ruta) => {
					try {
						const res = await fetch(ruta, { cache: 'no-cache' });
						if (res.ok) await cache.put(ruta, res);
					} catch {
						// Se seguirá pidiendo a la red cuando haga falta.
					}
				})
			);

			// Se activa de inmediato: esperar a que se cierren las pestañas solo
			// retrasaría el envío de las fichas pendientes.
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (evento) => {
	const e = evento as ExtendableEvent;

	e.waitUntil(
		(async () => {
			// Fuera las cachés de versiones anteriores.
			await Promise.all(
				(await caches.keys())
					.filter((n) => n.startsWith('sgr-') && n !== CACHE && n !== CACHE_DATOS)
					.map((n) => caches.delete(n))
			);

			await sw.clients.claim();

			// Se avisa a las pestañas abiertas en vez de recargarlas por sorpresa:
			// recargar a alguien a mitad de una ficha sería peor que dejarle con la
			// versión anterior un rato más.
			await avisarALaPagina({ tipo: 'version-nueva', version });
		})()
	);
});

/**
 * De dónde sale cada cosa cuando el teléfono pide algo.
 *
 * Las reglas son distintas por tipo, y la más importante es la que NO cachea:
 * `/api/` lleva datos personales de hogares damnificados y no puede servirse
 * rancio. Sin señal falla, y de los envíos ya se encarga la cola.
 */
sw.addEventListener('fetch', (evento) => {
	const e = evento as FetchEvent;
	const peticion = e.request;

	if (peticion.method !== 'GET') return;

	const url = new URL(peticion.url);

	// Solo lo propio. Las hojas de Google y las tejas del mapa son de otros
	// dominios y necesitan datos frescos; que pasen de largo.
	if (url.origin !== sw.location.origin) return;

	if (url.pathname.startsWith('/api/')) {
		// De la API solo se guarda lo que está en la lista, y nada más.
		if (seGuardaDeLaApi(url.pathname)) {
			e.respondWith(responderCatalogos(peticion, url));
		}

		return;
	}

	e.respondWith(responder(peticion, url));
});

/**
 * Los catálogos: primero la red, y si no hay, la copia guardada.
 *
 * En ese orden porque un catálogo nuevo —un corregimiento que se suma, un tipo
 * de bien que se corrige— debe verse en cuanto haya señal. La copia es la red de
 * seguridad para la vereda, no la fuente habitual.
 */
async function responderCatalogos(peticion: Request, url: URL): Promise<Response> {
	const cache = await caches.open(CACHE_DATOS);

	try {
		const red = await fetch(peticion);

		if (red.ok) void cache.put(url.pathname, red.clone());

		return red;
	} catch {
		const guardado = await cache.match(url.pathname);
		if (guardado) return guardado;

		throw new Error('Sin conexión y sin catálogos guardados.');
	}
}

async function responder(peticion: Request, url: URL): Promise<Response> {
	const cache = await caches.open(CACHE);

	// Los archivos con hash en el nombre no cambian nunca: si cambia el
	// contenido, cambia el nombre. Se sirven de la caché sin preguntar.
	if (build.includes(url.pathname)) {
		const guardado = await cache.match(url.pathname);
		if (guardado) return guardado;
	}

	// Navegar a cualquier ruta devuelve el armazón. Se intenta primero la red
	// —así una versión nueva se ve en cuanto hay señal— y si no hay, el guardado.
	if (peticion.mode === 'navigate') {
		try {
			const red = await fetch(peticion);
			if (red.ok) return red;
		} catch {
			// Sin señal: se sigue con lo guardado.
		}

		const armazon = (await cache.match(`${base}/`)) ?? (await cache.match('/200.html'));
		if (armazon) return armazon;
	}

	try {
		const red = await fetch(peticion);

		// Lo que se descargue bien se guarda para la próxima vez sin señal.
		if (red.ok && (build.includes(url.pathname) || files.includes(url.pathname))) {
			void cache.put(url.pathname, red.clone());
		}

		return red;
	} catch {
		const guardado = await cache.match(url.pathname);
		if (guardado) return guardado;

		throw new Error('Sin conexión y sin copia guardada.');
	}
}

sw.addEventListener('sync', (evento) => {
	const e = evento as ExtendableEvent & { tag: string };

	if (e.tag === ETIQUETA_SYNC) {
		// waitUntil mantiene vivo el Service Worker hasta que la promesa termine.
		// Si se rechaza, el navegador reintenta con retroceso exponencial.
		e.waitUntil(enviarPendientes());
	}
});

// La página puede pedir un intento inmediato: al recuperar la conexión con la
// aplicación abierta no hay que esperar al evento del navegador.
sw.addEventListener('message', (evento) => {
	if (evento.data?.tipo === 'enviar-pendientes') {
		evento.waitUntil?.(enviarPendientes());
		void enviarPendientes();
	}
});

// ── Envío ────────────────────────────────────────────────────────────────────

/**
 * Recorre la cola y envía lo que pueda.
 *
 * Se lanza el error si algo queda pendiente por causas de red: eso hace que el
 * navegador vuelva a intentarlo. Si lo que falla es la validación o la sesión,
 * la ficha se marca y NO se pide reintento, porque reintentar lo mismo daría
 * igual y solo gastaría batería.
 */
async function enviarPendientes(): Promise<void> {
	// Las que el servidor ya rechazó se quedan quietas: reintentarlas en cada
	// evento de red gastaría batería sin cambiar nada. Solo el censador puede
	// desatascarlas, desde «Pendientes».
	const pendientes = (await fichasPendientes()).filter((f) => f.estado !== 'error');
	if (pendientes.length === 0) return;

	const token = await tokenEspejado();

	if (!token) {
		// Sin sesión no se puede enviar. Las fichas se quedan intactas y la
		// aplicación avisará al abrirse. No es un fallo de red: no se reintenta.
		await avisarALaPagina({ tipo: 'sesion-requerida', pendientes: pendientes.length });

		return;
	}

	let huboFalloDeRed = false;

	for (const ficha of pendientes) {
		const resultado = await enviarFicha(ficha, token);

		if (resultado === 'red') {
			huboFalloDeRed = true;
			break; // Sin red, seguir con las demás solo gasta batería.
		}

		if (resultado === 'sesion') {
			await avisarALaPagina({ tipo: 'sesion-requerida', pendientes: pendientes.length });

			return;
		}
	}

	await avisarALaPagina({ tipo: 'cola-cambiada' });

	if (huboFalloDeRed) {
		// Rechazar es lo que le pide al navegador que vuelva a intentarlo.
		throw new Error('Todavía no hay conexión.');
	}
}

type Resultado = 'ok' | 'red' | 'sesion' | 'rechazada';

async function enviarFicha(ficha: FichaEnCola, token: string): Promise<Resultado> {
	ficha.estado = 'enviando';
	ficha.intentos += 1;
	ficha.actualizadoEn = Date.now();
	await guardarFicha(ficha);

	// Las fotos van primero: el servidor las adopta al recibir la ficha, así que
	// si la ficha entrara antes se quedarían huérfanas hasta caducar.
	let carga: string | null = null;

	// Los dos formatos llevan fotos: el censo su documento y sus daños, la
	// inspección el registro fotográfico del numeral 11. `subirFotosDe` devuelve
	// null cuando la ficha no trae ninguna, así que no hace falta preguntar por
	// el tipo.
	try {
		carga = await subirFotosDe(ficha, token);
	} catch (e) {
		return marcar(ficha, e);
	}

	let respuesta: Response;

	try {
		// Cada formato va a su ruta. La tabla vive en `cola.ts` para que sumar un
		// tercero no obligue a tocar el Service Worker.
		respuesta = await fetch(`${baseApi()}${DESTINO[tipoDe(ficha)].ruta}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ ...ficha.cuerpo, envio_id: ficha.envioId, ...(carga ? { carga } : {}) })
		});
	} catch {
		return marcar(ficha, new ErrorDeRed());
	}

	if (respuesta.status === 401) {
		ficha.estado = 'pendiente';
		ficha.error = 'La sesión venció. Inicie sesión para enviar las fichas pendientes.';
		await guardarFicha(ficha);

		return 'sesion';
	}

	if (respuesta.status >= 500 || respuesta.status === 429) {
		return marcar(ficha, new ErrorDeRed());
	}

	let datos: {
		ok?: boolean;
		data?: Record<string, unknown>;
		message?: string;
		errors?: Record<string, string>;
	};

	try {
		datos = await respuesta.json();
	} catch {
		return marcar(ficha, new ErrorDeRed());
	}

	if (!respuesta.ok || datos.ok === false) {
		// 4xx: los datos no sirven. Reintentar los mismos no cambiaría nada, así
		// que se marca para que una persona lo resuelva.
		ficha.estado = 'error';
		ficha.error = datos.message ?? 'El servidor rechazó la ficha.';
		ficha.errores = datos.errors && Object.keys(datos.errors).length > 0 ? datos.errors : undefined;
		ficha.actualizadoEn = Date.now();
		await guardarFicha(ficha);

		return 'rechazada';
	}

	ficha.estado = 'enviada';
	// El censo lo llama «radicado» y la inspección «número»; se guardan los dos
	// para que la pantalla de pendientes no tenga que saber cuál mirar.
	const identificador = datos.data?.[DESTINO[tipoDe(ficha)].clave];
	ficha.numero = typeof identificador === 'string' ? identificador : undefined;
	ficha.radicado = ficha.numero;
	ficha.error = undefined;
	ficha.errores = undefined;
	ficha.actualizadoEn = Date.now();
	await guardarFicha(ficha);
	await borrarFotosDe(ficha.envioId);

	return 'ok';
}

async function marcar(ficha: FichaEnCola, e: unknown): Promise<Resultado> {
	const esRed = e instanceof ErrorDeRed;

	ficha.estado = 'pendiente';
	ficha.error = esRed ? undefined : 'No se pudo enviar. Se reintentará.';
	ficha.actualizadoEn = Date.now();
	await guardarFicha(ficha);

	return esRed ? 'red' : 'red';
}

/** Si hay alguna pestaña abierta, se le cuenta lo que pasó. */
async function avisarALaPagina(mensaje: Record<string, unknown>): Promise<void> {
	const clientes = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });

	for (const cliente of clientes) {
		cliente.postMessage({ origen: 'sgr-sw', version, ...mensaje });
	}
}
