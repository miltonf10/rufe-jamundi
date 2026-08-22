// La política de compresión: qué escalón se usa, cuándo se acepta una foto y
// cuándo se rechaza.
//
// Se prueba la lógica pura. La compresión en sí necesita canvas y un Web Worker,
// que no existen en Node; eso va en la matriz de pruebas manuales. Lo que sí se
// puede fijar aquí es lo que decide si una evidencia se envía o se descarta, que
// es donde un error se paga caro: una cédula ilegible no se nota hasta que
// alguien la necesita.

import { describe, expect, it } from 'vitest';
import {
	ESCALERA_DETALLE,
	ESCALERA_NORMAL,
	LIMITE_ABSOLUTO,
	OBJETIVO_NORMAL,
	cumple,
	dentroDelLimite,
	escaleraPara,
	extensionDe,
	nombreSeguro,
	reduccion,
	tamanoLegible
} from './imagen';

const KB = 1024;

describe('límites', () => {
	it('el tope absoluto es 900 KB', () => {
		expect(LIMITE_ABSOLUTO).toBe(900 * KB);
	});

	it('el objetivo normal está por debajo del tope', () => {
		expect(OBJETIVO_NORMAL).toBeLessThan(LIMITE_ABSOLUTO);
		expect(OBJETIVO_NORMAL).toBe(500 * KB);
	});

	it('acepta hasta el tope exacto y rechaza un byte más', () => {
		expect(dentroDelLimite(900 * KB)).toBe(true);
		expect(dentroDelLimite(900 * KB + 1)).toBe(false);
	});
});

describe('escaleras', () => {
	it('la cédula usa la escalera de detalle y el daño la normal', () => {
		expect(escaleraPara('DOCUMENTO')).toBe(ESCALERA_DETALLE);
		expect(escaleraPara('DANO')).toBe(ESCALERA_NORMAL);
	});

	it('ambas aprietan de forma monótona: nunca un escalón afloja', () => {
		for (const escalera of [ESCALERA_NORMAL, ESCALERA_DETALLE]) {
			for (let i = 1; i < escalera.length; i++) {
				expect(escalera[i].calidad).toBeLessThanOrEqual(escalera[i - 1].calidad);
				expect(escalera[i].lado).toBeLessThanOrEqual(escalera[i - 1].lado);
			}
		}
	});

	it('ninguna meta supera el tope absoluto', () => {
		for (const escalera of [ESCALERA_NORMAL, ESCALERA_DETALLE]) {
			for (const paso of escalera) {
				expect(paso.meta).toBeLessThanOrEqual(LIMITE_ABSOLUTO);
			}
		}
	});

	it('empiezan a 1920 px, que es la resolución de trabajo', () => {
		expect(ESCALERA_NORMAL[0].lado).toBe(1920);
		expect(ESCALERA_DETALLE[0].lado).toBe(1920);
	});

	// Un número de cédula fotografiado con luz de tarde deja de leerse por debajo
	// de 1600 px. Es el suelo que no se cruza aunque la foto pese.
	it('la cédula nunca baja de 1600 px', () => {
		for (const paso of ESCALERA_DETALLE) {
			expect(paso.lado).toBeGreaterThanOrEqual(1600);
		}
	});

	it('la cédula prioriza legibilidad: apunta alto desde el primer intento', () => {
		expect(ESCALERA_DETALLE[0].calidad).toBeGreaterThan(ESCALERA_NORMAL[0].calidad);
		expect(ESCALERA_DETALLE[0].meta).toBeGreaterThan(ESCALERA_NORMAL[0].meta);
	});

	it('el daño sí puede bajar de resolución para caber', () => {
		expect(ESCALERA_NORMAL[ESCALERA_NORMAL.length - 1].lado).toBeLessThan(1920);
	});
});

describe('cumple', () => {
	it('acepta cuando cabe en la meta del escalón', () => {
		expect(cumple(400 * KB, ESCALERA_NORMAL[0])).toBe(true);
		expect(cumple(500 * KB, ESCALERA_NORMAL[0])).toBe(true);
	});

	it('rechaza cuando se pasa, para seguir apretando', () => {
		expect(cumple(600 * KB, ESCALERA_NORMAL[0])).toBe(false);
	});

	it('una foto de 8 MB no cabe en ningún escalón: hay que comprimirla', () => {
		for (const paso of ESCALERA_NORMAL) {
			expect(cumple(8 * 1024 * KB, paso)).toBe(false);
		}
	});
});

describe('reducción', () => {
	it('calcula el ahorro en porcentaje', () => {
		expect(reduccion(8 * 1024 * KB, 420 * KB)).toBe(95);
		expect(reduccion(1000, 500)).toBe(50);
	});

	it('una foto que no se pudo achicar informa 0, no un negativo', () => {
		expect(reduccion(500, 600)).toBe(0);
	});

	it('no divide por cero', () => {
		expect(reduccion(0, 100)).toBe(0);
	});
});

describe('nombre de salida', () => {
	it('la extensión sigue al MIME, nunca al archivo original', () => {
		expect(extensionDe('image/webp')).toBe('webp');
		expect(extensionDe('image/jpeg')).toBe('jpg');
	});

	// El nombre original puede traer el nombre de la persona, o caracteres que
	// rompan una ruta. No se reutiliza nunca.
	it('no reutiliza el nombre original', () => {
		const n = nombreSeguro('DOCUMENTO', 'image/webp');
		expect(n).toMatch(/^documento-[a-z0-9]+-[a-z0-9]+\.webp$/);
	});

	it('distingue el tipo de evidencia', () => {
		expect(nombreSeguro('DANO', 'image/jpeg')).toMatch(/^dano-/);
		expect(nombreSeguro('DOCUMENTO', 'image/jpeg')).toMatch(/^documento-/);
	});

	it('no se repite entre fotos tomadas seguidas', () => {
		const nombres = new Set(Array.from({ length: 200 }, () => nombreSeguro('DANO', 'image/webp')));
		expect(nombres.size).toBe(200);
	});
});

describe('tamaño legible', () => {
	it('usa la unidad que corresponde', () => {
		expect(tamanoLegible(512)).toBe('512 B');
		expect(tamanoLegible(420 * KB)).toBe('420 KB');
		expect(tamanoLegible(8.4 * 1024 * KB)).toBe('8.4 MB');
	});
});
