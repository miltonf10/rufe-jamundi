import type { Catalogos as CatalogosInspeccion } from '$lib/inspeccion-form/tipos';
import type { DetalleInspeccion } from '$lib/inspeccion-form/detalle';
import { api, API_BASE, leerToken } from './client';
import type { Actualizaciones, InfoSistema, RolCatalogo, Usuario } from './tipos';
import type {
	Catalogos,
	DetalleCompleto,
	EstadoReporte,
	Paginacion,
	ReporteDetalle,
	ReporteResumen,
	RespuestaCarga,
	RespuestaEnvio
} from '$lib/rufe-form/tipos';
import type { FichaMapa, Ubicacion } from '$lib/mapa/datos';

/** Acerca de — las dos pestañas. */
export const acercaApi = {
	sistema: () => api.get<InfoSistema>('/acerca/sistema'),
	// `refrescar=1` salta la caché del servidor: es lo que pide el botón
	// "Buscar actualizaciones", donde esperar 5 minutos no tendría sentido.
	actualizaciones: (refrescar = false) =>
		api.get<Actualizaciones>(`/acerca/actualizaciones${refrescar ? '?refrescar=1' : ''}`)
};

export type DatosUsuario = {
	nombre: string;
	email: string;
	rol: string;
	activo: boolean;
	password?: string;
	/**
	 * Datos propios del profesional que inspecciona viviendas.
	 *
	 * Son los del numeral 1 del formato. Viven en el usuario porque son suyos y
	 * no de la vivienda: sin esto se reescriben a mano, en un teléfono y de pie,
	 * en cada visita.
	 */
	profesion?: string | null;
	tarjeta_profesional?: string | null;
	documento?: string | null;
	documento_de?: string | null;
	telefono?: string | null;
	direccion?: string | null;
};

/** Administración → Gestión de usuarios del sistema. */
export const usuariosApi = {
	listar: () =>
		api.get<{ usuarios: Usuario[]; roles: RolCatalogo[]; profesiones: string[] }>('/usuarios'),
	crear: (datos: DatosUsuario) => api.post<{ usuario: Usuario }>('/usuarios', datos),
	actualizar: (id: number, datos: Partial<DatosUsuario>) =>
		api.put<{ usuario: Usuario }>(`/usuarios/${id}`, datos),
	eliminar: (id: number) => api.delete<{ mensaje: string }>(`/usuarios/${id}`),
	restablecerPassword: (id: number, password: string) =>
		api.post<{ mensaje: string }>(`/usuarios/${id}/password`, { password })
};

export type FiltrosReportes = {
	estado?: string;
	zona?: string;
	desde?: string;
	hasta?: string;
	q?: string;
	pagina?: number;
};

/** Formulario RUFE: la parte pública y la bandeja interna. */
export const rufeApi = {
	// ── Captura en campo ────────────────────────────────────────────────
	// Todas van autenticadas. Cuando el formulario era público estas tres se
	// llamaban con `autenticada = false` para no exponer el token en rutas
	// abiertas; al volverse internas se cambió el router de PHP pero no estas
	// llamadas, así que salían sin cabecera Authorization y el servidor las
	// rechazaba con 401 — sin importar cuántas veces se iniciara sesión.
	catalogos: () => api.get<Catalogos>('/rufe/catalogos'),
	abrirCarga: () => api.post<RespuestaCarga>('/rufe/cargas', {}),
	enviarReporte: (cuerpo: Record<string, unknown>) =>
		api.post<RespuestaEnvio>('/rufe/reportes', cuerpo),

	// ── Bandeja interna ─────────────────────────────────────────────────
	listar: (filtros: FiltrosReportes = {}) => {
		const p = new URLSearchParams();
		for (const [clave, valor] of Object.entries(filtros)) {
			if (valor !== undefined && valor !== '') p.set(clave, String(valor));
		}
		const consulta = p.toString();

		return api.get<{ reportes: ReporteResumen[]; paginacion: Paginacion }>(
			`/rufe/reportes${consulta ? `?${consulta}` : ''}`
		);
	},
	ver: (id: number) => api.get<DetalleCompleto>(`/rufe/reportes/${id}`),
	cambiarEstado: (id: number, estado: EstadoReporte, nota: string) =>
		api.put<{ reporte: ReporteDetalle }>(`/rufe/reportes/${id}/estado`, { estado, nota }),
	anonimizar: (id: number) => api.post<{ mensaje: string }>(`/rufe/reportes/${id}/anonimizar`, {}),

	/**
	 * Las evidencias no se enlazan directamente: viven fuera del docroot y solo
	 * salen por este endpoint, que exige token y deja rastro en auditoría. Por eso
	 * hay que descargarlas con fetch y no con un `href`, que no lleva cabeceras.
	 */
	/**
	 * Trae una evidencia para verla en pantalla.
	 *
	 * Devuelve una URL de objeto que hay que revocar al terminar: si no, el
	 * navegador conserva la imagen entera en memoria hasta recargar la página, y
	 * una ficha con varias fotos deja al equipo pesado sin motivo.
	 *
	 * Va por `fetch` y no por un `src` directo porque las evidencias viven fuera
	 * del servidor web y solo salen por este endpoint, que exige el token en una
	 * cabecera — algo que una etiqueta `<img>` no puede enviar.
	 */
	async verEvidencia(reporteId: number, evidenciaId: number): Promise<string> {
		const respuesta = await fetch(
			`${API_BASE}/rufe/reportes/${reporteId}/evidencias/${evidenciaId}`,
			{ headers: { Authorization: `Bearer ${leerToken() ?? ''}` } }
		);

		if (!respuesta.ok) throw new Error('No se pudo abrir la imagen.');

		return URL.createObjectURL(await respuesta.blob());
	},

	async descargarEvidencia(reporteId: number, evidenciaId: number, nombre: string): Promise<void> {
		const respuesta = await fetch(
			`${API_BASE}/rufe/reportes/${reporteId}/evidencias/${evidenciaId}`,
			{ headers: { Authorization: `Bearer ${leerToken() ?? ''}` } }
		);

		if (!respuesta.ok) throw new Error('No se pudo descargar el archivo.');

		const blob = await respuesta.blob();
		const url = URL.createObjectURL(blob);
		const enlace = document.createElement('a');
		enlace.href = url;
		enlace.download = nombre;
		enlace.click();
		URL.revokeObjectURL(url);
	}
};

/**
 * Ubicaciones para la sección Mapas.
 *
 * El navegador nunca llama a un geocodificador: le pide al servidor las
 * direcciones que ya están resueltas. Geocodificar tiene cupo por segundo,
 * puede costar dinero y necesita una clave que no debe viajar hasta aquí.
 */
/**
 * Inspección de viviendas afectadas (formato NGRD).
 *
 * El censo dice quién quedó afectado; esto evalúa la vivienda y determina qué
 * materiales le corresponden. Van por su propio prefijo y no bajo `/rufe`
 * porque son documentos distintos con permisos y ciclos de vida distintos.
 *
 * Las fotos del numeral 11 reutilizan `rufeApi.abrirCarga`: la maquinaria de
 * subida es la misma y el servidor decide a qué expediente adopta la carga
 * según por dónde llegue el envío.
 */
export const inspeccionApi = {
	catalogos: () => api.get<CatalogosInspeccion>('/inspeccion/catalogos'),
	enviar: (cuerpo: Record<string, unknown>) =>
		api.post<{ numero: string; recibido_en: string; combo: string | null; combo_motivo: string | null; reintento?: boolean }>(
			'/inspeccion/fichas',
			cuerpo
		),

	/** ¿Ya se inspeccionó esta vivienda? Avisa, no impide: puede ser legítimo. */
	duplicados: (documento: string) =>
		api.get<{ inspecciones: { numero: string; fecha_evaluacion: string; combo: string | null; cumple_requisitos: number }[] }>(
			`/inspeccion/duplicados?documento=${encodeURIComponent(documento)}`
		),

	listar: (filtros: Record<string, string | number> = {}) => {
		const p = new URLSearchParams();
		for (const [clave, valor] of Object.entries(filtros)) {
			if (valor !== undefined && valor !== '') p.set(clave, String(valor));
		}
		const consulta = p.toString();

		return api.get<{
			inspecciones: Record<string, unknown>[];
			total: number;
			pagina: number;
			por_pagina: number;
		}>(`/inspeccion/fichas${consulta ? `?${consulta}` : ''}`);
	},
	ver: (id: number) => api.get<DetalleInspeccion>(`/inspeccion/fichas/${id}`),

	/**
	 * Las fotos del numeral 11, por el mismo camino que las del censo: viven
	 * fuera del docroot y solo salen con el token en una cabecera, algo que una
	 * etiqueta `<img>` no sabe enviar.
	 */
	async verEvidencia(inspeccionId: number, fotoId: number): Promise<string> {
		const respuesta = await fetch(`${API_BASE}/inspeccion/fichas/${inspeccionId}/fotos/${fotoId}`, {
			headers: { Authorization: `Bearer ${leerToken() ?? ''}` }
		});

		if (!respuesta.ok) throw new Error('No se pudo abrir la imagen.');

		return URL.createObjectURL(await respuesta.blob());
	},

	async descargarEvidencia(inspeccionId: number, fotoId: number, nombre: string): Promise<void> {
		const respuesta = await fetch(`${API_BASE}/inspeccion/fichas/${inspeccionId}/fotos/${fotoId}`, {
			headers: { Authorization: `Bearer ${leerToken() ?? ''}` }
		});

		if (!respuesta.ok) throw new Error('No se pudo descargar el archivo.');

		const url = URL.createObjectURL(await respuesta.blob());
		const enlace = document.createElement('a');
		enlace.href = url;
		enlace.download = nombre;
		enlace.click();
		URL.revokeObjectURL(url);
	},
	cambiarEstado: (id: number, estado: string, nota: string) =>
		api.put<{ estado: string }>(`/inspeccion/fichas/${id}/estado`, { estado, nota })
};

/**
 * Pre-inscripción ciudadana.
 *
 * Las dos primeras llamadas van SIN token: las hace alguien que no tiene cuenta.
 * `api.get`/`api.post` aceptan `autenticada = false` justo para esto.
 *
 * No hay ninguna función para consultar una solicitud: no existe esa ruta en el
 * servidor y no debe existir. Un endpoint público que devolviera solicitudes por
 * radicado sería un buscador de damnificados.
 */
export const preinscripcionApi = {
	catalogos: () =>
		api.get<{
			corregimientos: string[];
			zonas: string[];
			/** Las señales de daño que el ciudadano puede reconocer a ojo. */
			senales: { codigo: string; etiqueta: string; ayuda: string; icono: string }[];
			aviso_version: string;
			limites: {
				fotos_dano: number;
				fotos_cedula: number;
				bytes_archivo: number;
				bytes_carga: number;
				objetivo_bytes_foto: number;
				extensiones: string[];
			};
			categorias_video: {
				id: number;
				nombre: string;
				instruccion: string | null;
				obligatoria: boolean;
				segundos_min: number;
				segundos_max: number;
			}[];
			video: { bytes_trozo: number; max_bytes: number; max_videos: number };
		}>('/preinscripcion/catalogos', false),

	/** Abre una carga para las fotos, sin sesión. */
	abrirCarga: () =>
		api.post<{ carga: string; maximo_archivos: number; maximo_bytes: number }>(
			'/preinscripcion/cargas',
			{},
			false
		),

	enviar: (cuerpo: Record<string, unknown>) =>
		api.post<{
			radicado: string;
			recibido_en: string;
			reintento?: boolean;
			duplicada?: boolean;
			/** Fotos y videos del reenvío que se sumaron a la solicitud que ya existía. */
			archivos_agregados?: number;
		}>(
			'/preinscripcion',
			cuerpo,
			false
		),

	// ── Bandeja interna (con sesión) ──────────────────────────────────────
	listar: (filtros: Record<string, string | number> = {}) => {
		const p = new URLSearchParams();
		for (const [clave, valor] of Object.entries(filtros)) {
			if (valor !== undefined && valor !== '') p.set(clave, String(valor));
		}
		const consulta = p.toString();

		return api.get<{
			preinscripciones: Record<string, unknown>[];
			total: number;
			pagina: number;
			por_pagina: number;
		}>(`/preinscripcion/fichas${consulta ? `?${consulta}` : ''}`);
	},

	ver: (id: number) => api.get<PreinscripcionDetalle>(`/preinscripcion/fichas/${id}`),

	/** Las fotos viven fuera del docroot y solo salen con el token en la cabecera. */
	async verEvidencia(preinscripcionId: number, fotoId: number): Promise<string> {
		const respuesta = await fetch(
			`${API_BASE}/preinscripcion/fichas/${preinscripcionId}/fotos/${fotoId}`,
			{ headers: { Authorization: `Bearer ${leerToken() ?? ''}` } }
		);

		if (!respuesta.ok) throw new Error('No se pudo abrir la imagen.');

		return URL.createObjectURL(await respuesta.blob());
	},

	async descargarEvidencia(preinscripcionId: number, fotoId: number, nombre: string): Promise<void> {
		const respuesta = await fetch(
			`${API_BASE}/preinscripcion/fichas/${preinscripcionId}/fotos/${fotoId}`,
			{ headers: { Authorization: `Bearer ${leerToken() ?? ''}` } }
		);

		if (!respuesta.ok) throw new Error('No se pudo descargar el archivo.');

		const url = URL.createObjectURL(await respuesta.blob());
		const enlace = document.createElement('a');
		enlace.href = url;
		enlace.download = nombre;
		enlace.click();
		URL.revokeObjectURL(url);
	},

	cambiarEstado: (id: number, estado: string, nota: string) =>
		api.put<{ estado: string }>(`/preinscripcion/fichas/${id}/estado`, { estado, nota }),

	/** Irreversible: borra la ficha, sus fotos y sus videos. Solo Administrador. */
	eliminar: (id: number, motivo: string) =>
		api.delete<{ mensaje: string; archivos_borrados: number }>(
			`/preinscripcion/fichas/${id}`,
			{ motivo }
		),

	/**
	 * Un video de la solicitud, para verlo en la bandeja.
	 *
	 * Igual que las fotos: vive fuera del docroot y solo sale con el token en la
	 * cabecera, algo que una etiqueta `<video src>` no sabe enviar.
	 */
	async verVideo(preinscripcionId: number, videoId: number): Promise<string> {
		const respuesta = await fetch(
			`${API_BASE}/preinscripcion/fichas/${preinscripcionId}/videos/${videoId}`,
			{ headers: { Authorization: `Bearer ${leerToken() ?? ''}` } }
		);

		if (!respuesta.ok) throw new Error('No se pudo abrir el video.');

		return URL.createObjectURL(await respuesta.blob());
	}
};

export type PreinscripcionDetalle = {
	preinscripcion: Record<string, string | number | null>;
	fotos: { id: number; nombre_original: string; extension: string; tamano_bytes: number; mime: string }[];
	/**
	 * Lo que el ciudadano marcó, con la etiqueta que vio en su momento.
	 *
	 * El `icono` NO viene guardado: lo resuelve el servidor contra el catálogo
	 * de hoy. La etiqueta prueba qué se le mostró y queda congelada; el dibujo
	 * es solo la forma de enseñárselo a quien revisa.
	 */
	senales: { codigo: string; etiqueta: string; icono: string }[];
	videos: {
		id: number;
		categoria_nombre: string;
		segundos: number | null;
		tamano_bytes: number;
		extension: string;
		mime: string;
		/** Falso cuando el archivo ya se purgó al decidir la solicitud. */
		disponible: boolean;
	}[];
	historial: { estado: string; nota: string | null; usuario_email: string | null; creado_en: string }[];
};

export type CategoriaVideo = {
	id: number;
	nombre: string;
	instruccion: string | null;
	orden: number;
	obligatoria: boolean;
	segundos_min: number;
	segundos_max: number;
	activa: boolean;
};

/** Catálogo de categorías de video. Solo administración. */
export const categoriasVideoApi = {
	listar: () =>
		api.get<{ categorias: CategoriaVideo[]; maximo_obligatorias: number }>('/admin/categorias-video'),

	crear: (datos: Partial<CategoriaVideo>) =>
		api.post<{ categoria: CategoriaVideo }>('/admin/categorias-video', datos),

	actualizar: (id: number, datos: Partial<CategoriaVideo>) =>
		api.put<{ categoria: CategoriaVideo }>(`/admin/categorias-video/${id}`, datos),

	cambiarEstado: (id: number, activa: boolean) =>
		api.put<{ categoria: CategoriaVideo }>(`/admin/categorias-video/${id}/estado`, { activa }),

	reordenar: (orden: number[]) =>
		api.put<{ categorias: CategoriaVideo[] }>('/admin/categorias-video/orden', { orden }),

	eliminar: (id: number) => api.delete<void>(`/admin/categorias-video/${id}`)
};

export const mapaApi = {
	fichas: () => api.get<{ fichas: FichaMapa[] }>('/mapa/fichas'),

	ubicaciones: (direcciones: string[]) =>
		api.post<{
			ubicaciones: Record<string, Ubicacion>;
			consultadas: number;
			pendientes: number;
			descartadas: number;
		}>('/mapa/ubicaciones', { direcciones }),

	estado: () =>
		api.get<{
			por_precision: Record<string, number>;
			pendientes: number;
			lote: number;
			google_activo: boolean;
			segundos_por_direccion: number;
		}>('/mapa/estado'),

	geocodificar: () =>
		api.post<{ procesadas: number; ubicadas: number; sin_ubicar: number; pendientes: number }>(
			'/mapa/geocodificar',
			{}
		),

	reubicar: () =>
		api.post<{ reencoladas: number; conservadas: number }>('/mapa/reubicar', {}),

	corregir: (clave: string, latitud: number, longitud: number) =>
		api.put<{ clave: string }>(`/mapa/ubicaciones/${clave}`, { latitud, longitud })
};
