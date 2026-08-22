import { browser } from '$app/environment';
import { borrarSesionGuardada } from '$lib/stores/sesionCache';

/**
 * Cliente HTTP de la API.
 *
 * En producción la API se sirve bajo `/api` del MISMO dominio que la
 * aplicación. Eso elimina el CORS de raíz: no hay petición entre orígenes
 * distintos que el navegador tenga que autorizar, ni lista de dominios que
 * mantener cuando el sitio cambia de dirección.
 *
 * En desarrollo el frontend corre en el puerto 5173 y la API en el 8000, que
 * sí son orígenes distintos; ahí la URL es absoluta y el backend permite ese
 * origen por configuración.
 */
export const API_BASE = (() => {
	if (!browser) return '/api';
	const host = window.location.hostname;

	return host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:8000' : '/api';
})();

const CLAVE_TOKEN = 'sgr_token';

export function leerToken(): string | null {
	return browser ? window.localStorage.getItem(CLAVE_TOKEN) : null;
}

export function guardarToken(token: string): void {
	if (browser) window.localStorage.setItem(CLAVE_TOKEN, token);
}

export function borrarToken(): void {
	if (browser) window.localStorage.removeItem(CLAVE_TOKEN);

	// El espejo del usuario se va con el token, siempre. Separarlos dejaría al
	// sistema arrancando sin conexión con una identidad cuya credencial ya no
	// existe: el formulario se dibujaría y el envío fallaría después.
	borrarSesionGuardada();
}

/** Error de la API con el estado HTTP y los errores por campo. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly errors: Record<string, string> = {}
	) {
		super(message);
		this.name = 'ApiError';
	}
}

type Opciones = {
	method?: string;
	body?: unknown;
	/** Si es false, un 401 no cierra la sesión (se usa en el login). */
	autenticada?: boolean;
};

async function request<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
	const { method = 'GET', body, autenticada = true } = opciones;

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	const token = leerToken();
	if (autenticada && token) headers.Authorization = `Bearer ${token}`;

	let respuesta: Response;
	try {
		respuesta = await fetch(`${API_BASE}${ruta}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		// Un fallo de red no distingue "servidor caído" de "sin internet"; el
		// mensaje evita culpar al servidor cuando puede ser la conexión.
		throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión.', 0);
	}

	if (respuesta.status === 204) return undefined as T;

	let datos: { ok?: boolean; data?: T; message?: string; errors?: Record<string, string> };
	try {
		datos = await respuesta.json();
	} catch {
		throw new ApiError('El servidor devolvió una respuesta inesperada.', respuesta.status);
	}

	if (!respuesta.ok || datos.ok === false) {
		// El token dejó de valer (expiró, se cerró sesión en otro sitio o
		// desactivaron la cuenta): se descarta aquí para que la aplicación no
		// siga intentando con una credencial muerta.
		if (respuesta.status === 401 && autenticada) borrarToken();

		throw new ApiError(
			datos.message ?? 'Ocurrió un error inesperado.',
			respuesta.status,
			datos.errors ?? {}
		);
	}

	return datos.data as T;
}

export const api = {
	// `autenticada = false` para la pre-inscripción ciudadana, que la abre
	// alguien sin cuenta: mandar una cabecera con un token vacío haría que el
	// servidor respondiera 401 en vez de servir la ruta pública.
	get: <T>(ruta: string, autenticada = true) => request<T>(ruta, { autenticada }),
	post: <T>(ruta: string, body?: unknown, autenticada = true) =>
		request<T>(ruta, { method: 'POST', body, autenticada }),
	put: <T>(ruta: string, body?: unknown) => request<T>(ruta, { method: 'PUT', body }),
	/**
	 * Admite cuerpo: borrar una solicitud ciudadana exige mandar el motivo, y
	 * ponerlo en la URL lo dejaría escrito en el registro de accesos del
	 * servidor, que es justo donde no debe quedar el nombre de nadie.
	 */
	delete: <T>(ruta: string, body?: unknown) => request<T>(ruta, { method: 'DELETE', body })
};
