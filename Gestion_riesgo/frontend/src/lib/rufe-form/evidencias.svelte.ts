// Cola de subida de las fotos del reporte.
//
// Dos clases de archivo, con cupo propio cada una: la foto del documento de
// identidad (una) y las fotos del daño (hasta cuatro). Se cuentan por separado
// porque cumplen funciones distintas y no deben competir por el mismo hueco.
//
// Los archivos se suben ANTES de enviar el formulario, contra una "carga"
// identificada por un token opaco. Al enviar el reporte, el servidor adopta esa
// carga. Se hace así, y no mandando todo junto al final, porque una foto de 8 MB
// por una red móvil lenta necesita barra de progreso y reintento individual: si
// todo viajara en el envío final, un fallo obligaría a repetir el formulario
// entero.
//
// Se usa XMLHttpRequest y no fetch porque fetch todavía no expone el progreso de
// subida de forma soportada en los navegadores de gama baja que este formulario
// tiene que atender.
//
// Toda foto pasa antes por `imagen.ts`: la original nunca sale del teléfono. Lo
// que se guarda en IndexedDB y lo que se sube es siempre la versión optimizada,
// así que la cola sin conexión ocupa megabytes y no decenas de ellos.

import { browser } from '$app/environment';
import { API_BASE, leerToken } from '$lib/api/client';
import { preinscripcionApi, rufeApi } from '$lib/api/servicios';
import type { Catalogos, EvidenciaLocal, TipoEvidencia } from './tipos';
import { uid } from './esquema';
import { borrarEvidencia, borrarEvidenciasDe, guardarEvidencia, leerEvidencias } from './almacen';
import { comprimirEvidencia, liberarVistaPrevia, tamanoLegible } from './imagen';

/**
 * A qué endpoints habla el gestor.
 *
 * Existe porque la pre-inscripción ciudadana sube fotos SIN sesión: mandar una
 * cabecera con un token vacío haría que el servidor respondiera 401 en vez de
 * servir la ruta pública.
 */
export type RutasCarga = {
	/** Abre una carga y devuelve su token. */
	abrir: () => Promise<{ carga: string }>;
	/** Base de los archivos de una carga, sin barra final. */
	archivos: (carga: string) => string;
	/** Si las peticiones llevan el token de la sesión. */
	autenticada: boolean;
};

/** Las del censo y la inspección, que comparten cargas. */
export const RUTAS_INTERNAS: RutasCarga = {
	abrir: () => rufeApi.abrirCarga(),
	archivos: (carga) => `${API_BASE}/rufe/cargas/${carga}/archivos`,
	autenticada: true
};

/** Las del formulario ciudadano, sin sesión. */
export const RUTAS_PUBLICAS_CARGA: RutasCarga = {
	abrir: () => preinscripcionApi.abrirCarga(),
	archivos: (carga) => `${API_BASE}/preinscripcion/cargas/${carga}/archivos`,
	autenticada: false
};

export class GestorEvidencias {
	archivos = $state<EvidenciaLocal[]>([]);
	carga = $state<string | null>(null);
	error = $state<string | null>(null);

	readonly total = $derived(this.archivos.reduce((s, a) => s + a.tamano, 0));
	readonly subiendo = $derived(this.archivos.some((a) => a.estado === 'subiendo'));
	readonly optimizando = $derived(this.archivos.some((a) => a.estado === 'optimizando'));
	readonly pendientes = $derived(
		this.archivos.filter((a) => a.estado === 'pendiente' || a.estado === 'error').length
	);
	/** Solo cuenta como fallo lo que no es culpa de la red: eso se reintenta solo. */
	readonly hayFallos = $derived(this.archivos.some((a) => a.estado === 'error' && !a.reintentable));

	#limites: Partial<Record<TipoEvidencia, number>>;
	#claveBorrador: string;
	#rutas: RutasCarga;
	#alVolverLaRed: (() => void) | null = null;

	/**
	 * @param limites cupo por clase de archivo. Recibe el mapa y no los catálogos
	 *   enteros porque este gestor sirve a tres formularios: el censo trae dos
	 *   clases con cupos distintos, la inspección una sola de diez, y la
	 *   pre-inscripción ciudadana dos con cupos propios.
	 * @param rutas a qué endpoints hablar. Por omisión, los del censo.
	 */
	constructor(
		limites: Partial<Record<TipoEvidencia, number>>,
		claveBorrador: string,
		rutas: RutasCarga = RUTAS_INTERNAS
	) {
		this.#limites = limites;
		this.#claveBorrador = claveBorrador;
		this.#rutas = rutas;
	}

	/** Los cupos del censo, tal como vienen en sus catálogos. */
	static paraRufe(catalogos: Catalogos, claveBorrador: string): GestorEvidencias {
		return new GestorEvidencias(
			{
				DOCUMENTO: catalogos.limites.evidencias_documento,
				DANO: catalogos.limites.evidencias_dano
			},
			claveBorrador
		);
	}

	/**
	 * Empieza a vigilar la conexión. Mientras el teléfono esté sin señal las fotos
	 * se quedan en la cola, y en cuanto vuelve se suben solas sin que el ciudadano
	 * tenga que pulsar nada.
	 */
	iniciar(): () => void {
		if (!browser) return () => {};

		this.#alVolverLaRed = () => void this.subirPendientes();
		window.addEventListener('online', this.#alVolverLaRed);

		return () => {
			if (this.#alVolverLaRed) window.removeEventListener('online', this.#alVolverLaRed);
			this.#alVolverLaRed = null;
		};
	}

	archivosDe(tipo: TipoEvidencia): EvidenciaLocal[] {
		return this.archivos.filter((a) => a.tipo === tipo);
	}

	limiteDe(tipo: TipoEvidencia): number {
		return this.#limites[tipo] ?? 0;
	}

	/** Repuebla la lista con las fotos que quedaron guardadas de una visita anterior. */
	async restaurar(): Promise<void> {
		if (!browser) return;

		const guardadas = await leerEvidencias(this.#claveBorrador);

		for (const g of guardadas) {
			const archivo = new File([g.blob], g.nombre, { type: g.tipo });

			const registro: EvidenciaLocal = $state({
				uid: g.uid,
				tipo: g.categoria,
				archivo,
				nombre: g.nombre,
				tamano: archivo.size,
				estado: g.optimizada ? 'pendiente' : 'optimizando',
				progreso: 0,
				metricas: (g.metricas as EvidenciaLocal['metricas']) ?? undefined,
				descripcion: g.descripcion,
				vistaPrevia: URL.createObjectURL(archivo)
			});

			this.archivos.push(registro);

			// Una foto guardada por una versión anterior del formulario viene sin
			// marcar: es el original de la cámara, y subirlo sería exactamente lo
			// que la optimización existe para impedir. Se comprime ahora.
			if (!g.optimizada) await this.#optimizarRegistro(registro, archivo);
		}

		// Las fotos recuperadas se vuelven a subir: la carga anterior pudo caducar
		// (vive dos horas) y el servidor ya no tendría esos archivos.
		if (this.archivos.length > 0) void this.subirPendientes();
	}

	/** Añade archivos elegidos, tomados con la cámara o soltados. */
	async agregar(lista: FileList | File[], tipo: TipoEvidencia): Promise<void> {
		this.error = null;

		const limite = this.limiteDe(tipo);

		for (const original of Array.from(lista)) {
			if (this.archivosDe(tipo).length >= limite) {
				this.error =
					tipo === 'DOCUMENTO'
						? 'Ya adjuntó la foto del documento. Quítela si desea cambiarla.'
						: `Solo puede adjuntar hasta ${limite} fotos.`;
				break;
			}

			// La tarjeta aparece de una vez, en estado «optimizando». Esperar a que
			// termine la compresión para mostrar algo haría creer que no pasó nada.
			const registro: EvidenciaLocal = $state({
				uid: uid(),
				tipo,
				archivo: original,
				nombre: original.name,
				tamano: original.size,
				estado: 'optimizando',
				progreso: 0
			});

			this.archivos.push(registro);

			if (!(await this.#optimizarRegistro(registro, original))) continue;

			// Se guarda ya optimizada: si el teléfono se queda sin señal o se cierra
			// el navegador, la foto sigue ahí y pesa lo que debe pesar.
			void guardarEvidencia({
				uid: registro.uid,
				claveBorrador: this.#claveBorrador,
				nombre: registro.nombre,
				tipo: registro.archivo.type,
				categoria: tipo,
				blob: registro.archivo,
				optimizada: true,
				metricas: registro.metricas,
				descripcion: registro.descripcion
			});
		}

		await this.subirPendientes();
	}

	/**
	 * Comprime una foto y deja el registro listo para subir.
	 *
	 * @returns false si no se pudo, con el registro ya marcado en error
	 */
	async #optimizarRegistro(registro: EvidenciaLocal, original: File): Promise<boolean> {
		registro.estado = 'optimizando';
		registro.progreso = 0;

		const resultado = await comprimirEvidencia(original, registro.tipo, (p) => {
			registro.progreso = p;
		});

		// El usuario pudo quitarla mientras se comprimía.
		if (!this.archivos.some((a) => a.uid === registro.uid)) {
			if (resultado.ok) liberarVistaPrevia(resultado.vistaPrevia);

			return false;
		}

		if (!resultado.ok) {
			registro.estado = 'error';
			registro.reintentable = false;
			registro.error = resultado.motivo;

			return false;
		}

		liberarVistaPrevia(registro.vistaPrevia);

		registro.archivo = resultado.archivo;
		registro.nombre = resultado.archivo.name;
		registro.tamano = resultado.archivo.size;
		registro.metricas = resultado.metricas;
		registro.vistaPrevia = resultado.vistaPrevia;
		registro.estado = 'pendiente';
		registro.progreso = 0;

		return true;
	}

	/**
	 * Cambia el «FOTOGRAFIA DE:» de una foto del numeral 11.
	 *
	 * El pie se escribe después de disparar, cuando la foto ya puede estar
	 * subida, así que se guarda en el teléfono y —si ya tiene identificador del
	 * servidor— se manda aparte. Que el envío del pie falle no rompe nada: la
	 * foto sigue en su sitio y el texto sigue guardado en el aparato, listo para
	 * volver a intentarlo al reenviar.
	 */
	async describir(uidArchivo: string, texto: string): Promise<void> {
		const archivo = this.archivos.find((a) => a.uid === uidArchivo);
		if (!archivo) return;

		archivo.descripcion = texto;

		void guardarEvidencia({
			uid: archivo.uid,
			claveBorrador: this.#claveBorrador,
			nombre: archivo.nombre,
			tipo: archivo.archivo.type,
			categoria: archivo.tipo,
			blob: archivo.archivo,
			optimizada: true,
			metricas: archivo.metricas,
			descripcion: texto
		});

		if (archivo.idServidor === undefined || !this.carga) return;

		try {
			await fetch(`${this.#rutas.archivos(this.carga)}/${archivo.idServidor}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', ...this.#cabeceras() },
				body: JSON.stringify({ descripcion: texto })
			});
		} catch {
			// Sin señal el pie se queda en el teléfono. Viaja igual: la cola lo
			// vuelve a mandar con la foto cuando le toque.
		}
	}

	async quitar(uidArchivo: string): Promise<void> {
		const i = this.archivos.findIndex((a) => a.uid === uidArchivo);
		if (i === -1) return;

		const archivo = this.archivos[i];

		// Sin revoke, cada foto quitada deja retenida su copia en memoria hasta que
		// se recargue la página.
		liberarVistaPrevia(archivo.vistaPrevia);

		this.archivos.splice(i, 1);
		void borrarEvidencia(uidArchivo);

		if (archivo.idServidor && this.carga) {
			try {
				await fetch(`${this.#rutas.archivos(this.carga)}/${archivo.idServidor}`, {
					method: 'DELETE',
					headers: this.#cabeceras()
				});
			} catch {
				// Si no se pudo borrar en el servidor, el archivo queda en la carga
				// y caducará solo en dos horas. No hay nada útil que decirle al
				// ciudadano aquí.
			}
		}
	}

	async reintentar(uidArchivo: string): Promise<void> {
		const archivo = this.archivos.find((a) => a.uid === uidArchivo);
		if (!archivo) return;

		archivo.estado = 'pendiente';
		archivo.error = undefined;
		archivo.reintentable = false;
		archivo.progreso = 0;
		await this.subirPendientes();
	}

	/** Sube de a uno: en una red móvil, varias subidas en paralelo se estorban. */
	async subirPendientes(): Promise<void> {
		if (browser && !navigator.onLine) return;

		// Los fallos de red vuelven a la cola solos; los de validación no, porque
		// reintentar un archivo que el servidor rechaza por su formato es inútil.
		for (const a of this.archivos) {
			if (a.estado === 'error' && a.reintentable) {
				a.estado = 'pendiente';
				a.error = undefined;
				a.reintentable = false;
			}
		}

		const pendientes = this.archivos.filter((a) => a.estado === 'pendiente');
		if (pendientes.length === 0) return;

		if (!this.carga) {
			try {
				this.carga = (await this.#rutas.abrir()).carga;
			} catch {
				for (const a of pendientes) {
					a.estado = 'error';
					a.reintentable = true;
					a.error = 'Sin conexión. Se subirá cuando vuelva la señal.';
				}

				return;
			}
		}

		for (const archivo of pendientes) {
			await this.#subir(archivo);
		}
	}

	/**
	 * Las fotos ya optimizadas, en la forma que espera la cola de envío.
	 *
	 * Se entregan para que viajen con la ficha: si el envío se difiere, es el
	 * Service Worker quien las sube, y solo puede verlas si están en su almacén.
	 */
	paraLaCola(): {
		uid: string;
		tipo: TipoEvidencia;
		nombre: string;
		mime: string;
		blob: Blob;
		subida: boolean;
		descripcion?: string;
	}[] {
		return this.archivos
			.filter((a) => a.estado !== 'optimizando' && a.estado !== 'error')
			.map((a) => ({
				uid: a.uid,
				tipo: a.tipo,
				nombre: a.nombre,
				mime: a.archivo.type,
				blob: a.archivo,
				descripcion: a.descripcion,
				// Si ya tiene identificador del servidor, esta foto YA está en la
				// carga. Marcarla como pendiente haría que se volviera a subir y la
				// ficha acabaría con la misma evidencia repetida — que es justo lo
				// que pasó con la ficha 9.
				subida: a.idServidor !== undefined
			}));
	}

	/** Descarta la carga entera. Se llama al enviar con éxito y al descartar el borrador. */
	async limpiar(): Promise<void> {
		for (const a of this.archivos) liberarVistaPrevia(a.vistaPrevia);
		this.archivos = [];
		this.carga = null;
		await borrarEvidenciasDe(this.#claveBorrador);
	}

	#cabeceras(): Record<string, string> {
		if (!this.#rutas.autenticada) return {};

		return { Authorization: `Bearer ${leerToken() ?? ''}` };
	}

	#subir(registro: EvidenciaLocal): Promise<void> {
		return new Promise((resolver) => {
			registro.estado = 'subiendo';
			registro.progreso = 0;

			const cuerpo = new FormData();
			cuerpo.append('tipo', registro.tipo);
			cuerpo.append('archivo', registro.archivo, registro.nombre);

			const xhr = new XMLHttpRequest();
			xhr.open('POST', this.#rutas.archivos(this.carga as string));
			xhr.setRequestHeader('Accept', 'application/json');

			// XMLHttpRequest no pasa por el cliente de la API, así que la cabecera
			// se pone a mano. Sin ella el servidor responde 401 y la foto nunca
			// sube. En el formulario ciudadano no hay token y no se manda ninguna.
			const token = this.#rutas.autenticada ? leerToken() : null;
			if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) registro.progreso = Math.round((e.loaded / e.total) * 100);
			};

			xhr.onload = () => {
				let respuesta: {
					ok?: boolean;
					data?: { archivo?: { id: number } };
					message?: string;
					errors?: Record<string, string>;
				};

				try {
					respuesta = JSON.parse(xhr.responseText);
				} catch {
					registro.estado = 'error';
					registro.reintentable = true;
					registro.error = 'El servidor respondió algo inesperado.';
					resolver();

					return;
				}

				if (xhr.status >= 200 && xhr.status < 300 && respuesta.ok !== false) {
					registro.estado = 'listo';
					registro.progreso = 100;
					registro.idServidor = respuesta.data?.archivo?.id;
				} else {
					registro.estado = 'error';
					// Un 5xx o un 429 se pueden reintentar solos; un 422 no, porque el
					// archivo seguirá sin ser válido por mucho que se reintente.
					registro.reintentable = xhr.status >= 500 || xhr.status === 429;
					registro.error =
						respuesta.errors?.archivo ?? respuesta.message ?? 'No se pudo subir el archivo.';
				}

				resolver();
			};

			xhr.onerror = () => {
				registro.estado = 'error';
				registro.reintentable = true;
				registro.error = 'Sin conexión. Se subirá cuando vuelva la señal.';
				resolver();
			};

			xhr.ontimeout = () => {
				registro.estado = 'error';
				registro.reintentable = true;
				registro.error = 'La carga tardó demasiado. Se reintentará.';
				resolver();
			};

			// Dos minutos: una foto de 8 MB por 3G lenta puede tardar bastante.
			xhr.timeout = 120000;
			xhr.send(cuerpo);
		});
	}
}

export { tamanoLegible };
