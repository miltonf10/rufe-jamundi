// Quién inició sesión la última vez, guardado en el teléfono.
//
// Existe por un escenario concreto: el censador abre la aplicación instalada en
// una vereda sin cobertura. El armazón está guardado y se pinta, pero
// `/auth/me` no responde, y hasta ahora eso se trataba igual que un token
// inválido: fuera al login, donde el único botón posible también necesita
// servidor. La aplicación quedaba cerrada con llave justo donde más falta hace.
//
// Lo que se guarda aquí NO da permisos. El backend valida el token en cada
// endpoint protegido y eso no cambia; sin señal no hay nada que leer más allá de
// la cola del propio teléfono. Lo único que se recupera es *quién dice ser*,
// para poder dibujar el formulario.

import type { UsuarioSesion } from '$lib/api/tipos';

const CLAVE = 'sgr_sesion';

/**
 * Tope de vida del espejo cuando el servidor no dijo cuándo vence.
 *
 * `/auth/login` sí devuelve `expira_en`, pero una sesión restaurada desde un
 * token viejo puede no tenerlo guardado. Doce horas es la duración por omisión
 * del backend (`auth.duracion_horas`): ante la duda, la más corta.
 */
const TOPE_MS = 12 * 60 * 60 * 1000;

type Guardada = { usuario: UsuarioSesion; vence: number };

const hayNavegador = () => typeof window !== 'undefined' && !!window.localStorage;

/**
 * Convierte el `expira_en` del servidor —`AAAA-MM-DD HH:MM:SS`, sin zona— en
 * milisegundos.
 *
 * Se interpreta en la hora local del teléfono porque servidor y censadores están
 * en la misma zona. Si el texto no se entiende, se devuelve `null` y quien llama
 * aplica el tope: es preferible una sesión offline más corta que una eterna
 * nacida de una fecha mal leída.
 */
export function momentoDeVencimiento(expiraEn: string | null | undefined): number | null {
	if (!expiraEn) return null;

	const ms = Date.parse(expiraEn.replace(' ', 'T'));

	return Number.isNaN(ms) ? null : ms;
}

/** Guarda el usuario y hasta cuándo vale, para poder arrancar sin señal. */
export function guardarSesion(
	usuario: UsuarioSesion,
	expiraEn: string | null = null,
	ahora = Date.now()
): void {
	if (!hayNavegador()) return;

	const delServidor = momentoDeVencimiento(expiraEn);

	// Nunca más allá del tope, aunque el servidor prometa más: si el reloj del
	// teléfono va atrasado, una fecha lejana dejaría entrar con una credencial
	// que el servidor ya rechaza, y el fallo aparecería al sincronizar, que es el
	// peor momento posible.
	const vence = Math.min(delServidor ?? ahora + TOPE_MS, ahora + TOPE_MS * 30);

	try {
		window.localStorage.setItem(CLAVE, JSON.stringify({ usuario, vence } satisfies Guardada));
	} catch {
		// Sin espacio o con almacenamiento bloqueado: se sigue sin espejo. Solo
		// significa que sin señal habrá que iniciar sesión con señal.
	}
}

/**
 * El usuario guardado, si todavía vale.
 *
 * Devuelve `null` en cuanto pasa su vencimiento: entrar con un token que el
 * servidor ya no acepta solo aplazaría el rechazo hasta el envío de las fichas.
 */
export function leerSesion(ahora = Date.now()): UsuarioSesion | null {
	if (!hayNavegador()) return null;

	const crudo = window.localStorage.getItem(CLAVE);
	if (!crudo) return null;

	let guardada: Guardada;

	try {
		guardada = JSON.parse(crudo);
	} catch {
		borrarSesionGuardada();

		return null;
	}

	if (!guardada?.usuario?.rol || typeof guardada.vence !== 'number') {
		borrarSesionGuardada();

		return null;
	}

	if (guardada.vence <= ahora) {
		borrarSesionGuardada();

		return null;
	}

	return guardada.usuario;
}

/** Cuándo vence la sesión guardada, para poder avisar antes de que ocurra. */
export function venceEn(): number | null {
	if (!hayNavegador()) return null;

	try {
		const guardada = JSON.parse(window.localStorage.getItem(CLAVE) ?? 'null') as Guardada | null;

		return typeof guardada?.vence === 'number' ? guardada.vence : null;
	} catch {
		return null;
	}
}

export function borrarSesionGuardada(): void {
	if (hayNavegador()) window.localStorage.removeItem(CLAVE);
}
