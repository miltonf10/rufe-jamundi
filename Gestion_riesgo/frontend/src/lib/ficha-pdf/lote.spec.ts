// El reparto del trabajo al descargar muchas fichas.
//
// Lo que importa aquí no es el PDF —eso ya se comprueba aparte— sino qué pasa
// cuando una ficha falla, cuando alguien detiene la descarga a la mitad, y que
// no se pidan cincuenta detalles de golpe a un servidor compartido que además
// está atendiendo a censadores en campo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const generarFichaPdf = vi.fn();
const plantillaOficial = vi.fn();

vi.mock('./generar', () => ({
	generarFichaPdf: (d: unknown) => generarFichaPdf(d),
	plantillaOficial: () => plantillaOficial()
}));

const { generarLote, nombreZip } = await import('./lote');

function fichas(n: number) {
	return Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		radicado: `RUFE-2026-000000${i + 1}`
	}));
}

import type { DetalleCompleto } from '$lib/rufe-form/tipos';

// Solo hace falta la forma: lo que se prueba es el reparto del trabajo, no el PDF.
const detalleFalso = {
	reporte: {},
	personas: [],
	agropecuario: [],
	evidencias: [],
	historial: []
} as unknown as DetalleCompleto;

beforeEach(() => {
	generarFichaPdf.mockReset();
	plantillaOficial.mockReset();
	plantillaOficial.mockResolvedValue(new ArrayBuffer(8));
	generarFichaPdf.mockImplementation(() => Promise.resolve(new Blob(['%PDF-1.5 fake'])));
});

describe('descarga de un lote', () => {
	it('genera un archivo por ficha, no un PDF de muchas páginas', async () => {
		const traer = vi.fn().mockResolvedValue(detalleFalso);

		const r = await generarLote(fichas(5), traer);

		expect(r.generadas).toBe(5);
		expect(traer).toHaveBeenCalledTimes(5);
		expect(r.zip.type).toBe('application/zip');
	});

	// Cada ficha se archiva, se remite y se firma por separado. Juntarlas en un
	// solo documento obligaría a partirlo después.
	it('cada archivo se llama por su radicado', async () => {
		const traer = vi.fn().mockResolvedValue(detalleFalso);
		const { unzipSync } = await import('fflate');

		const r = await generarLote(fichas(3), traer);
		const nombres = Object.keys(unzipSync(new Uint8Array(await r.zip.arrayBuffer())));

		expect(nombres.sort()).toEqual([
			'RUFE-2026-0000001.pdf',
			'RUFE-2026-0000002.pdf',
			'RUFE-2026-0000003.pdf'
		]);
	});

	// Quien descarga cuarenta y nueve de cincuenta puede volver por la que falta.
	// Perder las cuarenta y nueve por una sería absurdo.
	it('una ficha que falla no se lleva el lote por delante', async () => {
		const traer = vi.fn(async (id: number) => {
			if (id === 2) throw new Error('Ficha no encontrada');

			return detalleFalso;
		});

		const r = await generarLote(fichas(4), traer);

		expect(r.generadas).toBe(3);
		expect(r.fallidas).toEqual([{ radicado: 'RUFE-2026-0000002', motivo: 'Ficha no encontrada' }]);
	});

	it('informa del avance ficha a ficha', async () => {
		const vistos: number[] = [];
		const traer = vi.fn().mockResolvedValue(detalleFalso);

		await generarLote(fichas(4), traer, { alAvanzar: (a) => vistos.push(a.hechas) });

		expect(vistos[0]).toBe(0);
		expect(vistos.at(-1)).toBe(4);
		expect(vistos).toContain(4);
	});

	it('al detener, para y devuelve lo que llevaba', async () => {
		const traer = vi.fn().mockResolvedValue(detalleFalso);
		let hechas = 0;

		const r = await generarLote(fichas(30), traer, {
			alAvanzar: (a) => (hechas = a.hechas),
			detenido: () => hechas >= 3
		});

		expect(r.generadas).toBeLessThan(30);
		expect(r.generadas).toBeGreaterThan(0);
		expect(traer.mock.calls.length).toBeLessThan(30);
	});

	// El servidor es compartido y mientras tanto hay censadores levantando
	// fichas en campo. Cincuenta consultas simultáneas los dejarían esperando.
	it('no pide todas las fichas a la vez', async () => {
		let simultaneas = 0;
		let tope = 0;

		const traer = vi.fn(async () => {
			simultaneas++;
			tope = Math.max(tope, simultaneas);
			await new Promise((r) => setTimeout(r, 1));
			simultaneas--;

			return detalleFalso;
		});

		await generarLote(fichas(12), traer);

		expect(tope).toBeLessThanOrEqual(3);
	});

	// Si el formato oficial no está, no tiene sentido pedir cincuenta detalles
	// para descubrirlo al final.
	it('si falta el formato oficial, falla antes de pedir nada', async () => {
		plantillaOficial.mockRejectedValue(new Error('No se encontró el formato oficial'));
		const traer = vi.fn();

		await expect(generarLote(fichas(5), traer)).rejects.toThrow('formato oficial');
		expect(traer).not.toHaveBeenCalled();
	});

	it('un lote vacío no revienta', async () => {
		const r = await generarLote([], vi.fn());
		expect(r.generadas).toBe(0);
	});
});

describe('nombre del archivo comprimido', () => {
	it('dice cuántas trae y cuándo se sacó', () => {
		expect(nombreZip(10, new Date(2026, 7, 20, 9, 5))).toBe('fichas-rufe-10-20260820-0905.zip');
	});
});
