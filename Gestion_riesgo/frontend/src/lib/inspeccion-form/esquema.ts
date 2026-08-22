// Los pasos del formato de inspección y qué depende de qué.
//
// Como en el RUFE (`$lib/rufe-form/esquema.ts`), los pasos están como DATOS en
// un solo archivo y no repartidos por los componentes: así se puede comprobar
// de un vistazo —y con una prueba— que ningún campo se quedó sin paso y que
// cada condicional está escrita una sola vez.
//
// Lo que este formato tiene y el RUFE no es una bifurcación de verdad: el
// numeral 4 decide si se hace la inspección o si se levanta un acta y se
// termina. No es un campo que se oculta, es media ficha que no se llena.

import type { Catalogos, DanoElemento, FormularioInspeccion, Sistema } from './tipos';
import type { Danos } from './combo';

export type IdPaso =
	| 'inicio'
	| 'profesional'
	| 'propietario'
	| 'localizacion'
	| 'requisitos'
	| 'evento'
	| 'sistema'
	| 'evaluacion'
	| 'materiales'
	| 'informante'
	| 'fotos'
	| 'acta'
	| 'revision';

export type Paso = {
	id: IdPaso;
	titulo: string;
	ayuda: string;
	campos: (keyof FormularioInspeccion)[];
	/** El paso 0 orienta y el último resume: ninguno cuenta como avance. */
	cuentaEnProgreso: boolean;
	/**
	 * En qué rama vive.
	 *   'siempre'   — se hace en todos los casos
	 *   'inspeccion'— solo si el afectado cumple los requisitos
	 *   'acta'      — solo si NO los cumple
	 */
	rama: 'siempre' | 'inspeccion' | 'acta';
};

export const PASOS: Paso[] = [
	{
		id: 'inicio',
		titulo: 'Antes de empezar',
		ayuda: 'Inspección técnica de la vivienda para el banco de materiales.',
		campos: [],
		cuentaEnProgreso: false,
		rama: 'siempre'
	},
	{
		id: 'profesional',
		titulo: 'Quién inspecciona',
		ayuda: 'Sus datos como responsable de la inspección y evaluación.',
		campos: [
			'fecha_evaluacion',
			'profesional_nombre',
			'profesional_tarjeta',
			'profesional_profesion',
			'profesional_profesion_otra',
			'profesional_documento',
			'profesional_documento_de',
			'profesional_telefono',
			'profesional_direccion'
		],
		cuentaEnProgreso: true,
		rama: 'siempre'
	},
	{
		id: 'propietario',
		titulo: 'El propietario',
		ayuda: 'Datos del propietario de la vivienda afectada.',
		campos: [
			'propietario_nombres',
			'propietario_documento',
			'propietario_documento_de',
			'propietario_telefono',
			'propietario_direccion'
		],
		cuentaEnProgreso: true,
		rama: 'siempre'
	},
	{
		id: 'localizacion',
		titulo: 'Dónde queda la vivienda',
		ayuda: 'Ubicación del predio inspeccionado.',
		campos: ['direccion_cabecera', 'corregimiento', 'vereda'],
		cuentaEnProgreso: true,
		rama: 'siempre'
	},
	{
		id: 'requisitos',
		titulo: 'Requisitos',
		ayuda: 'De estas tres respuestas depende que continúe la inspección.',
		campos: ['requisitos'],
		cuentaEnProgreso: true,
		rama: 'siempre'
	},
	{
		id: 'evento',
		titulo: 'Qué afectó la vivienda',
		ayuda: 'El evento que causó el daño.',
		campos: ['evento', 'evento_otro'],
		cuentaEnProgreso: true,
		rama: 'inspeccion'
	},
	{
		id: 'sistema',
		titulo: 'Cómo está construida',
		ayuda: 'Sistema constructivo y materiales encontrados en la visita.',
		campos: ['sistema_constructivo', 'infraestructura'],
		cuentaEnProgreso: true,
		rama: 'inspeccion'
	},
	{
		id: 'evaluacion',
		titulo: 'Evaluación técnica',
		ayuda: 'Elemento por elemento, según los criterios del Anexo 1.',
		campos: ['danos', 'colapso_total', 'requiere_evacuacion'],
		cuentaEnProgreso: true,
		rama: 'inspeccion'
	},
	{
		id: 'materiales',
		titulo: 'Banco de materiales',
		ayuda: 'El combo sale de la evaluación; elija el kit de cubierta.',
		campos: ['kit_cubierta'],
		cuentaEnProgreso: true,
		rama: 'inspeccion'
	},
	{
		id: 'informante',
		titulo: 'Quién dio la información',
		ayuda: 'Quien atendió la visita en la vivienda.',
		campos: [
			'informante_nombre',
			'informante_documento',
			'informante_parentesco',
			'informante_telefono'
		],
		cuentaEnProgreso: true,
		rama: 'inspeccion'
	},
	{
		id: 'fotos',
		titulo: 'Registro fotográfico',
		ayuda: 'Identifique en cada foto el elemento afectado.',
		campos: [],
		cuentaEnProgreso: true,
		rama: 'inspeccion'
	},
	{
		id: 'acta',
		titulo: 'No cumple los requisitos',
		ayuda: 'Constancia de que no puede acceder al banco de materiales.',
		campos: ['acta_modalidad', 'acta_nombre', 'acta_documento', 'acta_telefono'],
		cuentaEnProgreso: true,
		rama: 'acta'
	},
	{
		id: 'revision',
		titulo: 'Revisar y enviar',
		ayuda: 'Verifique la información antes de enviarla.',
		campos: [],
		cuentaEnProgreso: false,
		rama: 'siempre'
	}
];

// ── El numeral 3 y la bifurcación del numeral 4 ──────────────────────────────

/**
 * ¿Contestó los tres requisitos?
 *
 * Hasta que los tres tengan respuesta no se puede decidir nada: quedan en
 * `null`, que es distinto de «no».
 */
export function requisitosCompletos(d: FormularioInspeccion, c: Catalogos): boolean {
	return c.requisitos.every((r) => d.requisitos[r.codigo] === true || d.requisitos[r.codigo] === false);
}

/**
 * El numeral 4, derivado de los tres requisitos del numeral 3.
 *
 * Se deriva y no se pregunta aparte a propósito. El papel permite marcar
 * «cumple» habiendo contestado que la persona no es propietaria, y eso es un
 * defecto del papel: produce fichas que se contradicen a sí mismas y que
 * después hay que devolver. Si algún día hiciera falta una excepción motivada,
 * será una decisión explícita y no un descuido.
 *
 * Devuelve `null` mientras falte contestar algo.
 */
export function cumpleRequisitos(d: FormularioInspeccion, c: Catalogos): boolean | null {
	if (!requisitosCompletos(d, c)) return null;

	return c.requisitos.every((r) => d.requisitos[r.codigo] === true);
}

/** Qué requisitos fallaron, para poder decirlo en vez de solo negar. */
export function requisitosIncumplidos(d: FormularioInspeccion, c: Catalogos): string[] {
	return c.requisitos.filter((r) => d.requisitos[r.codigo] === false).map((r) => r.etiqueta);
}

/**
 * Los pasos que hay que recorrer, según la rama.
 *
 * Antes de contestar el numeral 3 se muestra la rama de inspección: es el
 * camino normal, y ver de entrada la pantalla de «no cumple» daría a entender
 * que se da por descontado que no va a cumplir.
 */
export function pasosVigentes(d: FormularioInspeccion, c: Catalogos): Paso[] {
	const cumple = cumpleRequisitos(d, c);
	const rama = cumple === false ? 'acta' : 'inspeccion';

	return PASOS.filter((p) => p.rama === 'siempre' || p.rama === rama);
}

export function pasosConProgreso(d: FormularioInspeccion, c: Catalogos): Paso[] {
	return pasosVigentes(d, c).filter((p) => p.cuentaEnProgreso);
}

// ── Condicionales ────────────────────────────────────────────────────────────

export const EVENTO_OTRO = 'OTRO';

export const PROFESION_OTRA = 'OTRA';

export function muestraProfesionOtra(d: FormularioInspeccion): boolean {
	return d.profesional_profesion === PROFESION_OTRA;
}

export function muestraEventoOtro(d: FormularioInspeccion): boolean {
	return d.evento === EVENTO_OTRO;
}

/**
 * Los elementos que se evalúan, según el sistema constructivo.
 *
 * Nunca los dos: mampostería y madera tienen elementos distintos y mostrar las
 * dos tablas sería invitar a llenar la que no es.
 */
export function elementosDe(d: FormularioInspeccion, c: Catalogos) {
	return d.sistema_constructivo ? (c.evaluacion[d.sistema_constructivo] ?? []) : [];
}

/**
 * ¿Se llena la tabla por elementos?
 *
 * Con colapso total no: el formato dice «marque solo esta casilla».
 */
export function muestraTablaDanos(d: FormularioInspeccion): boolean {
	return d.sistema_constructivo !== '' && !d.colapso_total;
}

export function muestraNivel(dano: DanoElemento | undefined): boolean {
	return dano?.afectado === true;
}

/** Los kits de cubierta del sistema elegido. En madera solo hay zinc. */
export function kitsCubiertaDe(d: FormularioInspeccion, c: Catalogos): Opciones {
	const mapa = d.sistema_constructivo ? (c.kits_cubierta[d.sistema_constructivo] ?? {}) : {};

	return Object.entries(mapa).map(([codigo, etiqueta]) => ({ codigo, etiqueta }));
}

type Opciones = { codigo: string; etiqueta: string }[];

/**
 * El kit que sugiere el material de la cubierta encontrado en el 5.3.
 *
 * Sugerencia, no imposición: decide el profesional. Pero llegar con la casilla
 * marcada donde el material lo canta evita una equivocación tonta al final de
 * una visita larga.
 */
export function kitSugerido(d: FormularioInspeccion, c: Catalogos): string | null {
	const letra = d.infraestructura.CUBIERTA;
	const sugerido = letra ? c.kit_sugerido[letra] : undefined;
	if (!sugerido) return null;

	// Solo si ese kit existe para el sistema elegido.
	return kitsCubiertaDe(d, c).some((k) => k.codigo === sugerido) ? sugerido : null;
}

/** La tabla del 5.4 reducida a lo que el cálculo del combo necesita. */
export function nivelesPorElemento(d: FormularioInspeccion): Danos {
	const salida: Danos = {};

	for (const [codigo, dano] of Object.entries(d.danos)) {
		salida[codigo] = dano.afectado === true ? dano.nivel : null;
	}

	return salida;
}

// ── Estado inicial ───────────────────────────────────────────────────────────

export function danoVacio(): DanoElemento {
	return { afectado: null, nivel: null };
}

/**
 * Completa un formulario con todo lo que le falte para poder dibujarse.
 *
 * Existe por un fallo concreto del 21 de agosto de 2026: la pantalla se quedaba
 * en blanco con un `props_invalid_value` de Svelte. Enlazar
 * `bind:valor={datos.algo}` sobre una propiedad que NO EXISTE le pasa
 * `undefined` a un `$bindable` con valor por defecto, y Svelte lo rechaza.
 *
 * Pasaba por dos caminos distintos, y por eso esto arregla los dos:
 *
 *  • `requisitos` e `infraestructura` son diccionarios cuyas claves salen de
 *    los catálogos, así que el formulario vacío no puede conocerlas y
 *    empezaban en `{}`.
 *  • Un borrador guardado con una versión anterior no trae los campos que se
 *    añadieron después. Al continuarlo, cualquiera de ellos reventaba la
 *    pantalla — y no en el paso donde está el campo, sino al llegar a él.
 *
 * Se parte del formulario vacío y se le encima el guardado: así cada campo que
 * falte recibe su valor por defecto, incluidos los que se añadan en el futuro.
 * Un borrador es del teléfono de cada quien; no hay forma de migrarlos.
 *
 * Lo que ya tiene valor NO se toca: recuperar un borrador no puede borrar lo
 * que la persona ya contestó.
 */
export function conValoresIniciales(
	d: Partial<FormularioInspeccion>,
	c: Catalogos
): FormularioInspeccion {
	const requisitos: Record<string, boolean | null> = {};
	for (const r of c.requisitos) {
		requisitos[r.codigo] = d.requisitos?.[r.codigo] ?? null;
	}

	const infraestructura: Record<string, string> = {};
	for (const categoria of Object.keys(c.convenciones)) {
		infraestructura[categoria] = d.infraestructura?.[categoria] ?? '';
	}

	// Una profesión que ya no está en el catálogo —un borrador de cuando el
	// campo era texto libre— no se puede mostrar en la lista: se descarta en vez
	// de dejar el desplegable en un estado que no corresponde a nada.
	const profesion = c.profesiones.some((p) => p.codigo === d.profesional_profesion)
		? (d.profesional_profesion as string)
		: '';

	return {
		...formularioVacio(),
		...d,
		profesional_profesion: profesion,
		requisitos,
		infraestructura
	};
}

export function formularioVacio(): FormularioInspeccion {
	return {
		fecha_evaluacion: '',
		profesional_nombre: '',
		profesional_tarjeta: '',
		profesional_profesion: '',
		profesional_profesion_otra: '',
		profesional_documento: '',
		profesional_documento_de: '',
		profesional_telefono: '',
		profesional_direccion: '',
		propietario_nombres: '',
		propietario_documento: '',
		propietario_documento_de: '',
		propietario_telefono: '',
		propietario_direccion: '',
		direccion_cabecera: '',
		corregimiento: '',
		vereda: '',
		latitud: null,
		longitud: null,
		precision_m: null,
		requisitos: {},
		evento: '',
		evento_otro: '',
		sistema_constructivo: '',
		infraestructura: {},
		danos: {},
		colapso_total: false,
		requiere_evacuacion: null,
		kit_cubierta: '',
		informante_nombre: '',
		informante_documento: '',
		informante_parentesco: null,
		informante_telefono: '',
		acta_modalidad: '',
		acta_nombre: '',
		acta_documento: '',
		acta_telefono: '',
		rufe_reporte_id: null
	};
}

/**
 * Borra lo que dejó de verse.
 *
 * Un campo oculto no puede viajar al servidor con un valor que el profesional
 * ya no puede corregir en pantalla — y aquí importa más que en el RUFE: si se
 * cambia el sistema constructivo a mitad de la evaluación, las filas del otro
 * sistema quedarían escritas en un expediente que nadie volvería a mirar.
 */
export function limpiarCondicionales(
	d: FormularioInspeccion,
	c: Catalogos
): FormularioInspeccion {
	const limpio: FormularioInspeccion = { ...d };

	if (!muestraEventoOtro(limpio)) limpio.evento_otro = '';
	if (!muestraProfesionOtra(limpio)) limpio.profesional_profesion_otra = '';

	// Solo sobreviven los elementos del sistema elegido.
	const validos = new Set(elementosDe(limpio, c).map((e) => e.codigo));
	const danos: Record<string, DanoElemento> = {};

	for (const [codigo, dano] of Object.entries(limpio.danos)) {
		if (!validos.has(codigo)) continue;

		// Un nivel que este elemento no admite —o que quedó de decir «sí» y
		// luego «no»— no se conserva.
		const permitido = elementosDe(limpio, c)
			.find((e) => e.codigo === codigo)
			?.niveles.some((n) => n.codigo === dano.nivel);

		danos[codigo] = {
			afectado: dano.afectado,
			nivel: dano.afectado === true && permitido ? dano.nivel : null
		};
	}

	limpio.danos = danos;

	// Con colapso total la tabla por elementos no aplica.
	if (limpio.colapso_total) limpio.danos = {};

	if (!kitsCubiertaDe(limpio, c).some((k) => k.codigo === limpio.kit_cubierta)) {
		limpio.kit_cubierta = '';
	}

	// La rama que no se recorrió no deja rastro en el expediente.
	const cumple = cumpleRequisitos(limpio, c);

	if (cumple === false) {
		Object.assign(limpio, {
			evento: '',
			evento_otro: '',
			sistema_constructivo: '' as Sistema | '',
			// Vaciar el mapa entero volvería a dejar claves sin valor y a romper el
			// `bind:` si la persona vuelve atrás y corrige un requisito.
			infraestructura: Object.fromEntries(Object.keys(c.convenciones).map((k) => [k, ''])),
			danos: {},
			colapso_total: false,
			requiere_evacuacion: null,
			kit_cubierta: '',
			informante_nombre: '',
			informante_documento: '',
			informante_parentesco: null,
			informante_telefono: ''
		});
	} else {
		limpio.acta_modalidad = '';
		limpio.acta_nombre = '';
		limpio.acta_documento = '';
		limpio.acta_telefono = '';
	}

	return limpio;
}
