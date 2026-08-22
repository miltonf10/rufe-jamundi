// Autoguardado del formulario RUFE en el dispositivo del ciudadano.
//
// El borrador NO va al servidor. Guardar nombres, documentos y pertenencia
// étnica de terceros antes de que el ciudadano acepte el aviso de tratamiento
// sería recolectar datos sensibles sin base legal, así que el reporte solo
// existe en este navegador hasta que se pulsa Enviar.
//
// Las casillas de autorización se excluyen a propósito de lo que se guarda: el
// consentimiento debe darse en la sesión del envío, no heredarse de un borrador
// de hace tres días.

import { browser } from '$app/environment';
import type { FormularioRufe } from './tipos';
import type { IdPaso } from './esquema';
import { uid } from './esquema';

export const CLAVE_ALMACEN = 'sgr_rufe_borrador_v1';

const VERSION = 1;
const DIAS_VIGENCIA = 7;
const DEBOUNCE_MS = 800;

export type EstadoGuardado =
	| 'sin-cambios'
	| 'guardando'
	| 'guardado'
	| 'error'
	| 'recuperado';

export type BorradorGuardado = {
	version: number;
	clave: string;
	actualizado_en: number;
	expira_en: number;
	paso: IdPaso;
	datos: FormularioRufe;
};

/** Campos que nunca se persisten. */
const NO_PERSISTIR = ['autoriza_tratamiento'] as const;

function limpiarParaGuardar(d: FormularioRufe): FormularioRufe {
	const copia = structuredClone($state.snapshot(d)) as FormularioRufe;
	for (const campo of NO_PERSISTIR) copia[campo] = false;

	return copia;
}

export function leerBorrador(): BorradorGuardado | null {
	if (!browser) return null;

	let crudo: string | null;
	try {
		crudo = window.localStorage.getItem(CLAVE_ALMACEN);
	} catch {
		return null;
	}
	if (!crudo) return null;

	try {
		const b = JSON.parse(crudo) as BorradorGuardado;

		// Una versión distinta significa que el esquema cambió: el borrador podría
		// tener campos que ya no existen o faltarle otros. Se descarta en vez de
		// intentar migrarlo.
		if (b.version !== VERSION || !b.datos) {
			descartarBorrador();

			return null;
		}

		if (Date.now() > b.expira_en) {
			descartarBorrador();

			return null;
		}

		return b;
	} catch {
		descartarBorrador();

		return null;
	}
}

export function descartarBorrador(): void {
	if (!browser) return;
	try {
		window.localStorage.removeItem(CLAVE_ALMACEN);
	} catch {
		/* almacenamiento bloqueado: no hay nada que borrar */
	}
}

/**
 * Gestor del autoguardado. Se instancia uno por formulario.
 *
 * Es una clase y no un singleton de módulo porque el temporizador y los oyentes
 * deben poder desmontarse con la página; un singleton dejaría el `debounce`
 * corriendo tras salir del formulario.
 */
export class GestorBorrador {
	estado = $state<EstadoGuardado>('sin-cambios');
	clave = $state<string>('');
	guardadoEn = $state<number | null>(null);

	/**
	 * Otra pestaña está editando el mismo borrador. Se pasa a solo lectura en vez
	 * de fusionar: dos versiones del mismo hogar no se pueden combinar sin
	 * inventarse cuál gana, y el ciudadano no debería tener que decidirlo.
	 */
	otraPestana = $state(false);

	#temporizador: ReturnType<typeof setTimeout> | null = null;
	#alCambiarAlmacen: ((e: StorageEvent) => void) | null = null;

	constructor(clave?: string) {
		this.clave = clave ?? uid();
	}

	/** Empieza a vigilar cambios de otras pestañas. Devuelve la función de limpieza. */
	iniciar(): () => void {
		if (!browser) return () => {};

		this.#alCambiarAlmacen = (e: StorageEvent) => {
			if (e.key !== CLAVE_ALMACEN || !e.newValue) return;

			try {
				const otro = JSON.parse(e.newValue) as BorradorGuardado;
				if (otro.clave !== this.clave) return;
				if (this.guardadoEn !== null && otro.actualizado_en > this.guardadoEn + 50) {
					this.otraPestana = true;
				}
			} catch {
				/* un borrador ilegible de otra pestaña no es asunto de esta */
			}
		};

		window.addEventListener('storage', this.#alCambiarAlmacen);

		return () => this.detener();
	}

	detener(): void {
		if (this.#temporizador) clearTimeout(this.#temporizador);
		this.#temporizador = null;

		if (browser && this.#alCambiarAlmacen) {
			window.removeEventListener('storage', this.#alCambiarAlmacen);
			this.#alCambiarAlmacen = null;
		}
	}

	/** Agenda un guardado. Llamar en cada cambio: el debounce evita escribir de más. */
	programar(datos: FormularioRufe, paso: IdPaso): void {
		if (!browser || this.otraPestana) return;

		this.estado = 'guardando';
		if (this.#temporizador) clearTimeout(this.#temporizador);
		this.#temporizador = setTimeout(() => this.guardarYa(datos, paso), DEBOUNCE_MS);
	}

	/** Guardado inmediato. Se usa al cambiar de paso y antes de cerrar la pestaña. */
	guardarYa(datos: FormularioRufe, paso: IdPaso): void {
		if (!browser || this.otraPestana) return;

		if (this.#temporizador) {
			clearTimeout(this.#temporizador);
			this.#temporizador = null;
		}

		const ahora = Date.now();
		const carga: BorradorGuardado = {
			version: VERSION,
			clave: this.clave,
			actualizado_en: ahora,
			expira_en: ahora + DIAS_VIGENCIA * 86400000,
			paso,
			datos: limpiarParaGuardar(datos)
		};

		try {
			window.localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(carga));
			this.guardadoEn = ahora;
			this.estado = 'guardado';
		} catch {
			// Cuota llena o almacenamiento bloqueado. Se avisa, pero el formulario
			// sigue usable: los datos están en memoria mientras no se recargue.
			this.estado = 'error';
		}
	}

	descartar(): void {
		if (this.#temporizador) clearTimeout(this.#temporizador);
		this.#temporizador = null;
		descartarBorrador();
		this.clave = uid();
		this.guardadoEn = null;
		this.otraPestana = false;
		this.estado = 'sin-cambios';
	}

	marcarRecuperado(cuando: number): void {
		this.guardadoEn = cuando;
		this.estado = 'recuperado';
	}
}

export function describirEstado(estado: EstadoGuardado, guardadoEn: number | null): string {
	switch (estado) {
		case 'guardando':
			return 'Guardando…';
		case 'guardado':
			return guardadoEn ? `Guardado en este dispositivo · ${hora(guardadoEn)}` : 'Guardado en este dispositivo';
		case 'error':
			return 'No se pudo guardar en este dispositivo';
		case 'recuperado':
			return 'Reporte recuperado';
		default:
			return 'Sin cambios por guardar';
	}
}

function hora(ms: number): string {
	return new Date(ms).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
