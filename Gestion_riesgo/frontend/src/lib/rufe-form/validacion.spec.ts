// Espejo, caso por caso, de la matriz de condicionales del plan (C1..C12) y de
// backend/tests/run.php. Si un día las dos validaciones se separan, uno de los
// dos conjuntos falla y se nota antes de llegar a producción.

import { describe, expect, it } from 'vitest';
import { validarTodo, validarPersona, validarRenglonAgro, fechaExiste, pasoDelError, soloDigitos, telefonoValido, correoValido, aISO, hoy } from './validacion';
import { formularioVacio, personaVacia, renglonAgroVacio } from './esquema';
import type { Catalogos, FormularioRufe, Persona } from './tipos';

// Catálogo con los códigos reales del formato FR-1703-SMD-69.
const CATALOGOS: Catalogos = {
	formato: { codigo: 'FR-1703-SMD-69', version: '01', aviso_version: 'habeas-data-v1' },
	fijos: { departamento: 'Valle del Cauca', municipio: 'Jamundí' },
	limites: {
		personas: 10,
		agropecuario: 4,
		evidencias: 5,
		evidencias_documento: 1,
		evidencias_dano: 4,
		bytes_archivo: 8388608,
		bytes_carga: 26214400,
		anos_atras_evento: 2,
		extensiones: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf']
	},
	tipos_documento: Array.from({ length: 10 }, (_, i) => ({ codigo: i + 1, etiqueta: `Doc ${i + 1}` })),
	documentos_sin_numero: [6, 7, 8],
	documentos_alfanumericos: [4, 5, 9, 10],
	documento_otro: 10,
	parentescos: Array.from({ length: 15 }, (_, i) => ({ codigo: i + 1, etiqueta: `Par ${i + 1}` })),
	parentesco_jefe: 1,
	generos: [1, 2, 3].map((c) => ({ codigo: c, etiqueta: `G${c}` })),
	etnias: [1, 2, 3, 4, 5, 6].map((c) => ({ codigo: c, etiqueta: `E${c}` })),
	zonas: [
		{ codigo: 'URBANO', etiqueta: 'Urbano' },
		{ codigo: 'RURAL', etiqueta: 'Rural' }
	],
	alojamientos: [
		{ codigo: 'LUGAR_HABITUAL', etiqueta: 'Habitual' },
		{ codigo: 'EVACUADO', etiqueta: 'Evacuado' }
	],
	formas_tenencia: [{ codigo: 'PROPIETARIO', etiqueta: 'Propietario' }],
	estados_bien: [{ codigo: 'AVERIADO', etiqueta: 'Averiado' }],
	tipos_bien: [{ codigo: 'VIVIENDA', etiqueta: 'Vivienda', grupo: 'COMUNES' }],
	unidades_medida: [{ codigo: 'HECTAREA', etiqueta: 'Hectárea(s)' }],
	eventos_sugeridos: ['Terremoto', 'Inundación'],
	corregimientos: ['Potrerito'],
	predeterminados: { evento: 'Terremoto', fecha_evento: '2026-08-10' }
};

function fechaHace(dias: number): string {
	const d = new Date();
	d.setDate(d.getDate() - dias);

	return aISO(d);
}

function jefe(cambios: Partial<Persona> = {}): Persona {
	return {
		...personaVacia(1),
		nombres: 'María José',
		apellidos: 'Riascos Mina',
		tipo_documento: 3,
		numero_documento: '31234567',
		parentesco: 1,
		genero: 2,
		nacimiento_dia: '11',
		nacimiento_mes: '4',
		nacimiento_ano: '1985',
		pertenencia_etnica: 5,
		telefono: '3105551234',
		...cambios
	};
}

function base(cambios: Partial<FormularioRufe> = {}): FormularioRufe {
	return {
		...formularioVacio(),
		evento: 'Terremoto',
		fecha_evento: fechaHace(3),
		zona: 'URBANO',
		vereda_sector_barrio: 'Barrio Belalcázar',
		direccion: 'Calle 10 # 5-32',
		tipo_bien: 'VIVIENDA',
		forma_tenencia: 'PROPIETARIO',
		estado_bien: 'AVERIADO',
		alojamiento: 'LUGAR_HABITUAL',
		personas: [jefe()],
		tiene_afectacion_agro: false,
		contacto_telefono: '3105551234',
		autoriza_tratamiento: true,
		...cambios
	};
}

const errores = (d: FormularioRufe) => validarTodo(d, CATALOGOS);

describe('formulario completo', () => {
	it('un reporte válido no produce errores', () => {
		expect(errores(base())).toEqual({});
	});
});

describe('C1 — evento "Otro"', () => {
	it('exige el texto libre', () => {
		expect(errores(base({ evento: 'OTRO' }))).toHaveProperty('evento_otro');
	});

	it('con el texto libre es válido', () => {
		expect(errores(base({ evento: 'OTRO', evento_otro: 'Socavación de la vía' }))).toEqual({});
	});

	it('rechaza un evento fuera del catálogo', () => {
		expect(errores(base({ evento: 'Invasión alienígena' }))).toHaveProperty('evento');
	});
});

describe('fecha del evento', () => {
	it('rechaza fechas futuras', () => {
		expect(errores(base({ fecha_evento: fechaHace(-1) }))).toHaveProperty('fecha_evento');
	});

	it('rechaza fechas de hace más de dos años', () => {
		expect(errores(base({ fecha_evento: fechaHace(1200) }))).toHaveProperty('fecha_evento');
	});

	it('rechaza una fecha que no existe', () => {
		expect(fechaExiste('2026-02-31')).toBe(false);
		expect(fechaExiste('2024-02-29')).toBe(true);
		expect(fechaExiste('11/04/2026')).toBe(false);
	});

	// Colombia va cinco horas por detrás de UTC: con toISOString, cada noche a
	// partir de las 19:00 el validador daba por buena una fecha de mañana.
	it('usa la fecha local del dispositivo, no la de UTC', () => {
		const d = new Date();
		expect(hoy()).toBe(
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
		);
	});
});

describe('C2 y C3 — corregimiento según la zona', () => {
	it('en zona rural es obligatorio', () => {
		expect(errores(base({ zona: 'RURAL' }))).toHaveProperty('corregimiento');
	});

	it('en zona rural con corregimiento es válido', () => {
		expect(errores(base({ zona: 'RURAL', corregimiento: 'Potrerito' }))).toEqual({});
	});

	it('en zona urbana no se valida aunque venga con valor: el esquema lo limpia', () => {
		expect(errores(base({ zona: 'URBANO', corregimiento: 'Potrerito' }))).toEqual({});
	});
});

describe('C4 — dirección del alojamiento', () => {
	it('si evacuó, es obligatoria', () => {
		expect(errores(base({ alojamiento: 'EVACUADO' }))).toHaveProperty('alojamiento_direccion');
	});

	it('si evacuó y la escribe, es válido', () => {
		expect(
			errores(base({ alojamiento: 'EVACUADO', alojamiento_direccion: 'Casa de mi hermana' }))
		).toEqual({});
	});
});

describe('personas', () => {
	it('exige al menos una', () => {
		expect(errores(base({ personas: [] }))).toHaveProperty('personas');
	});

	it('no admite más de diez', () => {
		const once = Array.from({ length: 11 }, (_, i) =>
			jefe({ parentesco: i === 0 ? 1 : 3, numero_documento: String(10000000 + i) })
		);
		expect(errores(base({ personas: once }))).toHaveProperty('personas');
	});

	it('admite exactamente diez', () => {
		const diez = Array.from({ length: 10 }, (_, i) =>
			jefe({ parentesco: i === 0 ? 1 : 3, numero_documento: String(10000000 + i) })
		);
		expect(errores(base({ personas: diez }))).toEqual({});
	});

	it('exige un jefe de hogar', () => {
		expect(errores(base({ personas: [jefe({ parentesco: 3 })] }))).toHaveProperty('personas');
	});

	it('rechaza dos jefes de hogar', () => {
		expect(
			errores(base({ personas: [jefe(), jefe({ numero_documento: '99887766' })] }))
		).toHaveProperty('personas');
	});

	it('rechaza documentos repetidos', () => {
		const e = errores(base({ personas: [jefe(), jefe({ parentesco: 3 })] }));
		expect(e).toHaveProperty('personas.1.numero_documento');
	});
});

describe('C5, C6 y C7 — número de documento', () => {
	it('la cédula exige número', () => {
		const e = validarPersona(jefe({ numero_documento: '' }), 0, CATALOGOS);
		expect(e).toHaveProperty('personas.0.numero_documento');
	});

	it('la cédula no admite letras', () => {
		const e = validarPersona(jefe({ numero_documento: 'AB123456' }), 0, CATALOGOS);
		expect(e).toHaveProperty('personas.0.numero_documento');
	});

	it('el pasaporte sí admite letras', () => {
		const e = validarPersona(
			jefe({ tipo_documento: 5, numero_documento: 'AV123456' }),
			0,
			CATALOGOS
		);
		expect(e).not.toHaveProperty('personas.0.numero_documento');
	});

	it('"menor sin identificación" no exige número', () => {
		const e = validarPersona(
			jefe({ tipo_documento: 6, numero_documento: '' }),
			0,
			CATALOGOS
		);
		expect(e).not.toHaveProperty('personas.0.numero_documento');
	});

	it('el NIT lleva número y admite el guion de verificación', () => {
		const e = validarPersona(
			jefe({ tipo_documento: 9, numero_documento: '900123456-1' }),
			0,
			CATALOGOS
		);
		expect(e).not.toHaveProperty('personas.0.numero_documento');
	});

	it('el NIT sin número se rechaza', () => {
		const e = validarPersona(jefe({ tipo_documento: 9, numero_documento: '' }), 0, CATALOGOS);
		expect(e).toHaveProperty('personas.0.numero_documento');
	});

	it('el documento "Otro" exige decir cuál', () => {
		const e = validarPersona(
			jefe({ tipo_documento: 10, numero_documento: 'X1234', documento_otro: '' }),
			0,
			CATALOGOS
		);
		expect(e).toHaveProperty('personas.0.documento_otro');
	});
});

describe('C8 — teléfono del jefe de hogar', () => {
	it('el jefe necesita teléfono', () => {
		const e = validarPersona(jefe({ telefono: '' }), 0, CATALOGOS);
		expect(e).toHaveProperty('personas.0.telefono');
	});

	it('los demás no lo necesitan', () => {
		const e = validarPersona(jefe({ parentesco: 3, telefono: '' }), 0, CATALOGOS);
		expect(e).not.toHaveProperty('personas.0.telefono');
	});
});

describe('fecha de nacimiento', () => {
	it('es opcional si está toda vacía', () => {
		const e = validarPersona(
			jefe({ nacimiento_dia: '', nacimiento_mes: '', nacimiento_ano: '' }),
			0,
			CATALOGOS
		);
		expect(e).not.toHaveProperty('personas.0.fecha_nacimiento');
	});

	it('rechaza una fecha a medias', () => {
		const e = validarPersona(jefe({ nacimiento_ano: '' }), 0, CATALOGOS);
		expect(e).toHaveProperty('personas.0.fecha_nacimiento');
	});

	it('rechaza una fecha futura', () => {
		const manana = new Date();
		manana.setDate(manana.getDate() + 1);
		const e = validarPersona(
			jefe({
				nacimiento_dia: String(manana.getDate()),
				nacimiento_mes: String(manana.getMonth() + 1),
				nacimiento_ano: String(manana.getFullYear())
			}),
			0,
			CATALOGOS
		);
		expect(e).toHaveProperty('personas.0.fecha_nacimiento');
	});
});

describe('nombres', () => {
	it('rechaza dígitos', () => {
		const e = validarPersona(jefe({ nombres: 'Ana 3' }), 0, CATALOGOS);
		expect(e).toHaveProperty('personas.0.nombres');
	});

	it('acepta tildes, ñ, apóstrofo y guion', () => {
		const e = validarPersona(jefe({ nombres: "Ñandú D'Ángelo-Peña" }), 0, CATALOGOS);
		expect(e).not.toHaveProperty('personas.0.nombres');
	});
});

describe('C9, C10 y C11 — sector agropecuario', () => {
	it('sin responder la pregunta hay error', () => {
		expect(errores(base({ tiene_afectacion_agro: null }))).toHaveProperty('tiene_afectacion_agro');
	});

	it('si dijo "sí" exige al menos un renglón', () => {
		expect(errores(base({ tiene_afectacion_agro: true, agropecuario: [] }))).toHaveProperty(
			'agropecuario'
		);
	});

	it('un renglón sin cultivo ni especie se rechaza', () => {
		expect(validarRenglonAgro(renglonAgroVacio(), 0)).toHaveProperty('agropecuario.0');
	});

	it('C10: el cultivo exige unidad y área', () => {
		const e = validarRenglonAgro({ ...renglonAgroVacio(), tipo_cultivo: 'Caña' }, 0);
		expect(e).toHaveProperty('agropecuario.0.unidad_medida');
		expect(e).toHaveProperty('agropecuario.0.area_cantidad');
	});

	it('C10: un área de cero se rechaza', () => {
		const e = validarRenglonAgro(
			{ ...renglonAgroVacio(), tipo_cultivo: 'Caña', unidad_medida: 'HECTAREA', area_cantidad: '0' },
			0
		);
		expect(e).toHaveProperty('agropecuario.0.area_cantidad');
	});

	it('C11: la especie exige cantidad', () => {
		const e = validarRenglonAgro({ ...renglonAgroVacio(), especie_pecuaria: 'Gallinas' }, 0);
		expect(e).toHaveProperty('agropecuario.0.cantidad_unidades');
	});

	it('un renglón solo pecuario es válido', () => {
		const e = validarRenglonAgro(
			{ ...renglonAgroVacio(), especie_pecuaria: 'Gallinas', cantidad_unidades: '40' },
			0
		);
		expect(e).toEqual({});
	});

	it('no admite más de cuatro renglones', () => {
		const cinco = Array.from({ length: 5 }, () => ({
			...renglonAgroVacio(),
			especie_pecuaria: 'Cerdos',
			cantidad_unidades: '2'
		}));
		expect(errores(base({ tiene_afectacion_agro: true, agropecuario: cinco }))).toHaveProperty(
			'agropecuario'
		);
	});
});

describe('contacto', () => {
	it('el teléfono es obligatorio', () => {
		expect(errores(base({ contacto_telefono: '' }))).toHaveProperty('contacto_telefono');
	});

	it('acepta separadores y prefijo internacional', () => {
		expect(telefonoValido('+57 (310) 555-1234')).toBe(true);
		expect(soloDigitos('+57 (310) 555-1234')).toBe('573105551234');
	});

	it('rechaza menos de siete dígitos', () => {
		expect(telefonoValido('31055')).toBe(false);
	});

	it('valida el correo', () => {
		expect(correoValido('ana@jamundi.gov.co')).toBe(true);
		expect(correoValido('no-es-correo')).toBe(false);
	});

	it('el correo es opcional', () => {
		expect(errores(base({ contacto_correo: '' }))).toEqual({});
	});
});

describe('autorización', () => {
	// Una sola casilla desde que se refundieron las cuatro. Que siga siendo
	// obligatoria es lo que impide registrar una ficha sin base legal.
	it('es obligatoria', () => {
		expect(errores(base({ autoriza_tratamiento: false }))).toHaveProperty(
			'autoriza_tratamiento'
		);
	});

	it('marcada, la ficha es válida', () => {
		expect(errores(base({ autoriza_tratamiento: true }))).toEqual({});
	});
});

describe('pasoDelError', () => {
	it('lleva cada clave a su paso', () => {
		expect(pasoDelError('personas.3.nombres')).toBe('personas');
		expect(pasoDelError('agropecuario.0.area_cantidad')).toBe('agropecuario');
		expect(pasoDelError('tiene_afectacion_agro')).toBe('agropecuario');
		expect(pasoDelError('fecha_evento')).toBe('evento');
		expect(pasoDelError('corregimiento')).toBe('ubicacion');
		expect(pasoDelError('estado_bien')).toBe('inmueble');
		expect(pasoDelError('alojamiento_direccion')).toBe('alojamiento');
		expect(pasoDelError('contacto_telefono')).toBe('evidencias');
		expect(pasoDelError('autoriza_tratamiento')).toBe('revision');
	});

	it('una clave desconocida cae en el paso de revisión, que es donde se envía', () => {
		expect(pasoDelError('campo_que_no_existe')).toBe('revision');
	});
});
