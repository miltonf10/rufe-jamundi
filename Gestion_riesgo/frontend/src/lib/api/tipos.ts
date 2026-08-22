import type { Rol } from '$lib/navigation';

export type Usuario = {
	id: number;
	nombre: string;
	email: string;
	rol: Rol;
	rol_etiqueta: string;
	activo: boolean;
	ultimo_acceso: string | null;
	creado_en: string;
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

export type UsuarioSesion = {
	id: number;
	nombre: string;
	email: string;
	rol: Rol;
	capacidades: string[];
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

export type RolCatalogo = {
	valor: Rol;
	etiqueta: string;
	descripcion: string;
	capacidades: string[];
};

export type Modulo = {
	nombre: string;
	descripcion: string;
	roles: string[];
};

export type InfoSistema = {
	aplicacion: {
		nombre: string;
		version: string;
		entorno: string;
		entidad: string;
		dependencia: string;
		descripcion: string;
	};
	modulos: Modulo[];
	roles: RolCatalogo[];
	tecnologia: { capa: string; detalle: string }[];
	estado: {
		base_datos: { conectada: boolean; nombre: string };
		php: string;
		zona_horaria: string;
		hora_servidor: string;
		usuarios_activos: number;
		sesiones_activas: number;
	};
	repositorio: { owner: string; repo: string; branch: string; url: string };
};

export type Commit = {
	sha: string;
	sha_corto: string;
	titulo: string;
	descripcion: string;
	autor_nombre: string;
	autor_login: string | null;
	autor_avatar: string | null;
	fecha: string;
	url: string;
	/** Frente del que proviene: "Tablero RUFE" o "Plataforma". */
	fuente: string;
	equipo_clave: string;
	equipo_nombre: string;
	equipo_rol: string;
};

export type Fuente = {
	etiqueta: string;
	branch: string;
	url: string;
};

export type ResumenAutor = {
	clave: string;
	nombre: string;
	rol: string;
	login: string | null;
	avatar: string | null;
	total: number;
	ultima_fecha: string | null;
};

export type Actualizaciones = {
	repositorio: { owner: string; repo: string; branch: string; url: string };
	fuentes: Fuente[];
	commits: Commit[];
	autores: ResumenAutor[];
	total: number;
	desde_cache: boolean;
	error: string | null;
	consultado_en: string;
};
