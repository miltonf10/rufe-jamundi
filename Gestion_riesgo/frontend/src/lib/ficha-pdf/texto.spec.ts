// Lo que prepara cada dato antes de escribirlo en el formato oficial.
//
// Aquí un error no se ve: sale un PDF con aspecto impecable y un dato
// equivocado dentro. Y ese PDF se imprime, se archiva y se remite a la UNGRD.

import { describe, expect, it } from 'vitest';
import { ajustar, anioCompleto, enLineas, nombreArchivo, paraPdf, partirFecha } from './texto';

/** Medidor de mentira: cada carácter mide lo mismo. Basta para la lógica. */
const medir = (t: string, tamano = 10) => t.length * tamano * 0.5;

describe('fechas', () => {
	it('parte la fecha en los tres huecos del formato', () => {
		expect(partirFecha('2026-08-10')).toEqual({ dia: '10', mes: '08', anio: '26' });
	});

	// El formato imprime «D D / M M / A A»: el año va de dos cifras. Con cuatro
	// se saldría de la casilla y pisaría la barra siguiente.
	it('el año va de dos cifras', () => {
		expect(partirFecha('2026-01-05').anio).toBe('26');
	});

	// Con `new Date` la fecha se interpretaría en UTC y en Colombia —cinco horas
	// por detrás— a media tarde saldría el día anterior. En un censo de
	// damnificados, la fecha del evento es un dato que se compara con otros.
	it('no se corre un día por la zona horaria', () => {
		expect(partirFecha('2026-08-10').dia).toBe('10');
		expect(partirFecha('2026-01-01').dia).toBe('01');
		expect(partirFecha('2026-12-31').dia).toBe('31');
	});

	it('la fecha de nacimiento sí lleva el año completo', () => {
		expect(anioCompleto('1982-07-07')).toBe('1982');
	});

	it('sin fecha, casillas vacías en vez de reventar', () => {
		expect(partirFecha(null)).toEqual({ dia: '', mes: '', anio: '' });
		expect(partirFecha('')).toEqual({ dia: '', mes: '', anio: '' });
		expect(anioCompleto(null)).toBe('');
	});
});

describe('texto que no cabe en su casilla', () => {
	const tamanos = [8, 7.5, 6.5, 5.5];

	it('si cabe, se deja en la letra normal', () => {
		expect(ajustar('Juan Pérez', 100, medir, tamanos)).toEqual({ texto: 'Juan Pérez', tamano: 8 });
	});

	// Un dato completo en letra pequeña vale más que uno truncado en letra
	// normal: quien lee el papel necesita el nombre entero.
	it('antes de recortar, encoge la letra', () => {
		const r = ajustar('María Fernanda Zambrano', 70, medir, tamanos);
		expect(r.texto).toBe('María Fernanda Zambrano');
		expect(r.tamano).toBeLessThan(8);
	});

	// Recortado en silencio, quien lea el papel creería que ese es el nombre
	// completo. Los puntos avisan de que falta texto.
	it('si ni así cabe, recorta y avisa', () => {
		const r = ajustar('Nombre larguísimo que no cabe de ninguna manera', 20, medir, tamanos);
		expect(r.texto.endsWith('...')).toBe(true);
		expect(medir(r.texto, r.tamano)).toBeLessThanOrEqual(20);
	});

	it('nunca sobresale del ancho disponible', () => {
		for (const t of ['x', 'Zeneida Isabel Sambrano López', 'A'.repeat(200)]) {
			const r = ajustar(t, 45, medir, tamanos);
			expect(medir(r.texto, r.tamano)).toBeLessThanOrEqual(45);
		}
	});

	it('un texto vacío no dibuja nada', () => {
		expect(ajustar('   ', 50, medir, tamanos).texto).toBe('');
	});
});

describe('observaciones en varias líneas', () => {
	const m = (t: string) => t.length;

	it('corta por palabras', () => {
		expect(enLineas('vivienda ubicada en zona rural', 12, 4, m)).toEqual([
			'vivienda',
			'ubicada en',
			'zona rural'
		]);
	});

	it('parte una palabra solo si ella sola no cabe', () => {
		const l = enLineas('supercalifragilistico', 8, 4, m);
		expect(l[0]).toHaveLength(8);
		expect(l.join('').replace(/\.\.\./g, '')).toContain('supercali');
	});

	it('no pasa del máximo de líneas y avisa del corte', () => {
		const l = enLineas('una '.repeat(80), 10, 3, m);
		expect(l).toHaveLength(3);
		expect(l[2].endsWith('...')).toBe(true);
	});

	it('ninguna línea sobresale', () => {
		for (const l of enLineas('Vivienda ubicada en zona rural perdida total', 14, 4, m)) {
			expect(l.length).toBeLessThanOrEqual(14);
		}
	});
});

describe('caracteres que el PDF sabe dibujar', () => {
	// La tipografía cubre el español. Un solo carácter fuera de su tabla hace
	// fallar la generación entera, y la ficha no se podría descargar.
	it('conserva tildes y eñes', () => {
		expect(paraPdf('Jamundí, Valle · Muñoz Peña')).toContain('Jamundí');
		expect(paraPdf('Muñoz')).toBe('Muñoz');
	});

	it('sustituye lo que llega al copiar desde Word', () => {
		expect(paraPdf('“comillas” y ‘otras’')).toBe('"comillas" y \'otras\'');
		expect(paraPdf('guion — largo')).toBe('guion - largo');
	});

	it('descarta lo que no se puede dibujar en vez de romper el PDF', () => {
		expect(paraPdf('casa 😀 rota')).toBe('casa  rota');
	});
});

describe('nombre del archivo', () => {
	// Nunca el nombre de una persona: el archivo sale del sistema y puede acabar
	// en un correo, un WhatsApp o una carpeta compartida.
	it('es el radicado', () => {
		expect(nombreArchivo('RUFE-2026-XRT9BNCP')).toBe('RUFE-2026-XRT9BNCP.pdf');
	});

	it('no admite caracteres que rompan una ruta', () => {
		expect(nombreArchivo('../../etc/passwd')).toBe('etcpasswd.pdf');
	});
});
