// Envío del reporte, tolerante a quedarse sin señal.
//
// Un teléfono en zona de emergencia pierde cobertura a mitad del trámite. La
// ficha se guarda en el dispositivo y sale sola en cuanto hay red — y, desde que
// existe el Service Worker, también cuando el censador ya cerró la aplicación.
//
// Reparto de responsabilidades:
//
//   cola.ts             guarda la ficha y sus fotos en IndexedDB
//   service-worker.ts   las envía, incluso con la aplicación cerrada
//   este archivo        coordina, y reintenta en primer plano donde no hay
//                       Background Sync (Firefox y Safari no lo implementan)
//
// Lo que hace seguro reintentar es el `envio_id`: se genera una sola vez por
// ficha y viaja en cada intento. Si la ficha ya entró pero se perdió la
// respuesta, el servidor devuelve el radicado original en vez de registrar dos
// veces al mismo hogar.

import { browser } from '$app/environment';
import { ApiError, api, leerToken } from '$lib/api/client';
import type { RespuestaEnvio } from './tipos';
import { uid } from './esquema';
import {
	borrarFicha,
	DESTINO,
	fichasPendientes,
	guardarFicha,
	type TipoFicha,
	guardarFoto,
	leerFicha,
	pedirAlmacenamientoPersistente,
	pedirEnvioEnSegundoPlano,
	tipoDe,
	todasLasFichas,
	type FichaEnCola,
	type FotoEnCola
} from './cola';
import { ErrorDeRed, subirFotosDe } from './subida';

/** Una ficha en cola no se guarda para siempre: pasada una semana ya no sirve. */
const DIAS_VIGENCIA = 7;

/** Latido de reintento donde no hay Background Sync. */
const MS_REINTENTO = 30000;

export type EstadoEnvio = 'inactivo' | 'enviando' | 'en-cola' | 'enviado' | 'error';

export class GestorEnvio {
	estado = $state<EstadoEnvio>('inactivo');
	error = $state<string | null>(null);
	respuesta = $state<RespuestaEnvio | null>(null);
	intentos = $state(0);

	/** Cuántas fichas esperan salir, contando las de sesiones anteriores. */
	pendientes = $state(0);

	/** true cuando el navegador se encarga solo, aunque se cierre la aplicación. */
	enSegundoPlano = $state(false);

	/** La sesión venció y hay fichas esperando. */
	sesionRequerida = $state(false);

	readonly enCola = $derived(this.estado === 'en-cola');

	#envioId: string | null = null;
	#alVolverLaRed: (() => void) | null = null;
	#alMensaje: ((e: MessageEvent) => void) | null = null;
	#temporizador: ReturnType<typeof setInterval> | null = null;

	/**
	 * Arranca la vigilancia y retoma lo que quedara de una visita anterior.
	 * Devuelve la función de limpieza.
	 */
	iniciar(): () => void {
		if (!browser) return () => {};

		void this.#prepararse();

		this.#alVolverLaRed = () => void this.reintentarPendiente();
		window.addEventListener('online', this.#alVolverLaRed);

		// El Service Worker avisa cuando la cola cambia o cuando hace falta
		// iniciar sesión, para que la pantalla no se quede contando mal.
		this.#alMensaje = (e: MessageEvent) => {
			if (e.data?.origen !== 'sgr-sw') return;

			if (e.data.tipo === 'sesion-requerida') this.sesionRequerida = true;
			void this.#contarPendientes();
		};
		navigator.serviceWorker?.addEventListener('message', this.#alMensaje);

		// `online` no basta: en redes móviles el navegador puede creerse conectado
		// sin salida real. Este latido cubre ese caso y, sobre todo, los
		// navegadores sin Background Sync.
		this.#temporizador = setInterval(() => void this.reintentarPendiente(), MS_REINTENTO);

		return () => this.detener();
	}

	async #prepararse(): Promise<void> {
		await this.#purgarVencidas();
		await this.#contarPendientes();

		// Sin esto, IndexedDB se desaloja por «usado menos recientemente» y se
		// borra el origen entero: se perderían todas las fichas sin enviar.
		await pedirAlmacenamientoPersistente();

		if (this.pendientes > 0) {
			this.estado = 'en-cola';
			void this.reintentarPendiente();
		}
	}

	detener(): void {
		if (browser && this.#alVolverLaRed) {
			window.removeEventListener('online', this.#alVolverLaRed);
			this.#alVolverLaRed = null;
		}
		if (browser && this.#alMensaje) {
			navigator.serviceWorker?.removeEventListener('message', this.#alMensaje);
			this.#alMensaje = null;
		}
		if (this.#temporizador) clearInterval(this.#temporizador);
		this.#temporizador = null;
	}

	/**
	 * Encola la ficha y trata de enviarla.
	 *
	 * Devuelve `en-cola` cuando quedó guardada sin salir. No es un error, y sobre
	 * todo no es un final: en cuanto la ficha está en IndexedDB el trabajo de esa
	 * casa está a salvo, y el censador puede seguir con la siguiente sin esperar a
	 * que vuelva la señal. Esperar era lo que lo dejaba bloqueado en una vereda.
	 */
	async enviar(
		cuerpo: Record<string, unknown>,
		resumen: FichaEnCola['resumen'],
		fotos: (Omit<FotoEnCola, 'envioId' | 'subida'> & { subida?: boolean })[] = [],
		tipo: TipoFicha = 'RUFE'
	): Promise<{ estado: 'enviado'; respuesta: RespuestaEnvio } | { estado: 'en-cola' }> {
		this.#envioId ??= uid();

		const ficha: FichaEnCola = {
			envioId: this.#envioId,
			tipo,
			cuerpo,
			estado: 'pendiente',
			intentos: 0,
			creadoEn: Date.now(),
			actualizadoEn: Date.now(),
			resumen
		};

		// Las fotos se copian a la cola ATADAS A ESTA FICHA antes de intentar nada.
		// Viven en otro almacén mientras se está llenando el formulario, atadas al
		// borrador; si no se copiaran, el Service Worker no las encontraría y
		// enviaría la ficha sin evidencias, en silencio.
		for (const foto of fotos) {
			// Se respeta si la foto ya estaba subida. Marcarlas todas como
			// pendientes hacía que las que el formulario ya había subido se
			// volvieran a enviar a la misma carga, y la ficha quedaba con la misma
			// evidencia dos veces.
			await guardarFoto({ ...foto, envioId: ficha.envioId, subida: foto.subida ?? false });
		}

		await guardarFicha(ficha);
		await this.#contarPendientes();

		// Se le pide al navegador que se encargue aunque cerremos la aplicación.
		// Donde no hay soporte, queda el latido de arriba.
		this.enSegundoPlano = await pedirEnvioEnSegundoPlano();

		const respuesta = await this.#intentar(ficha);

		return respuesta ? { estado: 'enviado', respuesta } : { estado: 'en-cola' };
	}

	/** Reintenta lo que haya en cola. No hace nada si no hay nada o ya está en curso. */
	async reintentarPendiente(): Promise<RespuestaEnvio | null> {
		if (this.estado === 'enviando') return null;
		if (browser && !navigator.onLine) return null;

		// Con Service Worker activo, es él quien envía: aquí solo se le da un
		// empujón para no esperar al evento del navegador.
		if (this.enSegundoPlano && browser) {
			navigator.serviceWorker?.controller?.postMessage({ tipo: 'enviar-pendientes' });
		}

		// Las que el servidor ya rechazó se saltan en los reintentos automáticos.
		// Si no, la primera en error se reintenta cada 30 segundos para siempre y
		// las que están detrás nunca salen — la cola entera queda secuestrada por
		// una sola ficha defectuosa.
		const pendientes = (await fichasPendientes()).filter((f) => f.estado !== 'error');
		if (pendientes.length === 0) {
			await this.#contarPendientes();

			return null;
		}

		return this.#intentar(pendientes[0]);
	}

	/**
	 * Reintento pedido a mano desde «Pendientes».
	 *
	 * Reintenta también las rechazadas: si el motivo era del servidor y ya se
	 * corrigió, el censador no tiene otra forma de volver a intentarlo. Nunca
	 * propaga el error — quien pulsa el botón lee el resultado en la pantalla.
	 */
	async reintentarTodo(): Promise<void> {
		for (const f of await fichasPendientes()) {
			if (f.estado === 'error') {
				f.estado = 'pendiente';
				f.error = undefined;
				await guardarFicha(f);
			}
		}

		try {
			await this.reintentarPendiente();
		} catch {
			// El motivo ya quedó en this.error y en la propia ficha.
		}
	}

	descartar(): void {
		this.#envioId = null;
		this.estado = 'inactivo';
		this.error = null;
		this.intentos = 0;
		this.sesionRequerida = false;
	}

	async #intentar(ficha: FichaEnCola): Promise<RespuestaEnvio | null> {
		this.estado = 'enviando';
		this.error = null;

		ficha.intentos += 1;
		ficha.actualizadoEn = Date.now();
		this.intentos = ficha.intentos;
		await guardarFicha(ficha);

		try {
			// Las fotos van primero: el servidor las adopta al recibir la ficha, así
			// que si la ficha entrara antes se quedarían huérfanas hasta caducar.
			const token = leerToken();
			const carga = token ? await subirFotosDe(ficha, token) : null;

			// La ruta sale de DESTINO, no está escrita aquí: este método envía los
			// DOS formatos. Estuvo mandando las inspecciones a `/rufe/reportes`
			// —el Service Worker sí usaba DESTINO, así que solo fallaba con señal,
			// que es el caso que menos se prueba en un formulario de campo—.
			const respuesta = await api.post<RespuestaEnvio>(DESTINO[tipoDe(ficha)].ruta, {
				...ficha.cuerpo,
				envio_id: ficha.envioId,
				...(carga ? { carga } : {})
			});

			this.respuesta = respuesta;
			this.estado = 'enviado';
			this.sesionRequerida = false;
			await borrarFicha(ficha.envioId);
			await this.#contarPendientes();

			return respuesta;
		} catch (e) {
			// No se pudieron subir las fotos. Es de red: se espera y se reintenta.
			// La ficha no se toca — enviarla ahora la dejaría sin evidencias.
			if (e instanceof ErrorDeRed) {
				this.estado = 'en-cola';
				this.error = null;
				await this.#contarPendientes();

				return null;
			}

			// La sesión venció: la ficha se queda intacta y se pide entrar de nuevo.
			// No es culpa del dato ni de la red.
			if (e instanceof ApiError && e.status === 401) {
				this.sesionRequerida = true;
				this.estado = 'en-cola';
				await this.#contarPendientes();

				return null;
			}

			// Red caída o servidor caído: los dos se resuelven esperando.
			if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
				this.estado = 'en-cola';
				this.error = null;
				await this.#contarPendientes();

				return null;
			}

			// 4xx: los datos no sirven y reintentarlos daría igual. Pero la ficha NO
			// se borra: son los datos de un hogar damnificado y solo existen aquí.
			// Se marca con el motivo para que aparezca en «Pendientes» y sea el
			// censador quien decida corregirla o descartarla.
			this.error = e instanceof ApiError ? e.message : 'No se pudo enviar la ficha.';
			ficha.estado = 'error';
			ficha.error = this.error;
			ficha.errores = e instanceof ApiError && Object.keys(e.errors).length > 0 ? e.errors : undefined;
			await guardarFicha(ficha);
			await this.#contarPendientes();
			this.estado = 'error';

			throw e;
		}
	}

	async #contarPendientes(): Promise<void> {
		this.pendientes = (await fichasPendientes()).length;
	}

	async #purgarVencidas(): Promise<void> {
		const limite = Date.now() - DIAS_VIGENCIA * 86400000;

		for (const f of await todasLasFichas()) {
			if (f.estado === 'enviada' || f.creadoEn < limite) {
				await borrarFicha(f.envioId);
			}
		}
	}
}

/** ¿Hay algo esperando? Lo usa la pantalla para retomar sin instanciar el gestor. */
export async function hayFichasPendientes(): Promise<number> {
	return (await fichasPendientes()).length;
}

export { leerFicha };
