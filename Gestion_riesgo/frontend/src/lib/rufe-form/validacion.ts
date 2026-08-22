// Validación del formulario RUFE en el navegador.
//
// Es un espejo de `backend/src/Rufe/Validador.php`, no un sustituto: sirve para
// que el ciudadano vea el error junto al campo sin esperar una petición, pero la
// decisión de aceptar o no un reporte la toma siempre el servidor. Si las dos
// versiones llegaran a diferir, la que manda es la de PHP.
//
// Las claves de error usan la misma ruta con puntos que el backend
// (`personas.2.numero_documento`), para que la respuesta del servidor se pueda
// pintar exactamente donde pinta esta.

import type { Catalogos, FormularioRufe, Persona, RenglonAgro } from './tipos';
import type { IdPaso } from './esquema';
import {
	muestraAgropecuario,
	muestraCorregimiento,
	muestraDireccionAlojamiento,
	muestraDocumentoOtro,
	muestraEventoOtro,
	muestraNumeroDocumento,
	ES_OTRO_EVENTO
} from './esquema';

export type Errores = Record<string, string>;

const RE_NOMBRE = /^[\p{L}\p{M}\s'.-]+$/u;

/**
 * Fecha en formato Y-m-d según el reloj del dispositivo, no en UTC.
 *
 * toISOString() convierte a UTC, y Colombia va cinco horas por detrás: a partir
 * de las 19:00 hora local el día UTC ya es el siguiente. Con toISOString, el
 * validador daba por buena una fecha de mañana cada noche, y la ventana de dos
 * años se corría un día. La fecha que importa aquí es la que ve el ciudadano en
 * su teléfono, que es la local.
 */
export function aISO(d: Date): string {
	const mes = String(d.getMonth() + 1).padStart(2, '0');
	const dia = String(d.getDate()).padStart(2, '0');

	return `${d.getFullYear()}-${mes}-${dia}`;
}

export function hoy(): string {
	return aISO(new Date());
}

export function haceAnos(n: number): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() - n);

	return aISO(d);
}

/** Igual que checkdate en PHP: descarta 31 de febrero, que Date() correría a marzo. */
export function fechaExiste(iso: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return false;

	const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const d = new Date(Date.UTC(ano, mes - 1, dia));

	return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export function soloDigitos(valor: string): string {
	return valor.replace(/\D+/g, '');
}

export function telefonoValido(valor: string): boolean {
	const d = soloDigitos(valor);

	return d.length >= 7 && d.length <= 15;
}

export function correoValido(valor: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor) && valor.length <= 180;
}

// ── Por paso ─────────────────────────────────────────────────────────────────

export function validarPaso(paso: IdPaso, d: FormularioRufe, c: Catalogos): Errores {
	switch (paso) {
		case 'evento':
			return validarEvento(d, c);
		case 'ubicacion':
			return validarUbicacion(d);
		case 'inmueble':
			return validarInmueble(d);
		case 'alojamiento':
			return validarAlojamiento(d);
		case 'personas':
			return validarPersonas(d, c);
		case 'agropecuario':
			return validarAgropecuario(d, c);
		case 'evidencias':
			return validarContacto(d);
		case 'revision':
			return validarAutorizaciones(d);
		default:
			return {};
	}
}

/** Todo el formulario, en el orden de los pasos. */
export function validarTodo(d: FormularioRufe, c: Catalogos): Errores {
	return {
		...validarEvento(d, c),
		...validarUbicacion(d),
		...validarInmueble(d),
		...validarAlojamiento(d),
		...validarPersonas(d, c),
		...validarAgropecuario(d, c),
		...validarContacto(d),
		...validarAutorizaciones(d)
	};
}

// ── Secciones ────────────────────────────────────────────────────────────────

function validarEvento(d: FormularioRufe, c: Catalogos): Errores {
	const e: Errores = {};

	if (!d.evento) {
		e.evento = 'Indique qué ocurrió.';
	} else if (d.evento !== ES_OTRO_EVENTO && !c.eventos_sugeridos.includes(d.evento)) {
		e.evento = 'Seleccione uno de los eventos de la lista.';
	}

	// C1
	if (muestraEventoOtro(d)) {
		const t = d.evento_otro.trim();
		if (t.length < 3 || t.length > 120) {
			e.evento_otro = 'Describa el evento en un mínimo de 3 y un máximo de 120 caracteres.';
		}
	}

	if (!d.fecha_evento) {
		e.fecha_evento = 'Indique la fecha en que ocurrió el evento.';
	} else if (!fechaExiste(d.fecha_evento)) {
		e.fecha_evento = 'Esa fecha no existe. Revísela.';
	} else if (d.fecha_evento > hoy()) {
		e.fecha_evento = 'La fecha del evento no puede ser posterior a hoy.';
	} else if (d.fecha_evento < haceAnos(c.limites.anos_atras_evento)) {
		e.fecha_evento = `Solo se registran eventos ocurridos en los últimos ${c.limites.anos_atras_evento} años. Si es más antiguo, acérquese a la Secretaría.`;
	}

	return e;
}

function validarUbicacion(d: FormularioRufe): Errores {
	const e: Errores = {};

	if (!d.zona) e.zona = 'Indique si el inmueble está en zona urbana o rural.';

	// C2
	if (muestraCorregimiento(d)) {
		const t = d.corregimiento.trim();
		if (t.length < 3 || t.length > 120) {
			e.corregimiento = 'Indique el corregimiento donde está el inmueble.';
		}
	}

	const lugar = d.vereda_sector_barrio.trim();
	if (lugar.length < 3 || lugar.length > 160) {
		e.vereda_sector_barrio = d.zona === 'RURAL' ? 'Indique la vereda o sector.' : 'Indique el barrio.';
	}

	const dir = d.direccion.trim();
	if (dir.length < 5 || dir.length > 200) {
		e.direccion = 'Escriba la dirección del inmueble, con un mínimo de 5 caracteres.';
	}

	return e;
}

function validarInmueble(d: FormularioRufe): Errores {
	const e: Errores = {};

	if (!d.tipo_bien) e.tipo_bien = 'Indique qué tipo de inmueble es.';
	if (!d.forma_tenencia) e.forma_tenencia = 'Indique qué relación tiene con el inmueble.';
	if (!d.estado_bien) e.estado_bien = 'Indique cómo quedó el inmueble.';

	return e;
}

function validarAlojamiento(d: FormularioRufe): Errores {
	const e: Errores = {};

	if (!d.alojamiento) {
		e.alojamiento = 'Indique dónde se está alojando actualmente.';
	}

	// C4
	if (muestraDireccionAlojamiento(d)) {
		const t = d.alojamiento_direccion.trim();
		if (t.length < 5 || t.length > 200) {
			e.alojamiento_direccion = 'Indique dónde se está alojando ahora.';
		}
	}

	return e;
}

function validarPersonas(d: FormularioRufe, c: Catalogos): Errores {
	const e: Errores = {};

	if (d.personas.length === 0) {
		e.personas = 'Registre al menos a una persona del hogar.';

		return e;
	}

	if (d.personas.length > c.limites.personas) {
		e.personas = `El formato oficial admite hasta ${c.limites.personas} personas. Si su hogar es más numeroso, comuníquese con la Secretaría de Gestión del Riesgo.`;

		return e;
	}

	const documentosVistos = new Set<string>();
	let jefes = 0;

	d.personas.forEach((p, i) => {
		Object.assign(e, validarPersona(p, i, c));

		if (p.parentesco === c.parentesco_jefe) jefes++;

		const numero = p.numero_documento.trim().toUpperCase();
		if (numero && p.tipo_documento !== null) {
			const llave = `${p.tipo_documento}:${numero}`;
			if (documentosVistos.has(llave)) {
				e[`personas.${i}.numero_documento`] =
					'Este documento ya fue registrado en otra persona del hogar.';
			}
			documentosVistos.add(llave);
		}
	});

	if (jefes === 0) {
		e.personas = 'Señale quién es el jefe o cabeza de hogar.';
	} else if (jefes > 1) {
		e.personas = 'Solo una persona puede figurar como jefe o cabeza de hogar.';
	}

	return e;
}

export function validarPersona(p: Persona, i: number, c: Catalogos): Errores {
	const e: Errores = {};
	const base = `personas.${i}.`;

	for (const campo of ['nombres', 'apellidos'] as const) {
		const v = p[campo].trim();
		if (v.length < 2 || v.length > 120) {
			e[base + campo] = campo === 'nombres' ? 'Escriba el nombre.' : 'Escriba los apellidos.';
		} else if (!RE_NOMBRE.test(v)) {
			e[base + campo] = 'Use solo letras, espacios, apóstrofos, puntos o guiones.';
		}
	}

	if (p.tipo_documento === null) {
		e[base + 'tipo_documento'] = 'Seleccione el tipo de documento.';
	} else if (muestraNumeroDocumento(p, c.documentos_sin_numero)) {
		// C6
		const numero = p.numero_documento.trim();
		const alfanumerico = c.documentos_alfanumericos.includes(p.tipo_documento);
		const patron = alfanumerico ? /^[A-Za-z0-9-]{4,30}$/ : /^\d{4,30}$/;

		if (!numero) {
			e[base + 'numero_documento'] = 'Escriba el número de documento.';
		} else if (!patron.test(numero)) {
			e[base + 'numero_documento'] = alfanumerico
				? 'El número debe tener entre 4 y 30 caracteres, sin espacios ni símbolos.'
				: 'El número debe tener entre 4 y 30 dígitos, sin puntos ni espacios.';
		}
	}

	// C7
	if (p.tipo_documento !== null && muestraDocumentoOtro(p, c.documento_otro)) {
		const t = p.documento_otro.trim();
		if (t.length < 2 || t.length > 60) {
			e[base + 'documento_otro'] = 'Indique cuál es el documento.';
		}
	}

	if (p.parentesco === null) e[base + 'parentesco'] = 'Seleccione el parentesco con el jefe de hogar.';
	if (p.genero === null) e[base + 'genero'] = 'Seleccione la identidad de género.';
	if (p.pertenencia_etnica === null) {
		e[base + 'pertenencia_etnica'] = 'Seleccione la pertenencia étnica, o "No aplica".';
	}

	// La fecha de nacimiento es opcional, pero si se empieza hay que terminarla.
	const partes = [p.nacimiento_dia, p.nacimiento_mes, p.nacimiento_ano];
	const llenas = partes.filter((x) => x !== '').length;

	if (llenas > 0 && llenas < 3) {
		e[base + 'fecha_nacimiento'] = 'Complete el día, el mes y el año, o deje la fecha en blanco.';
	} else if (llenas === 3) {
		const iso = `${p.nacimiento_ano}-${p.nacimiento_mes.padStart(2, '0')}-${p.nacimiento_dia.padStart(2, '0')}`;
		if (!fechaExiste(iso)) {
			e[base + 'fecha_nacimiento'] = 'Esa fecha no existe. Revísela.';
		} else if (iso > hoy()) {
			e[base + 'fecha_nacimiento'] = 'La fecha de nacimiento no puede ser futura.';
		} else if (iso < haceAnos(120)) {
			e[base + 'fecha_nacimiento'] = 'Revise la fecha de nacimiento.';
		}
	}

	// C8
	const telefono = p.telefono.trim();
	if (p.parentesco === c.parentesco_jefe && !telefonoValido(telefono)) {
		e[base + 'telefono'] =
			'Escriba un teléfono de contacto del jefe de hogar (entre 7 y 15 dígitos).';
	} else if (telefono !== '' && !telefonoValido(telefono)) {
		e[base + 'telefono'] = 'El teléfono debe tener entre 7 y 15 dígitos.';
	}

	return e;
}

function validarAgropecuario(d: FormularioRufe, c: Catalogos): Errores {
	const e: Errores = {};

	if (d.tiene_afectacion_agro === null) {
		e.tiene_afectacion_agro = 'Indique si perdió cultivos o animales.';

		return e;
	}

	// C9
	if (!muestraAgropecuario(d)) return e;

	if (d.agropecuario.length === 0) {
		e.agropecuario =
			'Registre al menos un cultivo o especie afectada, o indique que no hubo afectación.';

		return e;
	}

	if (d.agropecuario.length > c.limites.agropecuario) {
		e.agropecuario = `El formato oficial admite hasta ${c.limites.agropecuario} renglones agropecuarios.`;

		return e;
	}

	d.agropecuario.forEach((a, i) => Object.assign(e, validarRenglonAgro(a, i)));

	return e;
}

export function validarRenglonAgro(a: RenglonAgro, i: number): Errores {
	const e: Errores = {};
	const base = `agropecuario.${i}.`;

	const cultivo = a.tipo_cultivo.trim();
	const especie = a.especie_pecuaria.trim();

	if (!cultivo && !especie) {
		e[`agropecuario.${i}`] = 'Escriba el cultivo o la especie afectada, o elimine este renglón.';

		return e;
	}

	// C10
	if (cultivo) {
		if (cultivo.length > 120) e[base + 'tipo_cultivo'] = 'El nombre del cultivo es demasiado largo.';
		if (!a.unidad_medida) {
			e[base + 'unidad_medida'] = 'Seleccione la unidad de medida del área afectada.';
		}
		const area = Number(a.area_cantidad);
		if (a.area_cantidad === '' || Number.isNaN(area) || area <= 0 || area > 99999999.99) {
			e[base + 'area_cantidad'] = 'Escriba el área afectada como un número mayor que cero.';
		}
	}

	// C11
	if (especie) {
		if (especie.length > 120) e[base + 'especie_pecuaria'] = 'El nombre de la especie es demasiado largo.';
		const cantidad = Number(a.cantidad_unidades);
		if (
			a.cantidad_unidades === '' ||
			!Number.isInteger(cantidad) ||
			cantidad < 1 ||
			cantidad > 1000000
		) {
			e[base + 'cantidad_unidades'] = 'Escriba cuántos animales resultaron afectados.';
		}
	}

	return e;
}

function validarContacto(d: FormularioRufe): Errores {
	const e: Errores = {};

	if (!telefonoValido(d.contacto_telefono)) {
		e.contacto_telefono = 'Escriba un teléfono de contacto de entre 7 y 15 dígitos.';
	}

	const correo = d.contacto_correo.trim();
	if (correo && !correoValido(correo)) {
		e.contacto_correo = 'El correo electrónico no es válido.';
	}

	if (d.observaciones.length > 2000) {
		e.observaciones = 'Las observaciones no pueden superar los 2000 caracteres.';
	}

	return e;
}

function validarAutorizaciones(d: FormularioRufe): Errores {
	const e: Errores = {};

	if (!d.autoriza_tratamiento) {
		e.autoriza_tratamiento =
			'Debe confirmar la declaración y la autorización del ciudadano para poder registrar la ficha.';
	}

	return e;
}

/**
 * A qué paso pertenece una clave de error. Lo usa el resumen de errores del
 * envío final para llevar al ciudadano al sitio correcto cuando el servidor
 * rechaza algo que el navegador dejó pasar.
 */
export function pasoDelError(clave: string): IdPaso {
	if (clave.startsWith('personas')) return 'personas';
	if (clave.startsWith('agropecuario') || clave === 'tiene_afectacion_agro') return 'agropecuario';

	const mapa: Record<string, IdPaso> = {
		evento: 'evento',
		evento_otro: 'evento',
		fecha_evento: 'evento',
		zona: 'ubicacion',
		corregimiento: 'ubicacion',
		vereda_sector_barrio: 'ubicacion',
		direccion: 'ubicacion',
		latitud: 'ubicacion',
		longitud: 'ubicacion',
		tipo_bien: 'inmueble',
		forma_tenencia: 'inmueble',
		estado_bien: 'inmueble',
		alojamiento: 'alojamiento',
		alojamiento_direccion: 'alojamiento',
		observaciones: 'evidencias',
		contacto_telefono: 'evidencias',
		contacto_correo: 'evidencias',
		archivo: 'evidencias',
		autoriza_tratamiento: 'revision'
	};

	return mapa[clave] ?? 'revision';
}
