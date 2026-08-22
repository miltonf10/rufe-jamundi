// Validación del formato de inspección en el navegador.
//
// Es un espejo de `backend/src/Inspeccion/Validador.php`, no un sustituto:
// sirve para que el profesional vea el error junto al campo sin esperar una
// petición que en una vereda puede no llegar. La decisión de aceptar la
// inspección la toma siempre el servidor, y si las dos versiones difirieran,
// manda la de PHP.
//
// Las claves de error usan la misma ruta con puntos que el backend
// (`danos.MUROS_CARGA.nivel`), para que la respuesta del servidor se pinte
// exactamente donde pinta esta.

import type { Catalogos, FormularioInspeccion } from './tipos';
import type { IdPaso } from './esquema';
import {
	cumpleRequisitos,
	elementosDe,
	EVENTO_OTRO,
	muestraProfesionOtra,
	pasosVigentes,
	PROFESION_OTRA
} from './esquema';

export type Errores = Record<string, string>;

/** Fecha de hoy según el reloj del teléfono, no en UTC. */
export function hoy(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');

	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function haceAnos(n: number): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() - n);
	const p = (x: number) => String(x).padStart(2, '0');

	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fechaExiste(iso: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return false;

	const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const d = new Date(a, mes - 1, dia);

	return d.getFullYear() === a && d.getMonth() === mes - 1 && d.getDate() === dia;
}

export function soloDigitos(valor: string): string {
	return valor.replace(/\D+/g, '');
}

export function documentoValido(valor: string): boolean {
	const d = soloDigitos(valor);

	return d.length >= 5 && d.length <= 15;
}

export function telefonoValido(valor: string): boolean {
	const d = soloDigitos(valor);

	return d.length >= 7 && d.length <= 15;
}

/** Los errores de un solo paso: lo que se comprueba al pulsar «Siguiente». */
export function validarPaso(paso: IdPaso, d: FormularioInspeccion, c: Catalogos): Errores {
	const todos = validarTodo(d, c);
	const delPaso: Errores = {};
	const campos = new Set(
		pasosVigentes(d, c)
			.filter((p) => p.id === paso)
			.flatMap((p) => p.campos as string[])
	);

	for (const [clave, mensaje] of Object.entries(todos)) {
		// `danos.MUROS_CARGA.nivel` pertenece al campo `danos`.
		if (campos.has(clave.split('.')[0])) delPaso[clave] = mensaje;
	}

	return delPaso;
}

export function validarTodo(d: FormularioInspeccion, c: Catalogos): Errores {
	const e: Errores = {};

	general(d, c, e);
	localizacion(d, c, e);

	const cumple = cumpleRequisitos(d, c);
	requisitos(d, c, e);

	if (cumple === true) {
		inspeccion(d, c, e);
	} else if (cumple === false) {
		acta(d, e);
	}


	return e;
}

// ── Secciones ────────────────────────────────────────────────────────────────

function general(d: FormularioInspeccion, c: Catalogos, e: Errores): void {
	if (!fechaExiste(d.fecha_evaluacion)) {
		e.fecha_evaluacion = 'Indique la fecha de la evaluación.';
	} else if (d.fecha_evaluacion > hoy()) {
		e.fecha_evaluacion = 'La fecha de la evaluación no puede ser posterior a hoy.';
	} else if (d.fecha_evaluacion < haceAnos(c.limites.anos_atras)) {
		e.fecha_evaluacion = 'La fecha es demasiado antigua. Verifíquela.';
	}

	exigir(d.profesional_nombre, 'profesional_nombre', 'Escriba el nombre del profesional responsable.', e);
	exigir(d.profesional_tarjeta, 'profesional_tarjeta', 'Indique la tarjeta profesional.', e);
	if (d.profesional_profesion === '') {
		e.profesional_profesion = 'Indique la profesión.';
	} else if (!c.profesiones.some((o) => o.codigo === d.profesional_profesion)) {
		e.profesional_profesion = 'Seleccione una profesión de la lista.';
	} else if (muestraProfesionOtra(d)) {
		const t = d.profesional_profesion_otra.trim();
		if (t.length < 3 || t.length > 120) {
			e.profesional_profesion_otra = 'Escriba la profesión, entre 3 y 120 caracteres.';
		}
	}

	if (!documentoValido(d.profesional_documento)) {
		e.profesional_documento = 'Indique la cédula del profesional.';
	}

	if (!telefonoValido(d.profesional_telefono)) {
		e.profesional_telefono = 'Indique un teléfono de contacto.';
	}

	exigir(d.propietario_nombres, 'propietario_nombres', 'Escriba los nombres y apellidos del propietario.', e);

	if (!documentoValido(d.propietario_documento)) {
		e.propietario_documento = 'Indique la cédula del propietario.';
	}

	if (d.propietario_telefono.trim() !== '' && !telefonoValido(d.propietario_telefono)) {
		e.propietario_telefono = 'Revise el teléfono: debe tener entre 7 y 15 dígitos.';
	}
}

function localizacion(d: FormularioInspeccion, c: Catalogos, e: Errores): void {
	// Una vivienda urbana se ubica por dirección y una rural por vereda y
	// corregimiento. Exigir las tres dejaría fuera media zona rural; no exigir
	// ninguna dejaría una inspección a la que nadie puede volver.
	if (
		d.direccion_cabecera.trim() === '' &&
		d.corregimiento.trim() === '' &&
		d.vereda.trim() === ''
	) {
		e.direccion_cabecera = 'Indique al menos la dirección, el corregimiento o la vereda.';
	}

	if (d.corregimiento !== '' && !c.corregimientos.includes(d.corregimiento)) {
		e.corregimiento = 'Seleccione un corregimiento de la lista.';
	}
}

function requisitos(d: FormularioInspeccion, c: Catalogos, e: Errores): void {
	for (const r of c.requisitos) {
		if (typeof d.requisitos[r.codigo] !== 'boolean') {
			e[`requisitos.${r.codigo}`] = 'Conteste sí o no.';
		}
	}
}

function inspeccion(d: FormularioInspeccion, c: Catalogos, e: Errores): void {
	if (d.evento === '') {
		e.evento = 'Indique qué evento afectó la vivienda.';
	} else if (!c.eventos.some((o) => o.codigo === d.evento)) {
		e.evento = 'Seleccione uno de los eventos del formato.';
	} else if (d.evento === EVENTO_OTRO) {
		const t = d.evento_otro.trim();
		if (t.length < 3 || t.length > 120) {
			e.evento_otro = 'Describa el evento en un mínimo de 3 y un máximo de 120 caracteres.';
		}
	}

	if (d.sistema_constructivo === '') {
		e.sistema_constructivo = 'Indique si la vivienda es en mampostería o en madera.';

		return;
	}

	for (const categoria of Object.keys(c.convenciones)) {
		const letra = d.infraestructura[categoria] ?? '';

		if (letra === '') {
			e[`infraestructura.${categoria}`] = 'Indique el material encontrado.';
		} else if (!(letra in c.convenciones[categoria].opciones)) {
			e[`infraestructura.${categoria}`] = 'Use una de las convenciones del formato.';
		}
	}

	if (typeof d.requiere_evacuacion !== 'boolean') {
		e.requiere_evacuacion = 'Indique si la vivienda requiere evacuación.';
	}

	// Con colapso total la tabla por elementos no se llena: «marque solo esta
	// casilla».
	if (!d.colapso_total) {
		for (const elemento of elementosDe(d, c)) {
			const fila = d.danos[elemento.codigo];

			if (typeof fila?.afectado !== 'boolean') {
				e[`danos.${elemento.codigo}.afectado`] = 'Indique si este elemento resultó afectado.';

				continue;
			}

			if (!fila.afectado) continue;

			if (!fila.nivel) {
				e[`danos.${elemento.codigo}.nivel`] = 'Elija el nivel de daño.';
			} else if (!elemento.niveles.some((n) => n.codigo === fila.nivel)) {
				// Cierra el círculo del Anexo 1: la pantalla no ofrece ese nivel, y
				// si quedó de un cambio de sistema, tampoco pasa.
				e[`danos.${elemento.codigo}.nivel`] = 'El Anexo 1 no define ese nivel para este elemento.';
			}
		}
	}

	if (d.kit_cubierta !== '' && !(d.kit_cubierta in (c.kits_cubierta[d.sistema_constructivo] ?? {}))) {
		e.kit_cubierta = 'Ese kit de cubierta no aplica a este sistema constructivo.';
	}

	exigir(d.informante_nombre, 'informante_nombre', 'Escriba el nombre de quien atendió la visita.', e);

	if (!documentoValido(d.informante_documento)) {
		e.informante_documento = 'Indique la cédula de quien atendió la visita.';
	}

	if (d.informante_parentesco === null) {
		e.informante_parentesco = 'Indique el parentesco con el propietario.';
	}

	if (d.informante_telefono.trim() !== '' && !telefonoValido(d.informante_telefono)) {
		e.informante_telefono = 'Revise el teléfono: debe tener entre 7 y 15 dígitos.';
	}
}

function acta(d: FormularioInspeccion, e: Errores): void {
	if (d.acta_modalidad === '') {
		e.acta_modalidad = 'Indique si el apoyo era para rehabilitación o para construcción.';
	}

	exigir(d.acta_nombre, 'acta_nombre', 'Escriba el nombre de quien queda enterado.', e);

	if (!documentoValido(d.acta_documento)) {
		e.acta_documento = 'Indique la cédula de quien queda enterado.';
	}

	if (d.acta_telefono.trim() !== '' && !telefonoValido(d.acta_telefono)) {
		e.acta_telefono = 'Revise el teléfono: debe tener entre 7 y 15 dígitos.';
	}
}

function exigir(valor: string, clave: string, mensaje: string, e: Errores): void {
	if (valor.trim().length < 3) e[clave] = mensaje;
}

/**
 * A qué paso pertenece un error, para poder llevar allí a quien lo cometió.
 *
 * Sin esto, un error del servidor en un campo del paso 3 se mostraría sin que
 * nadie encuentre dónde corregirlo.
 */
export function pasoDelError(clave: string, d: FormularioInspeccion, c: Catalogos): IdPaso {
	const raiz = clave.split('.')[0];

	for (const paso of pasosVigentes(d, c)) {
		if ((paso.campos as string[]).includes(raiz)) return paso.id;
	}

	return 'revision';
}
