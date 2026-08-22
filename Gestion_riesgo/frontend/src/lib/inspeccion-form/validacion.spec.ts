// La validación del navegador. Espejo de la de PHP, que es la que manda.
//
// Lo que se fija aquí es sobre todo que las claves de error coincidan con las
// del servidor: si no coincidieran, un error devuelto por el backend se
// mostraría en ninguna parte y el profesional vería «revise los datos marcados»
// sin nada marcado.

import { describe, expect, it } from 'vitest';
import { formularioVacio } from './esquema';
import { pasoDelError, validarPaso, validarTodo, hoy, haceAnos } from './validacion';
import type { Catalogos, FormularioInspeccion } from './tipos';

const CATALOGOS = {
	limites: { anos_atras: 2 },
	profesiones: [
		{ codigo: 'ARQUITECTO', etiqueta: 'Arquitecto(a)' },
		{ codigo: 'INGENIERO_CIVIL', etiqueta: 'Ingeniero(a) civil' },
		{ codigo: 'OTRA', etiqueta: 'Otra, ¿cuál?' }
	],
	corregimientos: ['Robles', 'Timba'],
	eventos: [
		{ codigo: 'SISMO', etiqueta: 'Sismo' },
		{ codigo: 'OTRO', etiqueta: 'Otro' }
	],
	requisitos: [
		{ codigo: 'NO_BENEFICIARIO', etiqueta: 'No haber sido beneficiario…' },
		{ codigo: 'PROPIETARIO', etiqueta: 'Ser el propietario…' },
		{ codigo: 'NO_ALTO_RIESGO', etiqueta: 'Certificación…' }
	],
	convenciones: {
		CUBIERTA: { etiqueta: 'Cubierta', opciones: { Z: 'Zinc', M: 'Madera' } }
	},
	kits_cubierta: { MAMPOSTERIA: { ZINC: 'Cubierta en zinc' }, MADERA: { ZINC: 'Cubierta en zinc' } },
	evaluacion: {
		MAMPOSTERIA: [
			{
				codigo: 'VIGAS_COLUMNAS',
				etiqueta: 'Vigas y columnas',
				estructural: true,
				niveles: [
					{ codigo: 'LEVE', etiqueta: 'Leve', alcance: 'Reparación', criterios: [] },
					{ codigo: 'SEVERO', etiqueta: 'Severo', alcance: 'Reconstrucción', criterios: [] }
				]
			},
			{
				codigo: 'PLACA_PISO',
				etiqueta: 'Placa de piso',
				estructural: false,
				niveles: [{ codigo: 'MODERADO', etiqueta: 'Moderado', alcance: 'Reforzamiento', criterios: [] }]
			}
		]
	}
} as unknown as Catalogos;

const TRES_SI = { NO_BENEFICIARIO: true, PROPIETARIO: true, NO_ALTO_RIESGO: true };

function completo(cambios: Partial<FormularioInspeccion> = {}): FormularioInspeccion {
	return {
		...formularioVacio(),
		fecha_evaluacion: hoy(),
		profesional_nombre: 'Ana Ruiz',
		profesional_tarjeta: 'CO-12345',
		profesional_profesion: 'INGENIERO_CIVIL',
		profesional_documento: '31234567',
		profesional_telefono: '3151234567',
		propietario_nombres: 'Pedro Pérez',
		propietario_documento: '16234567',
		direccion_cabecera: 'Carrera 11 # 8-26',
		requisitos: TRES_SI,
		evento: 'SISMO',
		sistema_constructivo: 'MAMPOSTERIA',
		infraestructura: { CUBIERTA: 'Z' },
		danos: {
			VIGAS_COLUMNAS: { afectado: true, nivel: 'SEVERO' },
			PLACA_PISO: { afectado: false, nivel: null }
		},
		requiere_evacuacion: true,
		kit_cubierta: 'ZINC',
		informante_nombre: 'María Pérez',
		informante_documento: '1144567890',
		informante_parentesco: 3,
		...cambios
	};
}

describe('una inspección completa', () => {
	it('no produce ningún error', () => {
		expect(validarTodo(completo(), CATALOGOS)).toEqual({});
	});
});

describe('las claves de error coinciden con las del servidor', () => {
	it('la tabla del 5.4 usa danos.ELEMENTO.campo', () => {
		// Si esta ruta con puntos no coincidiera con la de PHP, un error del
		// servidor se pintaría en ninguna parte.
		const d = completo({ danos: { VIGAS_COLUMNAS: { afectado: true, nivel: null } } });
		const e = validarTodo(d, CATALOGOS);

		expect(e['danos.VIGAS_COLUMNAS.nivel']).toBeTruthy();
		expect(e['danos.PLACA_PISO.afectado']).toBeTruthy();
	});

	it('los requisitos usan requisitos.CODIGO', () => {
		const e = validarTodo(completo({ requisitos: {} }), CATALOGOS);

		expect(e['requisitos.PROPIETARIO']).toBeTruthy();
	});

	it('la infraestructura usa infraestructura.CATEGORIA', () => {
		const e = validarTodo(completo({ infraestructura: {} }), CATALOGOS);

		expect(e['infraestructura.CUBIERTA']).toBeTruthy();
	});
});

describe('la evaluación técnica', () => {
	it('no admite un nivel que el Anexo 1 no define', () => {
		const d = completo({ danos: { VIGAS_COLUMNAS: { afectado: true, nivel: 'MODERADO' } } });

		expect(validarTodo(d, CATALOGOS)['danos.VIGAS_COLUMNAS.nivel']).toContain('Anexo 1');
	});

	it('con colapso total no exige la tabla por elementos', () => {
		const d = completo({ colapso_total: true, danos: {} });
		const claves = Object.keys(validarTodo(d, CATALOGOS));

		expect(claves.filter((k) => k.startsWith('danos.'))).toEqual([]);
	});

	it('exige decir si la vivienda requiere evacuación', () => {
		expect(validarTodo(completo({ requiere_evacuacion: null }), CATALOGOS).requiere_evacuacion).toBeTruthy();
	});
});

describe('la rama del acta', () => {
	it('quien no cumple no tiene que llenar la inspección', () => {
		const d = completo({
			requisitos: { ...TRES_SI, PROPIETARIO: false },
			evento: '',
			sistema_constructivo: '',
			danos: {},
			infraestructura: {},
			requiere_evacuacion: null,
			informante_nombre: '',
			informante_documento: '',
			informante_parentesco: null,
			acta_modalidad: 'REHABILITACION',
			acta_nombre: 'Pedro Pérez',
			acta_documento: '16234567'
		});

		expect(validarTodo(d, CATALOGOS)).toEqual({});
	});

	it('pero sí el acta', () => {
		const d = completo({
			requisitos: { ...TRES_SI, PROPIETARIO: false },
			evento: '',
			sistema_constructivo: '',
			danos: {},
			infraestructura: {},
			requiere_evacuacion: null,
			informante_nombre: '',
			informante_documento: '',
			informante_parentesco: null
		});
		const e = validarTodo(d, CATALOGOS);

		expect(e.acta_modalidad).toBeTruthy();
		expect(e.acta_nombre).toBeTruthy();
	});
});

describe('la ubicación', () => {
	it('una vivienda rural se ubica por corregimiento y vereda', () => {
		const d = completo({ direccion_cabecera: '', corregimiento: 'Robles', vereda: 'La Ventura' });

		expect(validarTodo(d, CATALOGOS)).toEqual({});
	});

	it('sin ninguna de las tres no se puede volver al predio', () => {
		const d = completo({ direccion_cabecera: '', corregimiento: '', vereda: '' });

		expect(validarTodo(d, CATALOGOS).direccion_cabecera).toBeTruthy();
	});
});

describe('la fecha de evaluación', () => {
	it('no puede ser de mañana', () => {
		const manana = new Date();
		manana.setDate(manana.getDate() + 1);
		const p = (n: number) => String(n).padStart(2, '0');
		const iso = `${manana.getFullYear()}-${p(manana.getMonth() + 1)}-${p(manana.getDate())}`;

		expect(validarTodo(completo({ fecha_evaluacion: iso }), CATALOGOS).fecha_evaluacion).toBeTruthy();
	});

	it('ni de hace más de dos años', () => {
		expect(validarTodo(completo({ fecha_evaluacion: haceAnos(3) }), CATALOGOS).fecha_evaluacion).toBeTruthy();
	});
});

describe('validarPaso', () => {
	it('solo devuelve los errores del paso, para no adelantar trabajo', () => {
		const vacio = formularioVacio();
		const e = validarPaso('profesional', vacio, CATALOGOS);

		expect(e.profesional_nombre).toBeTruthy();
		expect(e.propietario_nombres).toBeUndefined();
	});

	it('un error de la tabla del 5.4 pertenece al paso de evaluación', () => {
		const d = completo({ danos: { VIGAS_COLUMNAS: { afectado: true, nivel: null } } });

		expect(Object.keys(validarPaso('evaluacion', d, CATALOGOS))).toContain('danos.VIGAS_COLUMNAS.nivel');
	});
});

describe('pasoDelError', () => {
	it('lleva al paso donde está el campo, no a la revisión', () => {
		const d = completo();

		expect(pasoDelError('danos.MUROS_CARGA.nivel', d, CATALOGOS)).toBe('evaluacion');
		expect(pasoDelError('profesional_tarjeta', d, CATALOGOS)).toBe('profesional');
		expect(pasoDelError('requisitos.PROPIETARIO', d, CATALOGOS)).toBe('requisitos');
	});

	it('un campo desconocido no rompe: cae en la revisión', () => {
		expect(pasoDelError('campo_que_no_existe', completo(), CATALOGOS)).toBe('revision');
	});
});

describe('la profesión', () => {
	it('tiene que salir de la lista', () => {
		// El formato exige tarjeta profesional al lado: no cabe cualquier oficio.
		expect(validarTodo(completo({ profesional_profesion: 'ASTRONAUTA' }), CATALOGOS).profesional_profesion).toBeTruthy();
	});

	it('«Otra» obliga a decir cuál', () => {
		const e = validarTodo(completo({ profesional_profesion: 'OTRA' }), CATALOGOS);

		expect(e.profesional_profesion_otra).toBeTruthy();
	});

	it('«Otra» con su texto pasa', () => {
		const d = completo({
			profesional_profesion: 'OTRA',
			profesional_profesion_otra: 'Ingeniera sanitaria'
		});

		expect(validarTodo(d, CATALOGOS)).toEqual({});
	});

	it('vacía no pasa', () => {
		expect(validarTodo(completo({ profesional_profesion: '' }), CATALOGOS).profesional_profesion).toBeTruthy();
	});
});
