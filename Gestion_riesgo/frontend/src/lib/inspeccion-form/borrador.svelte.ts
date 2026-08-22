// Autoguardado de la inspección en curso.
//
// Una inspección se llena de pie en la puerta de una casa y lleva un rato: la
// tabla del 5.4 sola son siete elementos con su nivel. Perderla por una llamada
// entrante, una batería que se apaga o un toque en «atrás» significa repetir la
// visita, y esa visita cuesta un desplazamiento a una vereda.
//
// Es un módulo propio y no el del RUFE porque aquel está atado a la forma del
// formulario del censo. Comparten las decisiones —clave propia, caducidad,
// escritura con retardo— pero no el código: forzar un genérico sobre el del
// RUFE tocaría un archivo que hoy funciona y que guarda datos de hogares.

import { browser } from '$app/environment';
import type { FormularioInspeccion } from './tipos';
import type { IdPaso } from './esquema';

export const CLAVE_ALMACEN = 'sgr_inspeccion_borrador_v1';

const VERSION = 1;
const DIAS_VIGENCIA = 7;
const RETARDO_MS = 800;

export type EstadoGuardado = 'sin-cambios' | 'guardando' | 'guardado' | 'error' | 'recuperado';

export type BorradorGuardado = {
	version: number;
	clave: string;
	actualizado_en: number;
	expira_en: number;
	paso: IdPaso;
	datos: FormularioInspeccion;
};

export function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function leerBorrador(ahora = Date.now()): BorradorGuardado | null {
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

		// Una versión anterior del formato tendría campos que ya no existen;
		// recuperarla dejaría la pantalla a medio pintar sin decir por qué.
		if (b.version !== VERSION || typeof b.clave !== 'string') return null;

		// Caducado: una inspección de hace más de una semana no se retoma, se
		// vuelve a hacer. Los daños de una vivienda cambian.
		if (typeof b.expira_en !== 'number' || b.expira_en <= ahora) {
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
		/* si no se puede borrar, caducará solo */
	}
}

export class GestorBorrador {
	estado = $state<EstadoGuardado>('sin-cambios');
	clave = $state<string>('');
	guardadoEn = $state<number | null>(null);

	#temporizador: ReturnType<typeof setTimeout> | null = null;

	constructor(clave?: string) {
		this.clave = clave ?? uid();
	}

	marcarRecuperado(cuando: number): void {
		this.estado = 'recuperado';
		this.guardadoEn = cuando;
	}

	/**
	 * Programa el guardado.
	 *
	 * Con retardo y no en cada tecla: escribir en localStorage es síncrono y
	 * hacerlo en cada pulsación se nota en un teléfono de gama baja justo cuando
	 * alguien está escribiendo una dirección larga.
	 */
	programar(datos: FormularioInspeccion, paso: IdPaso): void {
		if (!browser) return;

		this.estado = 'guardando';

		if (this.#temporizador) clearTimeout(this.#temporizador);
		this.#temporizador = setTimeout(() => this.guardar(datos, paso), RETARDO_MS);
	}

	guardar(datos: FormularioInspeccion, paso: IdPaso): void {
		if (!browser) return;

		const ahora = Date.now();

		try {
			window.localStorage.setItem(
				CLAVE_ALMACEN,
				JSON.stringify({
					version: VERSION,
					clave: this.clave,
					actualizado_en: ahora,
					expira_en: ahora + DIAS_VIGENCIA * 86400_000,
					paso,
					datos: $state.snapshot(datos)
				} satisfies BorradorGuardado)
			);

			this.estado = 'guardado';
			this.guardadoEn = ahora;
		} catch {
			// Sin espacio o con almacenamiento bloqueado. Se avisa en pantalla: es
			// la diferencia entre saber que hay que terminar de una sentada y
			// creerse a salvo.
			this.estado = 'error';
		}
	}

	detener(): void {
		if (this.#temporizador) clearTimeout(this.#temporizador);
		this.#temporizador = null;
	}
}

export function describirEstado(estado: EstadoGuardado, guardadoEn: number | null): string {
	switch (estado) {
		case 'guardando':
			return 'Guardando…';
		case 'guardado':
			return guardadoEn
				? `Guardado a las ${new Date(guardadoEn).toLocaleTimeString('es-CO', {
						hour: '2-digit',
						minute: '2-digit'
					})}`
				: 'Guardado';
		case 'recuperado':
			return 'Se recuperó una inspección sin terminar.';
		case 'error':
			return 'No se pudo guardar en este dispositivo. Termine sin cerrar la aplicación.';
		default:
			return '';
	}
}
