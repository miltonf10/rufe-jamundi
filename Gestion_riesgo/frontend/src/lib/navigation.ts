// Navegación — fuente única de verdad para el menú lateral, el título de la
// barra superior y la guardia de rutas.
//
// Está en un solo archivo a propósito: cuando la visibilidad del menú y el
// control de acceso viven en sitios distintos, terminan desincronizados y
// aparece un enlace que lleva a una pantalla de "no autorizado".
//
// Cada elemento hoja lleva:
//   • id        identificador estable
//   • label     texto del menú
//   • title     título que muestra la barra superior
//   • href      ruta canónica
//   • icon      componente de @lucide/svelte
//   • parentId  id del grupo al que pertenece (opcional)
//   • roles     roles que pueden verlo
//   • match     rutas que lo marcan como activo. Las cadenas se comparan
//               exactas para que un hijo más específico gane siempre sobre su
//               padre; usa expresión regular para rutas con parámetros.

import {
	LayoutDashboard,
	Users,
	ShieldCheck,
	Info,
	ClipboardList,
	ClipboardPlus,
	Map as IconoMapa,
	MapPinned,
	CloudOff,
	FilePlus2,
	FileText,
	HardHat,
	ClipboardCheck,
	Inbox,
	Video
} from '@lucide/svelte';
import type { Component } from 'svelte';

/**
 * Rutas que se sirven sin sesión: el login y la pre-inscripción ciudadana.
 *
 * La lista existe para que añadir una ruta pública sea una decisión visible y
 * deliberada, en un solo archivo, y no un `if` escondido en el layout. Cada
 * entrada amplía lo que un desconocido puede abrir.
 *
 * Estas rutas se dibujan sin el armazón: ni menú lateral, ni barra superior.
 *
 * `/preinscripcion` es la excepción deliberada a «todo exige sesión»: la abre un
 * ciudadano que no tiene cuenta ni va a tenerla. Por eso solo ESCRIBE una
 * solicitud —nunca consulta nada— y el servidor la protege con límite por IP,
 * trampa antirrobot e idempotencia.
 */
export const RUTAS_PUBLICAS: string[] = ['/login', '/preinscripcion'];

export function esRutaPublica(ruta: string): boolean {
	return RUTAS_PUBLICAS.includes(ruta);
}

/**
 * Rutas que siguen funcionando sin conexión, con la sesión guardada en el
 * teléfono y sin que el servidor la haya confirmado.
 *
 * Son las del trabajo de campo: levantar una ficha del censo, vigilar las que
 * aún no salieron e inspeccionar una vivienda. Las tres trabajan contra el
 * teléfono —los formularios, sus catálogos guardados y la cola en IndexedDB—,
 * así que sin señal tienen todo lo que necesitan.
 *
 * El resto del sistema lee del servidor: el tablero, la bandeja, el mapa y la
 * administración no tendrían nada que mostrar. Ahí se avisa, en vez de fingir.
 *
 * La lista vive aquí, junto a `RUTAS_PUBLICAS`, por la misma razón: ampliar lo
 * que se abre sin comprobar contra el servidor debe ser una decisión visible en
 * un solo archivo, no un `if` escondido en el layout.
 */
export const RUTAS_SIN_CONEXION: string[] = [
	'/riesgo/reportar',
	'/riesgo/pendientes',
	// La inspección también se levanta en campo, y su formato viaja entero en
	// los catálogos —criterios del Anexo 1 y materiales del Anexo 2 incluidos—
	// justamente para que no haga falta señal.
	'/riesgo/inspeccionar'
];

export function funcionaSinConexion(ruta: string): boolean {
	return RUTAS_SIN_CONEXION.includes(ruta);
}

export const ROLES = {
	ADMINISTRADOR: 'ADMINISTRADOR',
	GESTOR: 'GESTOR',
	/** El profesional que evalúa las viviendas. Solo alcanza su formato. */
	INSPECTOR: 'INSPECTOR',
	VISUALIZACION: 'VISUALIZACION'
} as const;

export type Rol = (typeof ROLES)[keyof typeof ROLES];

/**
 * Cualquier persona autenticada.
 *
 * OJO: ya no sirve para proteger lo que muestra datos del censo. Desde que
 * existe el inspector —que no debe ver fichas de hogares damnificados— eso es
 * `LECTURA_RUFE`. Es la misma distinción que hace `Auth` en el servidor, que es
 * quien manda.
 */
export const TODOS: Rol[] = [ROLES.ADMINISTRADOR, ROLES.GESTOR, ROLES.INSPECTOR, ROLES.VISUALIZACION];
/** Quienes pueden escribir datos del censo y decidir sobre las fichas. */
export const ESCRITURA: Rol[] = [ROLES.ADMINISTRADOR, ROLES.GESTOR];
/** Quienes pueden consultar el censo y el mapa. */
export const LECTURA_RUFE: Rol[] = [ROLES.ADMINISTRADOR, ROLES.GESTOR, ROLES.VISUALIZACION];
/** Quienes levantan y consultan inspecciones de vivienda. */
export const INSPECCION: Rol[] = [ROLES.ADMINISTRADOR, ROLES.GESTOR, ROLES.INSPECTOR];
/** Solo administración. */
export const SOLO_ADMIN: Rol[] = [ROLES.ADMINISTRADOR];

export const ETIQUETA_ROL: Record<Rol, string> = {
	ADMINISTRADOR: 'Administrador',
	GESTOR: 'Gestor',
	INSPECTOR: 'Insp. de vivienda',
	VISUALIZACION: 'Visualización'
};

export type NavItem = {
	id: string;
	type: 'item' | 'group';
	label: string;
	title?: string;
	href?: string;
	icon?: Component;
	parentId?: string;
	roles: Rol[];
	match?: (string | RegExp)[];
};

export const NAV_ITEMS: NavItem[] = [
	// El tablero del RUFE es la única pantalla operativa del sistema hoy, así
	// que va suelta en el primer nivel y no dentro de un grupo.
	{
		id: 'dashboard',
		type: 'item',
		label: 'Dashboard',
		title: 'Tablero RUFE — Sismo Jamundí',
		href: '/dashboard',
		icon: LayoutDashboard,
		roles: LECTURA_RUFE,
		match: ['/dashboard']
	},

	// «Registro» agrupa los dos formatos que se levantan en campo y la cola local.
	// Separar la cola de la captura evita que la pantalla del formulario tenga que
	// hacer dos trabajos: levantar una ficha nueva y vigilar las que no salieron.
	//
	// Los formatos van primero y con su código oficial, que es como los nombra el
	// equipo; «Pendientes» cierra el grupo porque no es un formato, es el estado de
	// lo ya levantado.
	{
		id: 'grupo-registro',
		type: 'group',
		label: 'Registro',
		icon: ClipboardPlus,
		// El grupo se muestra a quien pueda ver alguno de sus hijos; el inspector
		// solo verá la inspección y Pendientes.
		roles: INSPECCION
	},
	{
		id: 'captura-rufe',
		type: 'item',
		parentId: 'grupo-registro',
		label: 'RUFE FR-1703-SMD-69',
		// El título de la barra superior sigue siendo el descriptivo: a esa pantalla
		// también se llega por un enlace directo, sin haber pasado por el menú, y un
		// encabezado que solo dijera el código no le diría nada a quien llega así.
		title: 'Registro Unifamiliar de Emergencias — captura en campo',
		href: '/riesgo/reportar',
		icon: FilePlus2,
		roles: ESCRITURA,
		match: ['/riesgo/reportar']
	},
	{
		id: 'inspeccionar',
		type: 'item',
		parentId: 'grupo-registro',
		label: 'INSP DE VIVIENDA',
		title: 'Inspección de viviendas afectadas — banco de materiales',
		href: '/riesgo/inspeccionar',
		icon: HardHat,
		roles: INSPECCION,
		match: ['/riesgo/inspeccionar']
	},
	{
		id: 'pendientes-rufe',
		type: 'item',
		parentId: 'grupo-registro',
		label: 'Pendientes',
		title: 'Fichas pendientes de enviar',
		href: '/riesgo/pendientes',
		icon: CloudOff,
		// La cola es de los dos formatos: sin ella, quien inspecciona no sabe si
		// su trabajo salió del teléfono.
		roles: INSPECCION,
		match: ['/riesgo/pendientes']
	},

	// «Reportes» es el espejo de «Registro»: los mismos dos formatos, con los
	// mismos nombres, pero para consultar lo ya registrado en vez de levantarlo.
	// Que la pareja se repita a un lado y al otro es la intención, no un descuido:
	// quien busca una inspección la encuentra escrita igual en los dos sitios.
	//
	// El grupo es de lectura para los tres roles, no solo para quien escribe:
	// Visualización es justamente el rol que más consulta reportes.
	{
		id: 'grupo-reportes',
		type: 'group',
		label: 'Reportes',
		icon: ClipboardList,
		roles: TODOS
	},
	{
		id: 'reportes-rufe',
		type: 'item',
		parentId: 'grupo-reportes',
		label: 'RUFE FR-1703-SMD-69',
		title: 'Fichas RUFE registradas',
		href: '/riesgo/reportes',
		icon: FileText,
		roles: LECTURA_RUFE,
		match: ['/riesgo/reportes', /^\/riesgo\/reportes\/[^/]+$/]
	},
	{
		id: 'preinscripciones',
		type: 'item',
		parentId: 'grupo-reportes',
		label: 'Solicitudes ciudadanas',
		title: 'Pre-inscripciones recibidas',
		href: '/riesgo/preinscripciones',
		icon: Inbox,
		// Lectura del censo: son solicitudes con nombre, cédula y dirección de
		// familias. El profesional que inspecciona no las necesita.
		roles: LECTURA_RUFE,
		match: ['/riesgo/preinscripciones', /^\/riesgo\/preinscripciones\/[^/]+$/]
	},
	{
		id: 'inspecciones',
		type: 'item',
		parentId: 'grupo-reportes',
		label: 'INSP DE VIVIENDA',
		title: 'Inspecciones de vivienda registradas',
		href: '/riesgo/inspecciones',
		icon: ClipboardCheck,
		// Todos, incluido Visualización: es el rol que supervisa, y estas fichas
		// sustentan una entrega de recursos públicos.
		roles: TODOS,
		match: ['/riesgo/inspecciones', /^\/riesgo\/inspecciones\/[^/]+$/]
	},

	// Fuera del grupo «Registro» y con el mismo rol que Reportes: el mapa se
	// consulta, no se levanta. Meterlo dentro de un grupo restringido a escritura
	// se lo escondería a quien solo tiene Visualización, que es justamente quien
	// más lo mira.
	{
		id: 'mapas',
		type: 'item',
		label: 'Mapas',
		title: 'Mapa de la afectación',
		href: '/riesgo/mapas',
		icon: IconoMapa,
		roles: LECTURA_RUFE,
		match: ['/riesgo/mapas']
	},

	{
		id: 'grupo-admin',
		type: 'group',
		label: 'Administración',
		icon: ShieldCheck,
		roles: SOLO_ADMIN
	},
	{
		id: 'usuarios',
		type: 'item',
		parentId: 'grupo-admin',
		label: 'Usuarios del sistema',
		title: 'Gestión de usuarios del sistema',
		href: '/admin/usuarios',
		icon: Users,
		roles: SOLO_ADMIN,
		match: ['/admin/usuarios', /^\/admin\/usuarios\/[^/]+$/]
	},
	{
		id: 'admin-mapas',
		type: 'item',
		parentId: 'grupo-admin',
		label: 'Ubicaciones del mapa',
		title: 'Ubicación de las direcciones del censo',
		href: '/admin/mapas',
		icon: MapPinned,
		roles: SOLO_ADMIN,
		match: ['/admin/mapas']
	},

	{
		id: 'categorias-video',
		type: 'item',
		parentId: 'grupo-admin',
		label: 'Videos que se piden',
		title: 'Categorías de video de la pre-inscripción',
		href: '/admin/categorias-video',
		icon: Video,
		roles: SOLO_ADMIN,
		match: ['/admin/categorias-video']
	},

	{
		id: 'acerca',
		type: 'item',
		label: 'Acerca de',
		title: 'Acerca del sistema',
		href: '/acerca',
		icon: Info,
		roles: TODOS,
		match: ['/acerca']
	}
];

function coincide(patron: string | RegExp, ruta: string): boolean {
	return typeof patron === 'string' ? ruta === patron : patron.test(ruta);
}

export function esActivo(item: NavItem, ruta: string): boolean {
	return (item.match ?? []).some((p) => coincide(p, ruta));
}

/**
 * El elemento más específico que coincide con la ruta: gana la coincidencia
 * exacta más larga y, si no hay ninguna, la primera expresión regular. Así una
 * ruta hija nunca deja activo también a su padre.
 */
export function resolverActivo(ruta: string): NavItem | null {
	let mejor: NavItem | null = null;
	let mejorLargo = -1;
	let primeraRegex: NavItem | null = null;

	for (const item of NAV_ITEMS) {
		if (item.type === 'group') continue;
		for (const p of item.match ?? []) {
			if (typeof p === 'string') {
				if (ruta === p && p.length > mejorLargo) {
					mejorLargo = p.length;
					mejor = item;
				}
			} else if (p.test(ruta) && !primeraRegex) {
				primeraRegex = item;
			}
		}
	}

	return mejor ?? primeraRegex;
}

export function resolverTitulo(ruta: string): string {
	const item = resolverActivo(ruta);

	return item?.title ?? item?.label ?? 'Sistema de Gestión del Riesgo';
}

export type Seccion =
	| { type: 'item'; item: NavItem }
	| { type: 'group'; group: NavItem; items: NavItem[] };

/** Árbol que dibuja el menú, ya filtrado por el rol de quien mira. */
export function menuParaRol(rol: Rol | null): Seccion[] {
	if (!rol) return [];

	const visibles = NAV_ITEMS.filter((i) => i.roles.includes(rol));
	const grupos = new Map<string, Seccion & { type: 'group' }>();
	const salida: Seccion[] = [];

	for (const item of visibles) {
		if (item.type === 'group') {
			const seccion = { type: 'group' as const, group: item, items: [] as NavItem[] };
			grupos.set(item.id, seccion);
			salida.push(seccion);
		} else if (item.parentId) {
			grupos.get(item.parentId)?.items.push(item);
		} else {
			salida.push({ type: 'item', item });
		}
	}

	// Un grupo sin hijos visibles para este rol no se dibuja.
	return salida.filter((s) => s.type !== 'group' || s.items.length > 0);
}

/**
 * ¿Este rol puede entrar a esta ruta? Se deriva del mismo registro que el menú,
 * así que ocultar un enlace y bloquear su ruta son siempre la misma decisión.
 * Las rutas no registradas (login, raíz) se permiten.
 */
export function puedeAcceder(ruta: string, rol: Rol | null): boolean {
	if (!rol) return false;
	const item = resolverActivo(ruta);
	if (!item) return true;

	return item.roles.includes(rol);
}
