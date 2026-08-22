import { ApiError, api, borrarToken, guardarToken, leerToken } from '$lib/api/client';
import { espejarToken } from '$lib/rufe-form/cola';
import { borrarSesionGuardada, guardarSesion, leerSesion, venceEn } from '$lib/stores/sesionCache';
import type { UsuarioSesion } from '$lib/api/tipos';
import type { Rol } from '$lib/navigation';

/**
 * Estado de sesión compartido por toda la aplicación.
 *
 * Se usa una clase con runes en vez de un store de Svelte 4 porque el resto del
 * proyecto ya está en modo runes; mezclar los dos modelos obliga a recordar cuál
 * necesita `$` y cuál no.
 */
class Sesion {
	usuario = $state<UsuarioSesion | null>(null);
	/** true mientras se comprueba el token guardado al abrir la aplicación. */
	cargando = $state(true);

	/**
	 * ¿El servidor confirmó esta sesión en este arranque?
	 *
	 * `false` significa que se está trabajando con el usuario guardado en el
	 * teléfono porque no hubo forma de preguntar. La aplicación deja levantar
	 * fichas, que es trabajo local, pero no abre las secciones que leen datos del
	 * servidor: sin él no tendrían nada que mostrar.
	 */
	verificada = $state(false);

	/** Se pudo entrar, pero sin conexión. Lo usa la franja de aviso. */
	sinConexion = $state(false);

	get autenticado(): boolean {
		return this.usuario !== null;
	}

	/** Cuándo deja de valer la sesión guardada, para avisar antes de que ocurra. */
	get venceEn(): number | null {
		return venceEn();
	}

	get rol(): Rol | null {
		return this.usuario?.rol ?? null;
	}

	puede(capacidad: string): boolean {
		return this.usuario?.capacidades.includes(capacidad) ?? false;
	}

	/**
	 * Recupera la sesión desde el token guardado. Se llama una vez al arrancar:
	 * el token vive en localStorage, pero quién es y qué puede hacer lo decide
	 * siempre el servidor, nunca el navegador.
	 */
	async restaurar(): Promise<void> {
		this.cargando = true;

		const token = leerToken();

		// El token vive en localStorage, que el Service Worker no puede leer. Se
		// espeja en IndexedDB en cada arranque para que el envío en segundo plano
		// pueda autenticarse con la aplicación cerrada.
		void espejarToken(token);

		if (!token) {
			this.usuario = null;
			this.verificada = false;
			this.sinConexion = false;
			borrarSesionGuardada();
			this.cargando = false;

			return;
		}

		try {
			const { usuario } = await api.get<{ usuario: UsuarioSesion }>('/auth/me');

			this.usuario = usuario;
			this.verificada = true;
			this.sinConexion = false;

			// Se refresca el espejo en cada arranque con señal: si a alguien le
			// cambian el rol, la próxima salida a campo ya sale con el rol nuevo.
			guardarSesion(usuario);
		} catch (e) {
			// Aquí se separan dos cosas que antes iban en el mismo saco, y esa
			// confusión es la que dejaba al censador encerrado en el login:
			//
			//   • El servidor respondió que no (401/403) — la credencial murió. Se
			//     cierra la sesión; el cliente ya borró el token en el 401.
			//   • No se pudo preguntar (sin señal, o el servidor caído) — no hay
			//     ninguna razón para expulsar a nadie. Se sigue con el usuario
			//     guardado, marcado como no verificado.
			const rechazada = e instanceof ApiError && (e.status === 401 || e.status === 403);
			const guardado = rechazada ? null : leerSesion();

			this.usuario = guardado;
			this.verificada = false;
			this.sinConexion = guardado !== null;

			if (rechazada) borrarSesionGuardada();
		} finally {
			this.cargando = false;
		}
	}

	async iniciar(email: string, password: string): Promise<void> {
		const datos = await api.post<{ token: string; usuario: UsuarioSesion; expira_en?: string }>(
			'/auth/login',
			{ email, password },
			false
		);

		guardarToken(datos.token);
		void espejarToken(datos.token);

		// El espejo se guarda con la fecha de vencimiento real del servidor: es lo
		// que permite arrancar sin señal y, a la vez, no dejar entrar con una
		// credencial que el servidor ya rechazaría.
		guardarSesion(datos.usuario, datos.expira_en ?? null);

		this.usuario = datos.usuario;
		this.verificada = true;
		this.sinConexion = false;
	}

	async cerrar(): Promise<void> {
		try {
			await api.post('/auth/logout');
		} catch {
			// Si el servidor no responde, la sesión se cierra igual en el
			// navegador: dejar al usuario dentro sería peor.
		} finally {
			borrarToken();

			// El espejo se borra también: dejarlo permitiría que el Service Worker
			// siguiera enviando con una sesión que la persona ya cerró.
			void espejarToken(null);
			borrarSesionGuardada();
			this.usuario = null;
			this.verificada = false;
			this.sinConexion = false;
		}
	}
}

export const sesion = new Sesion();
