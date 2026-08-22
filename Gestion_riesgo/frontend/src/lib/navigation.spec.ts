// El control de acceso del navegador. No es la seguridad real —esa la aplica el
// router de PHP— pero sí decide qué ve cada rol, y una entrada mal registrada
// aquí muestra un enlace que lleva a una pantalla prohibida.

import { describe, expect, it } from 'vitest';
import {
	NAV_ITEMS,
	RUTAS_PUBLICAS,
	RUTAS_SIN_CONEXION,
	esRutaPublica,
	funcionaSinConexion,
	menuParaRol,
	puedeAcceder,
	resolverTitulo,
	type Rol
} from './navigation';

describe('rutas públicas', () => {
	it('solo el login y la pre-inscripción se sirven sin sesión', () => {
		// Cada entrada de esta lista amplía lo que un desconocido puede abrir.
		// Que ampliarla obligue a tocar esta prueba es justo la intención.
		expect(RUTAS_PUBLICAS).toEqual(['/login', '/preinscripcion']);
	});

	it('la pre-inscripción es pública; la bandeja que la revisa, no', () => {
		expect(esRutaPublica('/preinscripcion')).toBe(true);
		expect(esRutaPublica('/riesgo/preinscripciones')).toBe(false);
	});

	it('el formulario RUFE ya no es público', () => {
		expect(esRutaPublica('/riesgo/reportar')).toBe(false);
	});

	it('ninguna ruta de riesgo es pública', () => {
		for (const r of ['/riesgo/reportar', '/riesgo/reportes', '/riesgo/reportes/1']) {
			expect(esRutaPublica(r)).toBe(false);
		}
	});
});

describe('acceso al formulario de captura', () => {
	it('un administrador entra', () => {
		expect(puedeAcceder('/riesgo/reportar', 'ADMINISTRADOR')).toBe(true);
	});

	it('un gestor entra', () => {
		expect(puedeAcceder('/riesgo/reportar', 'GESTOR')).toBe(true);
	});

	it('un rol de solo visualización NO entra', () => {
		expect(puedeAcceder('/riesgo/reportar', 'VISUALIZACION')).toBe(false);
	});

	it('sin sesión no entra nadie', () => {
		expect(puedeAcceder('/riesgo/reportar', null)).toBe(false);
	});

	it('Pendientes tiene el mismo control que el formulario', () => {
		expect(puedeAcceder('/riesgo/pendientes', 'GESTOR')).toBe(true);
		expect(puedeAcceder('/riesgo/pendientes', 'ADMINISTRADOR')).toBe(true);
		expect(puedeAcceder('/riesgo/pendientes', 'VISUALIZACION')).toBe(false);
		expect(puedeAcceder('/riesgo/pendientes', null)).toBe(false);
	});

	// puedeAcceder() permite por omisión las rutas que no conoce: si la entrada
	// desapareciera del registro, el formulario quedaría abierto a cualquier rol
	// autenticado sin que nada más lo delatara.
	it('la ruta está registrada en el menú, no cae en el permiso por omisión', () => {
		const item = NAV_ITEMS.find((i) => i.href === '/riesgo/reportar');
		expect(item).toBeDefined();
		expect(item?.roles).toEqual(['ADMINISTRADOR', 'GESTOR']);
		expect(item?.parentId).toBe('grupo-registro');
	});
});

describe('la bandeja sigue siendo de lectura para todos', () => {
	it('los tres roles pueden consultarla', () => {
		for (const rol of ['ADMINISTRADOR', 'GESTOR', 'VISUALIZACION'] as const) {
			expect(puedeAcceder('/riesgo/reportes', rol)).toBe(true);
			expect(puedeAcceder('/riesgo/reportes/42', rol)).toBe(true);
		}
	});
});

describe('menú por rol', () => {
	function etiquetas(rol: Rol) {
		return menuParaRol(rol).flatMap((s) =>
			s.type === 'item' ? [s.item.label] : s.items.map((i) => i.label)
		);
	}

	/** Los grupos que ve un rol, en el orden en que se dibujan. */
	function grupos(rol: Rol) {
		return menuParaRol(rol)
			.filter((s) => s.type === 'group')
			.map((s) => (s.type === 'group' ? s.group.label : ''));
	}

	it('el visor no ve el enlace de registrar', () => {
		expect(grupos('VISUALIZACION')).not.toContain('Registro');
		expect(etiquetas('VISUALIZACION')).not.toContain('Pendientes');
	});

	it('el gestor sí lo ve, y no ve administración', () => {
		expect(etiquetas('GESTOR')).toContain('RUFE FR-1703-SMD-69');
		expect(etiquetas('GESTOR')).toContain('Pendientes');
		expect(etiquetas('GESTOR')).not.toContain('Usuarios del sistema');
	});

	it('el administrador lo ve todo', () => {
		const e = etiquetas('ADMINISTRADOR');
		expect(e).toContain('RUFE FR-1703-SMD-69');
		expect(e).toContain('INSP DE VIVIENDA');
		expect(e).toContain('Pendientes');
		expect(e).toContain('Usuarios del sistema');
		expect(grupos('ADMINISTRADOR')).toEqual(['Registro', 'Reportes', 'Administración']);
	});

	it('dentro de Registro, los dos formatos van antes que Pendientes', () => {
		// El orden es el del arreglo, y es lo que pidió el equipo: primero lo que se
		// diligencia, al final el estado de lo ya diligenciado.
		const registro = menuParaRol('GESTOR').find(
			(s) => s.type === 'group' && s.group.id === 'grupo-registro'
		);

		expect(registro?.type === 'group' && registro.items.map((i) => i.href)).toEqual([
			'/riesgo/reportar',
			'/riesgo/inspeccionar',
			'/riesgo/pendientes'
		]);
	});

	// Un grupo nuevo con los roles equivocados no rompe nada visible: simplemente
	// le esconde los reportes justo al rol que más los consulta.
	it('Visualización ve el grupo Reportes completo', () => {
		const reportes = menuParaRol('VISUALIZACION').find(
			(s) => s.type === 'group' && s.group.id === 'grupo-reportes'
		);

		expect(reportes?.type === 'group' && reportes.items.map((i) => i.href)).toEqual([
			'/riesgo/reportes',
			'/riesgo/preinscripciones',
			'/riesgo/inspecciones'
		]);
	});

	it('los dos formatos se llaman igual al registrarlos que al consultarlos', () => {
		// La repetición es deliberada: quien busca una inspección la encuentra
		// escrita igual en los dos sitios. Si alguien renombra uno solo, esto avisa.
		const por = (id: string) => NAV_ITEMS.find((i) => i.id === id)?.label;

		expect(por('captura-rufe')).toBe(por('reportes-rufe'));
		expect(por('inspeccionar')).toBe(por('inspecciones'));
	});

	// ── El inspector de vivienda ─────────────────────────────────────────────
	//
	// Lo que está en juego: las fichas del censo llevan nombres, cédulas y
	// direcciones de hogares damnificados. El profesional que inspecciona
	// —a menudo un contratista externo— no las necesita para su trabajo. Estas
	// pruebas escriben a mano lo que ve, para que ampliarlo sea una decisión y
	// no un descuido.

	it('el inspector ve exactamente su formato, la cola y sus fichas', () => {
		// Sin «Solicitudes ciudadanas»: llevan nombre, cédula y dirección de
		// familias que aún no son caso suyo.
		expect(etiquetas('INSPECTOR')).toEqual([
			'INSP DE VIVIENDA',
			'Pendientes',
			'INSP DE VIVIENDA',
			'Acerca de'
		]);
	});

	it('el inspector no ve nada del censo, ni el mapa, ni el tablero', () => {
		const e = etiquetas('INSPECTOR');

		expect(e).not.toContain('RUFE FR-1703-SMD-69');
		expect(e).not.toContain('Dashboard');
		expect(e).not.toContain('Mapas');
		expect(e).not.toContain('Usuarios del sistema');
	});

	it('las rutas del censo le están cerradas también a él', () => {
		// El menú es cortesía; esto es lo que decide la guardia de rutas. El
		// permiso de verdad lo aplica PHP, pero si esto se abriera, el navegador
		// dejaría entrar a una pantalla que luego muestra un error.
		for (const ruta of [
			'/dashboard',
			'/riesgo/reportes',
			'/riesgo/reportes/1',
			'/riesgo/mapas',
			'/riesgo/preinscripciones'
		]) {
			expect(puedeAcceder(ruta, 'INSPECTOR'), ruta).toBe(false);
		}
	});

	it('las suyas sí', () => {
		for (const ruta of ['/riesgo/inspeccionar', '/riesgo/pendientes', '/riesgo/inspecciones']) {
			expect(puedeAcceder(ruta, 'INSPECTOR'), ruta).toBe(true);
		}
	});

	it('sin rol el menú queda vacío', () => {
		expect(menuParaRol(null)).toEqual([]);
	});
});

describe('títulos', () => {
	it('cada ruta registrada resuelve a su título', () => {
		expect(resolverTitulo('/riesgo/reportar')).toBe(
			'Registro Unifamiliar de Emergencias — captura en campo'
		);
		expect(resolverTitulo('/riesgo/pendientes')).toBe('Fichas pendientes de enviar');
		expect(resolverTitulo('/riesgo/reportes')).toBe('Fichas RUFE registradas');
	});
});

describe('rutas que funcionan sin conexión', () => {
	it('son exactamente las del trabajo de campo', () => {
		// Ampliar esta lista abre una pantalla sin que el servidor haya confirmado
		// la sesión. Que obligue a tocar la prueba es justamente la intención: la
		// inspección se sumó a conciencia, porque su formato entero —criterios del
		// Anexo 1 y materiales del Anexo 2— viaja en los catálogos guardados.
		expect(RUTAS_SIN_CONEXION).toEqual([
			'/riesgo/reportar',
			'/riesgo/pendientes',
			'/riesgo/inspeccionar'
		]);
	});

	it('las secciones que leen del servidor no están', () => {
		for (const ruta of [
			'/dashboard',
			'/riesgo/reportes',
			'/riesgo/inspecciones',
			'/riesgo/mapas',
			'/admin/usuarios'
		]) {
			expect(funcionaSinConexion(ruta)).toBe(false);
		}
	});

	it('toda ruta sin conexión existe en el menú', () => {
		// Una entrada mal escrita aquí no rompería nada visible: simplemente el
		// censador se encontraría con «necesita conexión» en plena vereda.
		for (const ruta of RUTAS_SIN_CONEXION) {
			expect(NAV_ITEMS.some((i) => i.href === ruta)).toBe(true);
		}
	});
});
