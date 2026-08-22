// Tipos del formulario RUFE (formato UNGRD FR-1703-SMD-69, versión 01).
//
// Los catálogos NO se declaran aquí como valores: llegan de
// `GET /rufe/catalogos`, que los sirve desde `backend/src/Rufe/Catalogos.php`.
// Duplicarlos en TypeScript garantizaría que tarde o temprano el navegador y el
// servidor no coincidan en qué códigos existen.

export type OpcionNumerada = { codigo: number; etiqueta: string };
export type OpcionTextual = { codigo: string; etiqueta: string };
export type OpcionTipoBien = OpcionTextual & { grupo: 'COMUNES' | 'INSTITUCIONAL' };

export type Catalogos = {
	formato: { codigo: string; version: string; aviso_version: string };
	fijos: { departamento: string; municipio: string };
	limites: {
		personas: number;
		agropecuario: number;
		evidencias: number;
		evidencias_documento: number;
		evidencias_dano: number;
		bytes_archivo: number;
		bytes_carga: number;
		anos_atras_evento: number;
		extensiones: string[];
	};
	tipos_documento: OpcionNumerada[];
	documentos_sin_numero: number[];
	documentos_alfanumericos: number[];
	documento_otro: number;
	parentescos: OpcionNumerada[];
	parentesco_jefe: number;
	generos: OpcionNumerada[];
	etnias: OpcionNumerada[];
	zonas: OpcionTextual[];
	alojamientos: OpcionTextual[];
	formas_tenencia: OpcionTextual[];
	estados_bien: OpcionTextual[];
	tipos_bien: OpcionTipoBien[];
	unidades_medida: OpcionTextual[];
	eventos_sugeridos: string[];
	corregimientos: string[];
	/** Valores con los que abre el formulario. Vacíos = sin precargar. */
	predeterminados: { evento: string; fecha_evento: string };
};

/** Documento de identidad o foto del daño. */
/**
 * Las clases de archivo que admite una carga.
 *
 * `INSPECCION` es el registro fotográfico del numeral 11 del formato de
 * inspección: hasta diez fotos, cada una con su «FOTOGRAFIA DE:». Comparte la
 * maquinaria del censo —compresión, cola, reintento, adopción— porque es
 * exactamente el mismo trabajo; lo único distinto es el cupo y el pie de foto.
 */
export type TipoEvidencia = 'DOCUMENTO' | 'DANO' | 'INSPECCION' | 'PRE_CEDULA' | 'PRE_DANO';

/**
 * Los dos que puede subir alguien SIN sesión, desde el formulario ciudadano.
 *
 * Se separan de los internos porque el servidor los filtra contra su propia
 * lista blanca: sin ella, una solicitud pública podría reclamar el cupo de diez
 * fotos del registro fotográfico de una inspección.
 */
export const TIPOS_PREINSCRIPCION: TipoEvidencia[] = ['PRE_CEDULA', 'PRE_DANO'];

export type Persona = {
	/** Identificador local, solo para la clave de la lista. No viaja al servidor. */
	uid: string;
	nombres: string;
	apellidos: string;
	tipo_documento: number | null;
	numero_documento: string;
	documento_otro: string;
	parentesco: number | null;
	genero: number | null;
	nacimiento_dia: string;
	nacimiento_mes: string;
	nacimiento_ano: string;
	pertenencia_etnica: number | null;
	telefono: string;
};

export type RenglonAgro = {
	uid: string;
	tipo_cultivo: string;
	unidad_medida: string;
	area_cantidad: string;
	especie_pecuaria: string;
	cantidad_unidades: string;
};

export type FormularioRufe = {
	evento: string;
	evento_otro: string;
	fecha_evento: string;
	zona: string;
	corregimiento: string;
	vereda_sector_barrio: string;
	direccion: string;
	latitud: number | null;
	longitud: number | null;
	precision_m: number | null;
	tipo_bien: string;
	forma_tenencia: string;
	estado_bien: string;
	alojamiento: string;
	alojamiento_direccion: string;
	personas: Persona[];
	tiene_afectacion_agro: boolean | null;
	agropecuario: RenglonAgro[];
	observaciones: string;
	contacto_telefono: string;
	contacto_correo: string;
	/**
	 * Una sola casilla, con un texto que lo dice todo: la declaración de quien
	 * informó y la autorización del ciudadano, datos sensibles incluidos.
	 */
	autoriza_tratamiento: boolean;
};

/** Archivo ya aceptado por el servidor dentro de una carga. */
export type EvidenciaSubida = {
	id: number;
	tipo: TipoEvidencia;
	nombre_original: string;
	tamano_bytes: number;
	mime: string;
};

import type { MetricasImagen } from './imagen';

/** Archivo en la cola local, con su estado de subida. */
export type EvidenciaLocal = {
	uid: string;
	tipo: TipoEvidencia;
	archivo: File;
	nombre: string;
	tamano: number;
	estado: 'optimizando' | 'pendiente' | 'subiendo' | 'listo' | 'error';
	progreso: number;
	error?: string;
	/** El fallo fue de red o del servidor: se reintenta solo al volver la señal. */
	reintentable?: boolean;
	/** Qué se ganó al optimizar. Ausente mientras se procesa. */
	metricas?: MetricasImagen;
	/** Id que asignó el servidor, disponible solo cuando el estado es `listo`. */
	idServidor?: number;
	/** URL de objeto para la vista previa. Se revoca al quitar el archivo. */
	vistaPrevia?: string;
	/**
	 * El «FOTOGRAFIA DE:» del numeral 11. Solo lo usa la inspección.
	 *
	 * Se escribe DESPUÉS de tomar la foto —primero se dispara y luego se
	 * describe—, así que no viaja en la subida: se manda aparte cuando el
	 * profesional termina de escribirlo.
	 */
	descripcion?: string;
};

export type RespuestaEnvio = {
	radicado: string;
	recibido_en: string;
	/** true cuando el servidor reconoció un envío que ya había entrado. */
	reintento?: boolean;
};

export type RespuestaCarga = {
	carga: string;
	expira_en: string;
	maximo_archivos: number;
	maximo_bytes: number;
};

// ── Bandeja interna ──────────────────────────────────────────────────────────

export type EstadoReporte = 'RECIBIDO' | 'EN_VALIDACION' | 'VALIDADO' | 'RECHAZADO' | 'ARCHIVADO';

export type ReporteResumen = {
	id: number;
	radicado: string;
	estado: EstadoReporte;
	estado_etiqueta: string;
	origen: 'PUBLICO' | 'INTERNO';
	evento: string;
	fecha_evento: string;
	zona: string;
	zona_etiqueta: string;
	corregimiento: string | null;
	vereda_sector_barrio: string;
	tipo_bien: string;
	tipo_bien_etiqueta: string;
	estado_bien: string;
	estado_bien_etiqueta: string;
	personas: number;
	evidencias: number;
	revision_prioritaria: boolean;
	anonimizado: boolean;
	creado_en: string;
};

export type ReporteDetalle = ReporteResumen & {
	formato_version: string;
	departamento: string;
	municipio: string;
	fecha_rufe: string;
	direccion: string;
	latitud: number | null;
	longitud: number | null;
	precision_m: number | null;
	alojamiento: string;
	alojamiento_etiqueta: string;
	alojamiento_direccion: string | null;
	forma_tenencia: string;
	forma_tenencia_etiqueta: string;
	observaciones: string | null;
	contacto_telefono: string;
	contacto_correo: string | null;
	autoriza_datos: boolean;
	autoriza_sensibles: boolean;
	autorizacion_en: string | null;
	autorizacion_texto: string | null;
	vobo_en: string | null;
	anonimizado_en: string | null;
	actualizado_en: string;
};

export type PersonaReporte = {
	orden: number;
	nombres: string;
	apellidos: string;
	tipo_documento: number;
	tipo_documento_etiqueta: string;
	numero_documento: string | null;
	documento_otro: string | null;
	parentesco: number;
	parentesco_etiqueta: string;
	genero: number;
	genero_etiqueta: string;
	fecha_nacimiento: string | null;
	pertenencia_etnica: number;
	pertenencia_etnica_etiqueta: string;
	telefono: string | null;
};

export type AgroReporte = {
	orden: number;
	tipo_cultivo: string | null;
	unidad_medida: string | null;
	unidad_medida_etiqueta: string | null;
	area_cantidad: number | null;
	especie_pecuaria: string | null;
	cantidad_unidades: number | null;
};

export type EvidenciaReporte = {
	id: number;
	tipo: TipoEvidencia;
	tipo_etiqueta: string;
	nombre_original: string;
	mime: string;
	extension: string;
	tamano_bytes: number;
	creado_en: string;
};

export type MovimientoHistorial = {
	estado_anterior: string | null;
	estado_nuevo: string;
	estado_etiqueta: string;
	usuario_email: string | null;
	nota: string | null;
	creado_en: string;
};

export type DetalleCompleto = {
	reporte: ReporteDetalle;
	personas: PersonaReporte[];
	agropecuario: AgroReporte[];
	evidencias: EvidenciaReporte[];
	historial: MovimientoHistorial[];
};

export type Paginacion = {
	pagina: number;
	por_pagina: number;
	total: number;
	paginas: number;
};
