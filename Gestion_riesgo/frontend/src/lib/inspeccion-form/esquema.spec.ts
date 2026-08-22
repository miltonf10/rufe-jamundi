// Los pasos del formato y, sobre todo, la bifurcación del numeral 4.
//
// El formato ordena: «si la respuesta es negativa, no se continúa con la
// inspección de la vivienda, pasar al numeral 8». Eso no es un campo que se
// oculta: es media ficha que no se llena. Si se equivoca, o se le pide a un
// profesional que evalúe una vivienda que no puede recibir nada, o se cierra
// una inspección que sí correspondía.

import { describe, expect, it } from 'vitest';
import {
	PASOS,
	conValoresIniciales,
	muestraProfesionOtra,
	cumpleRequisitos,
	danoVacio,
	elementosDe,
	formularioVacio,
	kitSugerido,
	kitsCubiertaDe,
	limpiarCondicionales,
	muestraTablaDanos,
	nivelesPorElemento,
	pasosConProgreso,
	pasosVigentes,
	requisitosIncumplidos
} from './esquema';
import type { Catalogos, FormularioInspeccion } from './tipos';

const CATALOGOS = {
	requisitos: [
		{ codigo: 'NO_BENEFICIARIO', etiqueta: 'No haber sido beneficiario…' },
		{ codigo: 'PROPIETARIO', etiqueta: 'Ser el propietario…' },
		{ codigo: 'NO_ALTO_RIESGO', etiqueta: 'Certificación de la Alcaldía…' }
	],
	kits_cubierta: {
		MAMPOSTERIA: { ZINC: 'Cubierta en zinc', FIBROCEMENTO: 'Cubierta en fibrocemento' },
		MADERA: { ZINC: 'Cubierta en zinc' }
	},
	kit_sugerido: { Z: 'ZINC', Ac: 'FIBROCEMENTO' },
	profesiones: [
		{ codigo: 'ARQUITECTO', etiqueta: 'Arquitecto(a)' },
		{ codigo: 'OTRA', etiqueta: 'Otra, ¿cuál?' }
	],
	convenciones: {
		MUROS_DIVISORIOS: { etiqueta: 'Muros divisorios', opciones: { L: 'Ladrillo' } },
		PISOS: { etiqueta: 'Pisos', opciones: { C: 'Cemento' } },
		ESTRUCTURA: { etiqueta: 'Estructura', opciones: { Co: 'Concreto' } },
		CUBIERTA: { etiqueta: 'Cubierta', opciones: { Z: 'Zinc', Ac: 'Asbesto-cemento' } }
	},
	evaluacion: {
		MAMPOSTERIA: [
			{
				codigo: 'VIGAS_COLUMNAS',
				etiqueta: 'Vigas y columnas',
				estructural: true,
				niveles: [
					{ codigo: 'LEVE', etiqueta: 'Leve', alcance: 'Reparación', criterios: ['…'] },
					{ codigo: 'SEVERO', etiqueta: 'Severo', alcance: 'Reconstrucción parcial', criterios: ['…'] }
				]
			},
			{
				codigo: 'PLACA_PISO',
				etiqueta: 'Placa de piso',
				estructural: false,
				niveles: [
					{ codigo: 'MODERADO', etiqueta: 'Moderado', alcance: 'Reforzamiento', criterios: ['…'] }
				]
			}
		],
		MADERA: [
			{
				codigo: 'ENTREPISOS',
				etiqueta: 'Entrepisos',
				estructural: false,
				niveles: [{ codigo: 'LEVE', etiqueta: 'Leve', alcance: 'Reparación', criterios: ['…'] }]
			}
		]
	}
} as unknown as Catalogos;

function form(cambios: Partial<FormularioInspeccion> = {}): FormularioInspeccion {
	return { ...formularioVacio(), ...cambios };
}

const TRES_SI = { NO_BENEFICIARIO: true, PROPIETARIO: true, NO_ALTO_RIESGO: true };

describe('el numeral 4 se deriva de los tres requisitos', () => {
	it('sin contestar todo, no decide nada', () => {
		// «Sin contestar» y «no cumple» son cosas distintas, y solo la segunda
		// cierra la puerta al banco de materiales.
		expect(cumpleRequisitos(form(), CATALOGOS)).toBeNull();
		expect(cumpleRequisitos(form({ requisitos: { PROPIETARIO: true } }), CATALOGOS)).toBeNull();
	});

	it('cumple solo con los tres en sí', () => {
		expect(cumpleRequisitos(form({ requisitos: TRES_SI }), CATALOGOS)).toBe(true);
	});

	it('un solo no basta para no cumplir', () => {
		const d = form({ requisitos: { ...TRES_SI, PROPIETARIO: false } });

		expect(cumpleRequisitos(d, CATALOGOS)).toBe(false);
		expect(requisitosIncumplidos(d, CATALOGOS)).toEqual(['Ser el propietario…']);
	});
});

describe('la bifurcación', () => {
	it('quien no cumple no recorre la inspección, va al acta', () => {
		const ids = pasosVigentes(form({ requisitos: { ...TRES_SI, PROPIETARIO: false } }), CATALOGOS).map(
			(p) => p.id
		);

		expect(ids).toContain('acta');
		expect(ids).not.toContain('evaluacion');
		expect(ids).not.toContain('materiales');
		expect(ids).not.toContain('fotos');
	});

	it('quien cumple hace la inspección y nunca ve el acta', () => {
		const ids = pasosVigentes(form({ requisitos: TRES_SI }), CATALOGOS).map((p) => p.id);

		expect(ids).toContain('evaluacion');
		expect(ids).not.toContain('acta');
	});

	it('antes de contestar se muestra el camino normal', () => {
		// Empezar enseñando la pantalla de «no cumple» daría a entender que se
		// da por descontado que la familia no va a cumplir.
		expect(pasosVigentes(form(), CATALOGOS).map((p) => p.id)).toContain('evento');
	});

	it('los pasos comunes están en las dos ramas', () => {
		for (const requisitos of [TRES_SI, { ...TRES_SI, PROPIETARIO: false }]) {
			const ids = pasosVigentes(form({ requisitos }), CATALOGOS).map((p) => p.id);
			expect(ids).toContain('profesional');
			expect(ids).toContain('localizacion');
			expect(ids).toContain('revision');
		}
	});

	it('el numeral 9 no es un paso: la aprobación no se autofirma', () => {
		// Quien levanta la ficha no puede aprobarla en el mismo acto. La decisión
		// se toma después, sobre la ficha guardada, igual que en el censo. Si
		// alguien devuelve el paso, esto lo delata.
		for (const requisitos of [TRES_SI, { ...TRES_SI, PROPIETARIO: false }]) {
			const ids = pasosVigentes(form({ requisitos }), CATALOGOS).map((p) => p.id);
			expect(ids).not.toContain('aprobacion');
		}
	});

	it('la rama de inspección son diez pasos contados', () => {
		// El número que ve el profesional en pantalla («Paso 8 de 10»). Se cuenta
		// sobre `pasosConProgreso`, que es de donde sale ese rótulo: la portada y
		// la revisión final no se anuncian como avance.
		expect(pasosConProgreso(form({ requisitos: TRES_SI }), CATALOGOS)).toHaveLength(10);
	});

	it('ni el primer paso ni el último cuentan como avance', () => {
		const ids = pasosConProgreso(form({ requisitos: TRES_SI }), CATALOGOS).map((p) => p.id);

		expect(ids).not.toContain('inicio');
		expect(ids).not.toContain('revision');
	});
});

describe('ningún campo se queda sin paso', () => {
	it('todos los campos del formulario viven en algún paso', () => {
		// Es la prueba que justifica tener los pasos como datos: un campo que se
		// añade y se olvida no se valida nunca y viaja vacío al expediente.
		const enPasos = new Set(PASOS.flatMap((p) => p.campos));
		// Estos no tienen control propio: el vínculo lo pone el sistema al partir de
		// una ficha, y las coordenadas las pone el botón de «tomar la ubicación»,
		// igual que en el RUFE.
		const sinPaso = new Set(['rufe_reporte_id', 'latitud', 'longitud', 'precision_m']);

		for (const campo of Object.keys(formularioVacio())) {
			if (sinPaso.has(campo)) continue;
			expect(enPasos.has(campo as never), `«${campo}» no está en ningún paso`).toBe(true);
		}
	});

	it('ningún paso declara un campo que no existe', () => {
		const campos = new Set(Object.keys(formularioVacio()));

		for (const paso of PASOS) {
			for (const campo of paso.campos) {
				expect(campos.has(campo), `«${campo}» del paso «${paso.id}» ya no existe`).toBe(true);
			}
		}
	});
});

describe('la tabla del 5.4', () => {
	it('solo muestra los elementos del sistema elegido', () => {
		expect(elementosDe(form({ sistema_constructivo: 'MADERA' }), CATALOGOS).map((e) => e.codigo)).toEqual(
			['ENTREPISOS']
		);
		expect(elementosDe(form(), CATALOGOS)).toEqual([]);
	});

	it('el colapso total sustituye a la tabla, no se suma a ella', () => {
		expect(muestraTablaDanos(form({ sistema_constructivo: 'MAMPOSTERIA' }))).toBe(true);
		expect(
			muestraTablaDanos(form({ sistema_constructivo: 'MAMPOSTERIA', colapso_total: true }))
		).toBe(false);
	});

	it('un elemento no afectado no aporta nivel al cálculo', () => {
		const d = form({
			danos: {
				VIGAS_COLUMNAS: { afectado: false, nivel: 'SEVERO' },
				PLACA_PISO: { afectado: true, nivel: 'MODERADO' }
			}
		});

		expect(nivelesPorElemento(d)).toEqual({ VIGAS_COLUMNAS: null, PLACA_PISO: 'MODERADO' });
	});
});

describe('limpiarCondicionales', () => {
	it('cambiar de sistema constructivo se lleva las filas del otro', () => {
		// Si no, quedarían escritas en el expediente filas de una tabla que ese
		// sistema no tiene, y nadie volvería a mirarlas.
		const d = form({
			requisitos: TRES_SI,
			sistema_constructivo: 'MADERA',
			danos: { VIGAS_COLUMNAS: { afectado: true, nivel: 'SEVERO' } }
		});

		expect(Object.keys(limpiarCondicionales(d, CATALOGOS).danos)).toEqual([]);
	});

	it('un nivel que el elemento no admite no se conserva', () => {
		const d = form({
			requisitos: TRES_SI,
			sistema_constructivo: 'MAMPOSTERIA',
			danos: { PLACA_PISO: { afectado: true, nivel: 'LEVE' } }
		});

		expect(limpiarCondicionales(d, CATALOGOS).danos.PLACA_PISO.nivel).toBeNull();
	});

	it('decir «sí» y luego «no» no deja el nivel escondido', () => {
		const d = form({
			requisitos: TRES_SI,
			sistema_constructivo: 'MAMPOSTERIA',
			danos: { VIGAS_COLUMNAS: { afectado: false, nivel: 'SEVERO' } }
		});

		expect(limpiarCondicionales(d, CATALOGOS).danos.VIGAS_COLUMNAS.nivel).toBeNull();
	});

	it('el colapso total vacía la tabla por elementos', () => {
		const d = form({
			requisitos: TRES_SI,
			sistema_constructivo: 'MAMPOSTERIA',
			colapso_total: true,
			danos: { VIGAS_COLUMNAS: { afectado: true, nivel: 'LEVE' } }
		});

		expect(limpiarCondicionales(d, CATALOGOS).danos).toEqual({});
	});

	it('la rama que no se recorrió no deja rastro', () => {
		const noCumple = form({
			requisitos: { ...TRES_SI, PROPIETARIO: false },
			sistema_constructivo: 'MAMPOSTERIA',
			evento: 'SISMO',
			informante_nombre: 'Alguien',
			acta_nombre: 'La propietaria'
		});
		const limpio = limpiarCondicionales(noCumple, CATALOGOS);

		expect(limpio.evento).toBe('');
		expect(limpio.sistema_constructivo).toBe('');
		expect(limpio.informante_nombre).toBe('');
		expect(limpio.acta_nombre).toBe('La propietaria');
	});

	it('quien sí cumple no arrastra un acta a medio llenar', () => {
		const d = form({ requisitos: TRES_SI, acta_nombre: 'Se llenó por error' });

		expect(limpiarCondicionales(d, CATALOGOS).acta_nombre).toBe('');
	});

	it('un kit de cubierta imposible en ese sistema se descarta', () => {
		// El fibrocemento no existe en madera: no es un olvido del anexo.
		const d = form({
			requisitos: TRES_SI,
			sistema_constructivo: 'MADERA',
			kit_cubierta: 'FIBROCEMENTO'
		});

		expect(limpiarCondicionales(d, CATALOGOS).kit_cubierta).toBe('');
	});
});

describe('el kit sugerido por el material encontrado', () => {
	it('el zinc del 5.3 sugiere el kit de zinc', () => {
		const d = form({ sistema_constructivo: 'MAMPOSTERIA', infraestructura: { CUBIERTA: 'Z' } });

		expect(kitSugerido(d, CATALOGOS)).toBe('ZINC');
	});

	it('no sugiere un kit que ese sistema no ofrece', () => {
		const d = form({ sistema_constructivo: 'MADERA', infraestructura: { CUBIERTA: 'Ac' } });

		expect(kitSugerido(d, CATALOGOS)).toBeNull();
	});

	it('un material sin correspondencia no sugiere nada', () => {
		const d = form({ sistema_constructivo: 'MAMPOSTERIA', infraestructura: { CUBIERTA: 'P' } });

		expect(kitSugerido(d, CATALOGOS)).toBeNull();
	});

	it('en madera solo se ofrece zinc', () => {
		expect(kitsCubiertaDe(form({ sistema_constructivo: 'MADERA' }), CATALOGOS)).toEqual([
			{ codigo: 'ZINC', etiqueta: 'Cubierta en zinc' }
		]);
	});
});

describe('danoVacio', () => {
	it('empieza sin contestar, no en «no afectado»', () => {
		// Arrancar en «no» daría por evaluada una vivienda que nadie miró.
		expect(danoVacio()).toEqual({ afectado: null, nivel: null });
	});
});

describe('la profesión «Otra»', () => {
	it('solo pide el texto cuando se elige «Otra»', () => {
		expect(muestraProfesionOtra(form({ profesional_profesion: 'ARQUITECTO' }))).toBe(false);
		expect(muestraProfesionOtra(form({ profesional_profesion: 'OTRA' }))).toBe(true);
	});

	it('cambiar de «Otra» a una de la lista no deja el texto escondido', () => {
		// Si no, el expediente guardaría una profesión que el formulario ya no
		// muestra y que nadie podría corregir.
		const d = form({
			requisitos: TRES_SI,
			profesional_profesion: 'ARQUITECTO',
			profesional_profesion_otra: 'Ingeniera sanitaria'
		});

		expect(limpiarCondicionales(d, CATALOGOS).profesional_profesion_otra).toBe('');
	});
});

describe('conValoresIniciales', () => {
	// El 21 de agosto de 2026 el formulario se quedaba en blanco en el paso 4 con
	// un `props_invalid_value` de Svelte: `bind:valor={datos.requisitos[codigo]}`
	// sobre una clave que no existía le pasaba `undefined` a un `$bindable` con
	// valor por defecto. Un mapa vacío no se ve mal leyendo el código; revienta
	// en pantalla y no deja continuar.

	it('ninguna clave enlazada con bind: queda en undefined', () => {
		const d = conValoresIniciales(form(), CATALOGOS);

		for (const r of CATALOGOS.requisitos) {
			expect(d.requisitos[r.codigo], `requisitos.${r.codigo}`).toBeDefined();
			expect(d.requisitos[r.codigo]).toBeNull();
		}

		for (const categoria of Object.keys(CATALOGOS.convenciones)) {
			expect(d.infraestructura[categoria], `infraestructura.${categoria}`).toBeDefined();
		}
	});

	it('no pisa lo que la persona ya contestó', () => {
		// Recuperar un borrador no puede borrar respuestas.
		const d = conValoresIniciales(
			form({
				requisitos: { PROPIETARIO: false },
				infraestructura: { CUBIERTA: 'Z' }
			}),
			CATALOGOS
		);

		expect(d.requisitos.PROPIETARIO).toBe(false);
		expect(d.requisitos.NO_BENEFICIARIO).toBeNull();
		expect(d.infraestructura.CUBIERTA).toBe('Z');
	});

	it('un borrador viejo recibe las claves que le falten', () => {
		// Si mañana el catálogo crece, un borrador guardado antes no tendría la
		// clave nueva y volvería a romper la pantalla.
		const viejo = form({ requisitos: {}, infraestructura: {} });

		expect(Object.keys(conValoresIniciales(viejo, CATALOGOS).requisitos).sort()).toEqual(
			CATALOGOS.requisitos.map((r) => r.codigo).sort()
		);
	});

	it('la rama del acta tampoco deja huecos', () => {
		// Vaciar `infraestructura` al no cumplir requisitos volvía a producir el
		// undefined si la persona volvía atrás a corregir una respuesta.
		const d = limpiarCondicionales(
			conValoresIniciales(
				form({ requisitos: { ...TRES_SI, PROPIETARIO: false }, infraestructura: { CUBIERTA: 'Z' } }),
				CATALOGOS
			),
			CATALOGOS
		);

		for (const categoria of Object.keys(CATALOGOS.convenciones)) {
			expect(d.infraestructura[categoria], `infraestructura.${categoria}`).toBeDefined();
		}
	});
});

describe('un borrador guardado con una versión anterior', () => {
	// El caso real: se continuó un borrador de antes de que existiera el campo
	// «¿Cuál?» de la profesión. Al elegir «Otra», Svelte intentaba enlazar una
	// propiedad inexistente y la pantalla se quedaba en blanco. El fallo no
	// aparecía donde estaba el campo, sino al llegar a él.

	it('recibe todos los campos que le falten, no solo los mapas', () => {
		const viejo = {
			propietario_nombres: 'Pedro Antonio Pérez Gómez',
			fecha_evaluacion: '2026-08-20'
		} as unknown as FormularioInspeccion;

		const d = conValoresIniciales(viejo, CATALOGOS);

		for (const [campo, valor] of Object.entries(formularioVacio())) {
			expect(d[campo as keyof FormularioInspeccion], `falta «${campo}»`).not.toBeUndefined();
			void valor;
		}
	});

	it('conserva lo que el borrador sí traía', () => {
		const d = conValoresIniciales(
			{ propietario_nombres: 'Pedro Antonio Pérez Gómez' } as FormularioInspeccion,
			CATALOGOS
		);

		expect(d.propietario_nombres).toBe('Pedro Antonio Pérez Gómez');
	});

	it('descarta una profesión que ya no está en la lista', () => {
		// Cuando el campo era texto libre se guardaba «Ingeniera civil»; hoy el
		// desplegable espera un código. Dejarlo pondría la lista en un estado que
		// no corresponde a ninguna de sus opciones.
		const d = conValoresIniciales(
			{ profesional_profesion: 'Ingeniera civil' } as FormularioInspeccion,
			CATALOGOS
		);

		expect(d.profesional_profesion).toBe('');
	});

	it('respeta una profesión que sí está en la lista', () => {
		const d = conValoresIniciales(
			{ profesional_profesion: 'ARQUITECTO' } as FormularioInspeccion,
			CATALOGOS
		);

		expect(d.profesional_profesion).toBe('ARQUITECTO');
	});
});
