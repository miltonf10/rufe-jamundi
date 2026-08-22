import { describe, expect, it } from 'vitest';
import {
	PASOS_PRE,
	bloqueoDeAvance,
	datosVacios,
	paraEnviar,
	pasosVigentes,
	validarPaso,
	type DatosPre
} from './pasos';

function completos(cambios: Partial<DatosPre> = {}): DatosPre {
	return {
		...datosVacios(),
		nombre_completo: 'Pedro Antonio Pérez Gómez',
		documento: '16.234.567',
		telefono: '315 123 4567',
		direccion: 'Carrera 11 # 8-26',
		zona: 'URBANA',
		...cambios
	};
}

describe('los pasos', () => {
	it('son cuatro y en el orden que se acordó', () => {
		expect(PASOS_PRE.map((p) => p.id)).toEqual(['datos', 'vivienda', 'video', 'envio']);
	});

	it('se salta el video cuando nadie ha definido categorías', () => {
		// Es el estado de producción hoy: el catálogo está vacío a propósito
		// hasta que alguien con criterio estructural decida qué debe grabarse.
		// Sin esto, el ciudadano vería una pantalla vacía con un «Siguiente».
		expect(pasosVigentes(false).map((p) => p.id)).toEqual(['datos', 'vivienda', 'envio']);
		expect(pasosVigentes(true)).toHaveLength(4);
	});
});

describe('el paso de datos', () => {
	it('deja pasar lo mínimo completo', () => {
		expect(validarPaso('datos', completos())).toEqual({});
	});

	it('cuenta los dígitos de la cédula, no los puntos', () => {
		// La gente la escribe como la lee en su documento. Rechazar «16.234.567»
		// sería rechazar la forma normal de escribirla.
		expect(validarPaso('datos', completos({ documento: '16.234.567' })).documento).toBeUndefined();
		expect(validarPaso('datos', completos({ documento: '1.2' })).documento).toBeDefined();
	});

	it('exige la zona urbana o rural', () => {
		expect(validarPaso('datos', completos({ zona: '' })).zona).toBeDefined();
	});

	it('acepta una dirección que es una referencia y no una nomenclatura', () => {
		// Media zona rural de Jamundí no tiene calle y número.
		const d = completos({
			zona: 'RURAL',
			direccion: 'La casa azul pasando el puente de La Liberia'
		});

		expect(validarPaso('datos', d)).toEqual({});
	});

	it('deja el correo en blanco, pero caza la errata', () => {
		expect(validarPaso('datos', completos({ correo: '' })).correo).toBeUndefined();
		expect(validarPaso('datos', completos({ correo: 'pedro@correo.com' })).correo).toBeUndefined();
		expect(validarPaso('datos', completos({ correo: 'pedro@correo' })).correo).toBeDefined();
	});
});

describe('el paso de la vivienda', () => {
	it('no obliga a marcar ninguna señal', () => {
		// Quien tiene la casa partida por la mitad puede no reconocerse en
		// ninguno de los dibujos. Negarle el turno por eso sería el error que
		// este formulario existe para no cometer.
		expect(validarPaso('vivienda', completos({ senales: [] }))).toEqual({});
	});
});

describe('el paso de video', () => {
	it('nunca bloquea', () => {
		// Un celular viejo o una vereda sin señal no pueden costar el turno.
		expect(validarPaso('video', completos())).toEqual({});
	});
});

describe('el paso de envío', () => {
	it('exige la autorización de datos', () => {
		expect(validarPaso('envio', completos({ autoriza_datos: false })).autoriza_datos).toBeDefined();
		expect(validarPaso('envio', completos({ autoriza_datos: true }))).toEqual({});
	});

	it('corta el relato demasiado largo antes de mandarlo', () => {
		const d = completos({ autoriza_datos: true, descripcion_dano: 'x'.repeat(1001) });

		expect(validarPaso('envio', d).descripcion_dano).toBeDefined();
	});
});

describe('lo que se manda al servidor', () => {
	it('descarta el corregimiento en zona urbana', () => {
		// Si alguien eligió uno y después corrigió la zona, ese dato sobrante no
		// debe viajar. PHP hace lo mismo; esto evita mandar una contradicción.
		const enviado = paraEnviar(completos({ zona: 'URBANA', corregimiento: 'Robles' }));

		expect(enviado.corregimiento).toBe('');
	});

	it('conserva el corregimiento en zona rural', () => {
		const enviado = paraEnviar(completos({ zona: 'RURAL', corregimiento: 'Robles' }));

		expect(enviado.corregimiento).toBe('Robles');
	});

	it('normaliza cédula y teléfono como lo hace PHP', () => {
		const enviado = paraEnviar(completos());

		expect(enviado.documento).toBe('16234567');
		expect(enviado.telefono).toBe('3151234567');
	});

	it('lleva la trampa antirrobot, aunque esté vacía', () => {
		// Si dejara de mandarse, el servidor nunca vería el campo lleno y la
		// trampa quedaría desarmada sin que nada fallara.
		expect(paraEnviar(completos())).toHaveProperty('sitio_web');
	});
});

describe('lo que impide avanzar aparte de los campos', () => {
	it('deja pasar cuando no hay nada en curso', () => {
		expect(bloqueoDeAvance({ optimizandoFotos: false, videosSubiendo: 0 })).toBe('');
	});

	it('frena con una foto a medio preparar', () => {
		expect(bloqueoDeAvance({ optimizandoFotos: true, videosSubiendo: 0 })).not.toBe('');
	});

	it('frena con un video todavía subiendo, y dice qué se pierde', () => {
		// El servidor descarta el video incompleto porque no se puede reproducir.
		// Sin este freno, la persona ve «Solicitud registrada» y su video no
		// existe en ningún sitio, sin que nadie se lo diga.
		const aviso = bloqueoDeAvance({ optimizandoFotos: false, videosSubiendo: 1 });

		expect(aviso).not.toBe('');
		expect(aviso).toContain('perderá');
	});
});
