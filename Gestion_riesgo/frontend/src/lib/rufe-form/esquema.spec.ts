// Comprueba que la estructura del formulario es coherente: que ningún campo se
// quedó sin paso, que los condicionales limpian lo que ocultan y que el cuerpo
// que sale hacia la API no lleva nada que el servidor vaya a rechazar.

import { describe, expect, it } from 'vitest';
import {
	PASOS,
	PASOS_CON_PROGRESO,
	aCuerpoDeApi,
	etiquetaLugar,
	formularioVacio,
	indiceDePaso,
	limpiarCondicionales,
	muestraAgropecuario,
	muestraCorregimiento,
	muestraDireccionAlojamiento,
	muestraEventoOtro,
	personaVacia,
	renglonAgroVacio,
	uid
} from './esquema';
import type { FormularioRufe } from './tipos';

const CATALOGO = { documentos_sin_numero: [6, 7, 8, 9], documento_otro: 10 };

describe('pasos', () => {
	it('son nueve y empiezan por la orientación', () => {
		expect(PASOS).toHaveLength(9);
		expect(PASOS[0].id).toBe('inicio');
		expect(PASOS[PASOS.length - 1].id).toBe('revision');
	});

	it('el primero y el último no cuentan como avance', () => {
		expect(PASOS_CON_PROGRESO).toHaveLength(7);
		expect(PASOS_CON_PROGRESO.map((p) => p.id)).not.toContain('inicio');
		expect(PASOS_CON_PROGRESO.map((p) => p.id)).not.toContain('revision');
	});

	it('los identificadores no se repiten', () => {
		const ids = PASOS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('cada campo del formulario aparece exactamente en un paso', () => {
		const declarados = PASOS.flatMap((p) => p.campos);
		expect(new Set(declarados).size).toBe(declarados.length);

		// Estos tres no tienen control propio: las coordenadas las pone el botón de
		// ubicación y el `uid` de cada persona nunca sale del navegador.
		const sinPaso = ['latitud', 'longitud', 'precision_m'];
		const todos = Object.keys(formularioVacio()).filter((c) => !sinPaso.includes(c));

		expect([...declarados].sort()).toEqual([...todos].sort());
	});

	it('indiceDePaso encuentra cada paso', () => {
		for (const [i, paso] of PASOS.entries()) {
			expect(indiceDePaso(paso.id)).toBe(i);
		}
	});
});

describe('uid', () => {
	it('no repite en mil llamadas', () => {
		const vistos = new Set(Array.from({ length: 1000 }, () => uid()));
		expect(vistos.size).toBe(1000);
	});
});

describe('condicionales', () => {
	it('C1: el texto libre solo se ve con "Otro"', () => {
		const d = formularioVacio();
		expect(muestraEventoOtro(d)).toBe(false);
		d.evento = 'OTRO';
		expect(muestraEventoOtro(d)).toBe(true);
	});

	it('C2: el corregimiento solo se ve en zona rural', () => {
		const d = formularioVacio();
		d.zona = 'URBANO';
		expect(muestraCorregimiento(d)).toBe(false);
		d.zona = 'RURAL';
		expect(muestraCorregimiento(d)).toBe(true);
	});

	it('C3: la etiqueta del lugar cambia con la zona', () => {
		const d = formularioVacio();
		d.zona = 'URBANO';
		expect(etiquetaLugar(d)).toBe('Barrio');
		d.zona = 'RURAL';
		expect(etiquetaLugar(d)).toBe('Vereda o sector');
	});

	it('C4: la dirección del alojamiento solo se ve si evacuó', () => {
		const d = formularioVacio();
		d.alojamiento = 'LUGAR_HABITUAL';
		expect(muestraDireccionAlojamiento(d)).toBe(false);
		d.alojamiento = 'EVACUADO';
		expect(muestraDireccionAlojamiento(d)).toBe(true);
	});

	it('C9: los renglones agropecuarios solo se ven si dijo que sí', () => {
		const d = formularioVacio();
		expect(muestraAgropecuario(d)).toBe(false);
		d.tiene_afectacion_agro = false;
		expect(muestraAgropecuario(d)).toBe(false);
		d.tiene_afectacion_agro = true;
		expect(muestraAgropecuario(d)).toBe(true);
	});
});

describe('limpiarCondicionales', () => {
	it('borra el valor de todo campo que dejó de mostrarse', () => {
		const d = formularioVacio();
		d.evento = 'Sismo';
		d.evento_otro = 'algo';
		d.zona = 'URBANO';
		d.corregimiento = 'Potrerito';
		d.alojamiento = 'LUGAR_HABITUAL';
		d.alojamiento_direccion = 'Casa de un familiar';
		d.tiene_afectacion_agro = false;
		d.agropecuario = [renglonAgroVacio()];

		limpiarCondicionales(d, CATALOGO);

		expect(d.evento_otro).toBe('');
		expect(d.corregimiento).toBe('');
		expect(d.alojamiento_direccion).toBe('');
		expect(d.agropecuario).toEqual([]);
	});

	it('C5: quita el número de documento cuando el tipo no lo lleva', () => {
		const d = formularioVacio();
		const p = personaVacia(1);
		p.tipo_documento = 6;
		p.numero_documento = '123456';
		p.documento_otro = 'Libreta';
		d.personas = [p];

		limpiarCondicionales(d, CATALOGO);

		expect(d.personas[0].numero_documento).toBe('');
		expect(d.personas[0].documento_otro).toBe('');
	});

	it('conserva lo que sí debe verse', () => {
		const d = formularioVacio();
		d.zona = 'RURAL';
		d.corregimiento = 'Potrerito';
		d.alojamiento = 'EVACUADO';
		d.alojamiento_direccion = 'Albergue municipal';

		limpiarCondicionales(d, CATALOGO);

		expect(d.corregimiento).toBe('Potrerito');
		expect(d.alojamiento_direccion).toBe('Albergue municipal');
	});
});

describe('aCuerpoDeApi', () => {
	function completo(): FormularioRufe {
		const d = formularioVacio();
		d.evento = 'Inundación';
		d.fecha_evento = '2026-08-01';
		d.zona = 'URBANO';
		d.vereda_sector_barrio = ' Belalcázar ';
		d.direccion = ' Calle 10 # 5-32 ';
		d.tipo_bien = 'VIVIENDA';
		d.forma_tenencia = 'PROPIETARIO';
		d.estado_bien = 'AVERIADO';
		d.alojamiento = 'LUGAR_HABITUAL';
		d.contacto_telefono = '3105551234';
		d.personas = [
			{
				...personaVacia(1),
				nombres: 'María',
				apellidos: 'Riascos',
				tipo_documento: 3,
				numero_documento: '31234567',
				parentesco: 1,
				genero: 2,
				nacimiento_dia: '4',
				nacimiento_mes: '9',
				nacimiento_ano: '1985',
				pertenencia_etnica: 5,
				telefono: '3105551234'
			}
		];

		return d;
	}

	it('no envía los campos condicionales apagados', () => {
		const cuerpo = aCuerpoDeApi(completo());

		expect(cuerpo).not.toHaveProperty('evento_otro');
		expect(cuerpo).not.toHaveProperty('corregimiento');
		expect(cuerpo).not.toHaveProperty('alojamiento_direccion');
	});

	it('sí envía los condicionales encendidos', () => {
		const d = completo();
		d.evento = 'OTRO';
		d.evento_otro = 'Socavación';
		d.zona = 'RURAL';
		d.corregimiento = 'Potrerito';
		d.alojamiento = 'EVACUADO';
		d.alojamiento_direccion = 'Albergue';

		const cuerpo = aCuerpoDeApi(d);

		expect(cuerpo.evento_otro).toBe('Socavación');
		expect(cuerpo.corregimiento).toBe('Potrerito');
		expect(cuerpo.alojamiento_direccion).toBe('Albergue');
	});

	it('recorta los textos', () => {
		const cuerpo = aCuerpoDeApi(completo());
		expect(cuerpo.direccion).toBe('Calle 10 # 5-32');
		expect(cuerpo.vereda_sector_barrio).toBe('Belalcázar');
	});

	it('arma la fecha de nacimiento con ceros a la izquierda', () => {
		const cuerpo = aCuerpoDeApi(completo()) as { personas: { fecha_nacimiento: string }[] };
		expect(cuerpo.personas[0].fecha_nacimiento).toBe('1985-09-04');
	});

	it('deja la fecha de nacimiento vacía si falta alguna parte', () => {
		const d = completo();
		d.personas[0].nacimiento_ano = '';
		const cuerpo = aCuerpoDeApi(d) as { personas: { fecha_nacimiento: string }[] };
		expect(cuerpo.personas[0].fecha_nacimiento).toBe('');
	});

	it('no filtra los identificadores locales', () => {
		const cuerpo = aCuerpoDeApi(completo()) as { personas: Record<string, unknown>[] };
		expect(cuerpo.personas[0]).not.toHaveProperty('uid');
	});

	it('omite las coordenadas si no se compartió la ubicación', () => {
		const cuerpo = aCuerpoDeApi(completo());
		expect(cuerpo).not.toHaveProperty('latitud');
	});

	it('incluye las coordenadas solo cuando están las dos', () => {
		const d = completo();
		d.latitud = 3.2611;
		d.longitud = -76.5423;
		d.precision_m = 18;

		const cuerpo = aCuerpoDeApi(d);
		expect(cuerpo.latitud).toBe(3.2611);
		expect(cuerpo.longitud).toBe(-76.5423);
		expect(cuerpo.precision_m).toBe(18);
	});

	it('el honeypot siempre viaja vacío', () => {
		expect(aCuerpoDeApi(completo()).sitio_web).toBe('');
	});

	it('adjunta el token de carga y el instante de inicio cuando se le pasan', () => {
		const cuerpo = aCuerpoDeApi(completo(), { carga: 'abc123', iniciadoEn: 1000 });
		expect(cuerpo.carga).toBe('abc123');
		expect(cuerpo.iniciado_en).toBe(1000);
	});
});
