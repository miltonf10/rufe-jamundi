// Estructura del formulario RUFE: los pasos, qué campo vive en cuál y qué
// campos dependen de otros.
//
// Está como datos y no repartido por los componentes para que exista un sitio
// donde comprobar de un vistazo que ningún campo se quedó sin paso y que cada
// condicional está escrita una sola vez. La prueba `esquema.spec.ts` verifica
// justamente eso.

import type { FormularioRufe, Persona, RenglonAgro } from './tipos';

export type IdPaso =
	| 'inicio'
	| 'evento'
	| 'ubicacion'
	| 'inmueble'
	| 'alojamiento'
	| 'personas'
	| 'agropecuario'
	| 'evidencias'
	| 'revision';

export type Paso = {
	id: IdPaso;
	titulo: string;
	/** Frase corta bajo el título; el ciudadano debe entender qué se le pide. */
	ayuda: string;
	/** Campos de nivel superior que este paso valida. */
	campos: (keyof FormularioRufe)[];
	/** El paso 0 orienta y el último resume: ninguno de los dos cuenta como avance. */
	cuentaEnProgreso: boolean;
};

export const PASOS: Paso[] = [
	{
		id: 'inicio',
		titulo: 'Antes de empezar',
		ayuda: 'Le tomará unos 10 minutos. Puede detenerse y continuar más tarde.',
		campos: [],
		cuentaEnProgreso: false
	},
	{
		id: 'evento',
		titulo: 'El evento',
		ayuda: 'Cuéntenos qué ocurrió y cuándo.',
		campos: ['evento', 'evento_otro', 'fecha_evento'],
		cuentaEnProgreso: true
	},
	{
		id: 'ubicacion',
		titulo: 'Ubicación del inmueble',
		ayuda: 'Dónde queda el bien afectado.',
		campos: ['zona', 'corregimiento', 'vereda_sector_barrio', 'direccion'],
		cuentaEnProgreso: true
	},
	{
		id: 'inmueble',
		titulo: 'El inmueble',
		ayuda: 'Qué tipo de bien es, cómo quedó y qué relación tiene usted con él.',
		campos: ['tipo_bien', 'forma_tenencia', 'estado_bien'],
		cuentaEnProgreso: true
	},
	{
		id: 'alojamiento',
		titulo: 'Dónde está alojado',
		ayuda: 'Si tuvo que salir de su vivienda, necesitamos saber dónde ubicarlo.',
		campos: ['alojamiento', 'alojamiento_direccion'],
		cuentaEnProgreso: true
	},
	{
		id: 'personas',
		titulo: 'Personas del hogar',
		ayuda: 'Registre a quienes viven en el inmueble afectado.',
		campos: ['personas'],
		cuentaEnProgreso: true
	},
	{
		id: 'agropecuario',
		titulo: 'Cultivos y animales',
		ayuda: 'Solo si perdió cultivos o animales por el evento.',
		campos: ['tiene_afectacion_agro', 'agropecuario'],
		cuentaEnProgreso: true
	},
	{
		id: 'evidencias',
		titulo: 'Fotos y observaciones',
		ayuda: 'Las fotos ayudan a valorar el daño, pero no son obligatorias.',
		campos: ['observaciones', 'contacto_telefono', 'contacto_correo'],
		cuentaEnProgreso: true
	},
	{
		id: 'revision',
		titulo: 'Revisar y enviar',
		ayuda: 'Verifique la información antes de enviarla.',
		campos: ['autoriza_tratamiento'],
		cuentaEnProgreso: false
	}
];

export const PASOS_CON_PROGRESO = PASOS.filter((p) => p.cuentaEnProgreso);

export function indiceDePaso(id: IdPaso): number {
	return PASOS.findIndex((p) => p.id === id);
}

// ── Estado inicial ───────────────────────────────────────────────────────────

/**
 * crypto.randomUUID solo existe en contextos seguros. En producción siempre hay
 * HTTPS, pero en un `vite dev` servido por IP de red local no, y el formulario
 * no debería reventar por una clave de lista.
 */
export function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function personaVacia(parentescoJefe?: number): Persona {
	return {
		uid: uid(),
		nombres: '',
		apellidos: '',
		tipo_documento: null,
		numero_documento: '',
		documento_otro: '',
		parentesco: parentescoJefe ?? null,
		genero: null,
		nacimiento_dia: '',
		nacimiento_mes: '',
		nacimiento_ano: '',
		pertenencia_etnica: null,
		telefono: ''
	};
}

export function renglonAgroVacio(): RenglonAgro {
	return {
		uid: uid(),
		tipo_cultivo: '',
		unidad_medida: '',
		area_cantidad: '',
		especie_pecuaria: '',
		cantidad_unidades: ''
	};
}

export function formularioVacio(): FormularioRufe {
	return {
		evento: '',
		evento_otro: '',
		fecha_evento: '',
		zona: '',
		corregimiento: '',
		vereda_sector_barrio: '',
		direccion: '',
		latitud: null,
		longitud: null,
		precision_m: null,
		tipo_bien: '',
		forma_tenencia: '',
		estado_bien: '',
		alojamiento: '',
		alojamiento_direccion: '',
		personas: [],
		tiene_afectacion_agro: null,
		agropecuario: [],
		observaciones: '',
		contacto_telefono: '',
		contacto_correo: '',
		autoriza_tratamiento: false
	};
}

// ── Condicionales ────────────────────────────────────────────────────────────
//
// Un solo sitio decide qué se ve. Los componentes preguntan aquí y `limpiar()`
// borra lo que dejó de verse, para que un campo oculto nunca viaje al servidor
// con un valor que el ciudadano ya no puede corregir.

export const ES_OTRO_EVENTO = 'OTRO';

export function muestraEventoOtro(d: FormularioRufe): boolean {
	return d.evento === ES_OTRO_EVENTO;
}

export function muestraCorregimiento(d: FormularioRufe): boolean {
	return d.zona === 'RURAL';
}

export function etiquetaLugar(d: FormularioRufe): string {
	return d.zona === 'RURAL' ? 'Vereda o sector' : 'Barrio';
}

export function muestraDireccionAlojamiento(d: FormularioRufe): boolean {
	return d.alojamiento === 'EVACUADO';
}

export function muestraNumeroDocumento(p: Persona, sinNumero: number[]): boolean {
	return p.tipo_documento !== null && !sinNumero.includes(p.tipo_documento);
}

export function muestraDocumentoOtro(p: Persona, codigoOtro: number): boolean {
	return p.tipo_documento === codigoOtro;
}

export function muestraAgropecuario(d: FormularioRufe): boolean {
	return d.tiene_afectacion_agro === true;
}

/**
 * Deja el formulario coherente con sus propias condiciones: borra el valor de
 * todo campo que dejó de mostrarse. Se llama tras cada cambio que pueda apagar
 * una condición.
 */
export function limpiarCondicionales(
	d: FormularioRufe,
	catalogo: { documentos_sin_numero: number[]; documento_otro: number }
): FormularioRufe {
	if (!muestraEventoOtro(d)) d.evento_otro = '';
	if (!muestraCorregimiento(d)) d.corregimiento = '';
	if (!muestraDireccionAlojamiento(d)) d.alojamiento_direccion = '';
	if (!muestraAgropecuario(d)) d.agropecuario = [];

	for (const p of d.personas) {
		if (!muestraNumeroDocumento(p, catalogo.documentos_sin_numero)) p.numero_documento = '';
		if (!muestraDocumentoOtro(p, catalogo.documento_otro)) p.documento_otro = '';
	}

	return d;
}

// ── Serialización hacia la API ───────────────────────────────────────────────

function fechaDePartes(p: Persona): string {
	if (!p.nacimiento_dia || !p.nacimiento_mes || !p.nacimiento_ano) return '';
	const dd = p.nacimiento_dia.padStart(2, '0');
	const mm = p.nacimiento_mes.padStart(2, '0');

	return `${p.nacimiento_ano}-${mm}-${dd}`;
}

/**
 * Convierte el estado del formulario en el cuerpo que espera `POST
 * /rufe/reportes`. Los `uid` locales y los campos apagados por una condición no
 * salen de aquí.
 */
export function aCuerpoDeApi(
	d: FormularioRufe,
	extras: { carga?: string; iniciadoEn?: number; avisoVersion?: string } = {}
): Record<string, unknown> {
	const cuerpo: Record<string, unknown> = {
		evento: d.evento,
		fecha_evento: d.fecha_evento,
		zona: d.zona,
		vereda_sector_barrio: d.vereda_sector_barrio.trim(),
		direccion: d.direccion.trim(),
		tipo_bien: d.tipo_bien,
		forma_tenencia: d.forma_tenencia,
		estado_bien: d.estado_bien,
		alojamiento: d.alojamiento,
		tiene_afectacion_agro: d.tiene_afectacion_agro === true,
		observaciones: d.observaciones.trim(),
		contacto_telefono: d.contacto_telefono.trim(),
		contacto_correo: d.contacto_correo.trim(),
		autoriza_tratamiento: d.autoriza_tratamiento,
		// Qué aviso de habeas data se le mostró a esta persona. Viaja con la ficha
		// porque una levantada sin señal puede enviarse cuando la aplicación ya
		// cambió: lo que hay que probar es lo que aceptó, no lo que rige hoy.
		aviso_version: extras.avisoVersion,
		personas: d.personas.map((p) => ({
			nombres: p.nombres.trim(),
			apellidos: p.apellidos.trim(),
			tipo_documento: p.tipo_documento,
			numero_documento: p.numero_documento.trim(),
			documento_otro: p.documento_otro.trim(),
			parentesco: p.parentesco,
			genero: p.genero,
			fecha_nacimiento: fechaDePartes(p),
			pertenencia_etnica: p.pertenencia_etnica,
			telefono: p.telefono.trim()
		})),
		agropecuario: d.agropecuario.map((a) => ({
			tipo_cultivo: a.tipo_cultivo.trim(),
			unidad_medida: a.unidad_medida,
			area_cantidad: a.area_cantidad === '' ? null : Number(a.area_cantidad),
			especie_pecuaria: a.especie_pecuaria.trim(),
			cantidad_unidades: a.cantidad_unidades === '' ? null : Number(a.cantidad_unidades)
		}))
	};

	// Los condicionales apagados se omiten por completo en vez de mandarse en
	// blanco: el servidor rechaza un campo presente cuya condición está apagada.
	if (muestraEventoOtro(d)) cuerpo.evento_otro = d.evento_otro.trim();
	if (muestraCorregimiento(d)) cuerpo.corregimiento = d.corregimiento.trim();
	if (muestraDireccionAlojamiento(d)) cuerpo.alojamiento_direccion = d.alojamiento_direccion.trim();

	if (d.latitud !== null && d.longitud !== null) {
		cuerpo.latitud = d.latitud;
		cuerpo.longitud = d.longitud;
		if (d.precision_m !== null) cuerpo.precision_m = d.precision_m;
	}

	if (extras.carga) cuerpo.carga = extras.carga;
	if (extras.iniciadoEn) cuerpo.iniciado_en = extras.iniciadoEn;

	// El honeypot viaja siempre vacío: si llega con algo, lo llenó un robot.
	cuerpo.sitio_web = '';

	return cuerpo;
}
