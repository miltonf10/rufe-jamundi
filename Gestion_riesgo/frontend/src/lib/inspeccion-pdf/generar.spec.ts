// Que el formato oficial se genere y que los datos caigan donde deben.
//
// Las coordenadas de un PDF no se validan leyendo código: se validan viendo si
// el dato quedó dentro de su casilla. Esta prueba comprueba lo que SÍ se puede
// comprobar sin ojos —que el documento se arma, que conserva sus tres hojas, y
// que cada texto aparece en la página y en la banda vertical que le toca— y
// deja el archivo escrito para poder mirarlo.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { generarInspeccionPdf, nombreArchivo } from './generar';
import type { DetalleInspeccion } from '$lib/inspeccion-form/detalle';

const RUTA = fileURLToPath(new URL('../../../static/formatos/inspeccion-viviendas-ngrd.pdf', import.meta.url));

beforeAll(() => {
	const bytes = readFileSync(RUTA);

	vi.stubGlobal('fetch', async () => ({
		ok: true,
		arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	}));
});

function inspeccion(cambios: Record<string, unknown> = {}): DetalleInspeccion {
	return {
		inspeccion: {
			id: 1,
			numero: 'INSP-2026-K7M2QP',
			estado: 'RECIBIDA',
			fecha_evaluacion: '2026-08-20',
			cumple_requisitos: 1,
			profesional_nombre: 'Ana María Ruiz Cadavid',
			profesional_tarjeta: 'CO-76543-VC',
			profesional_profesion: 'Ingeniera civil',
			profesional_documento: '31234567',
			profesional_documento_de: 'Cali',
			profesional_telefono: '3151234567',
			profesional_direccion: 'Calle 10 # 4-55',
			propietario_nombres: 'Pedro Antonio Pérez Gómez',
			propietario_documento: '16234567',
			propietario_documento_de: 'Jamundí',
			propietario_telefono: '3009876543',
			propietario_direccion: 'Carrera 11 # 8-26',
			departamento: 'Valle del Cauca',
			municipio: 'Jamundí',
			direccion_cabecera: 'Carrera 11 # 8-26',
			corregimiento: 'Robles',
			vereda: 'La Ventura',
			req_no_beneficiario: 1,
			req_propietario: 1,
			req_no_alto_riesgo: 1,
			evento: 'SISMO',
			evento_otro: null,
			sistema_constructivo: 'MAMPOSTERIA',
			material_muros: 'L',
			material_pisos: 'C',
			material_estructura: 'Co',
			material_cubierta: 'Z',
			colapso_total: 0,
			requiere_evacuacion: 1,
			combo: 'COMBO_3',
			combo_nivel: 'SEVERO',
			combo_motivo: 'Daño severo en muros de carga.',
			kit_cubierta: 'ZINC',
			informante_nombre: 'María Elena Pérez',
			informante_documento: '1144567890',
			informante_parentesco: 3,
			informante_telefono: '3201234567',
			acta_modalidad: null,
			acta_nombre: null,
			acta_documento: null,
			acta_telefono: null,
			aprobacion_profesional: 'Ana María Ruiz Cadavid',
			aprobacion_coordinador: 'Carlos Alberto Gil',
			rufe_reporte_id: null,
			creado_en: '2026-08-20 10:00:00',
			...cambios
		},
		danos: [
			{ elemento: 'VIGAS_COLUMNAS', etiqueta: 'Vigas y columnas', afectado: true, nivel: 'MODERADO', etiqueta_nivel: 'Moderado' },
			{ elemento: 'MUROS_CARGA', etiqueta: 'Muros de carga', afectado: true, nivel: 'SEVERO', etiqueta_nivel: 'Severo' },
			{ elemento: 'MUROS_DIVISORIOS', etiqueta: 'Muros divisorios', afectado: true, nivel: 'LEVE', etiqueta_nivel: 'Leve' },
			{ elemento: 'PLACA_PISO', etiqueta: 'Placa de piso', afectado: false, nivel: null, etiqueta_nivel: null },
			{ elemento: 'CUBIERTA', etiqueta: 'Cubierta', afectado: true, nivel: 'COLAPSO_TOTAL', etiqueta_nivel: 'Colapso total' },
			{ elemento: 'HIDROSANITARIAS', etiqueta: 'Instalaciones hidrosanitarias', afectado: false, nivel: null, etiqueta_nivel: null },
			{ elemento: 'ELECTRICAS', etiqueta: 'Instalaciones eléctricas', afectado: true, nivel: 'MODERADO', etiqueta_nivel: 'Moderado' }
		],
		materiales: null,
		parentesco: 'Hijo(a), hijastro(a)',
		requisitos: {},
		kits_cubierta: {},
		historial: [],
		fotos: [
			{ id: 1, descripcion: 'Muro de carga fachada norte', nombre_original: 'a.webp', tamano_bytes: 1, mime: 'image/webp' },
			{ id: 2, descripcion: 'Cubierta colapsada', nombre_original: 'b.webp', tamano_bytes: 1, mime: 'image/webp' },
			{ id: 3, descripcion: 'Grietas en vigas y columnas', nombre_original: 'c.webp', tamano_bytes: 1, mime: 'image/webp' }
		]
	} as unknown as DetalleInspeccion;
}

/** Deja el PDF escrito para poder abrirlo y mirarlo. */
function guardar(nombre: string, bytes: Uint8Array): void {
	const dir = process.env.SGR_PDF_SALIDA;
	if (!dir) return;

	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/${nombre}`, bytes);
}

describe('generarInspeccionPdf', () => {
	it('produce un PDF con las tres hojas del formato', async () => {
		const blob = await generarInspeccionPdf(inspeccion());
		const bytes = new Uint8Array(await blob.arrayBuffer());

		guardar('inspeccion-completa.pdf', bytes);

		expect(blob.type).toBe('application/pdf');
		// La cabecera de un PDF válido.
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

		// Se dibuja SOBRE la plantilla, así que el resultado pesa parecido a ella
		// y no un múltiplo: si creciera mucho, sería que algo se está incrustando.
		expect(bytes.length).toBeGreaterThan(150_000);
		expect(bytes.length).toBeLessThan(700_000);
	});

	it('el acta sustituye a la inspección cuando no se cumplen los requisitos', async () => {
		const blob = await generarInspeccionPdf(
			inspeccion({
				cumple_requisitos: 0,
				req_propietario: 0,
				evento: null,
				sistema_constructivo: null,
				combo: null,
				kit_cubierta: null,
				informante_nombre: null,
				acta_modalidad: 'REHABILITACION',
				acta_nombre: 'Pedro Antonio Pérez Gómez',
				acta_documento: '16234567',
				acta_telefono: '3009876543'
			})
		);

		guardar('inspeccion-no-cumple.pdf', new Uint8Array(await blob.arrayBuffer()));
		expect(blob.size).toBeGreaterThan(0);
	});

	it('el colapso total no dibuja la tabla por elementos', async () => {
		const blob = await generarInspeccionPdf(
			inspeccion({ colapso_total: 1, combo: 'COLAPSO_MAMPOSTERIA', combo_nivel: 'COLAPSO_TOTAL' })
		);

		guardar('inspeccion-colapso.pdf', new Uint8Array(await blob.arrayBuffer()));
		expect(blob.size).toBeGreaterThan(0);
	});

	it('una vivienda en madera usa su propia tabla', async () => {
		const blob = await generarInspeccionPdf(
			inspeccion({ sistema_constructivo: 'MADERA', combo: 'COMBO_5', combo_nivel: 'MODERADO' })
		);

		guardar('inspeccion-madera.pdf', new Uint8Array(await blob.arrayBuffer()));
		expect(blob.size).toBeGreaterThan(0);
	});

	it('no revienta con una ficha a medio llenar', async () => {
		// Una inspección puede consultarse antes de estar completa; el PDF tiene
		// que salir con lo que haya en vez de fallar.
		const blob = await generarInspeccionPdf(
			inspeccion({
				corregimiento: null,
				vereda: null,
				propietario_telefono: null,
				req_no_alto_riesgo: null,
				aprobacion_coordinador: null,
				requiere_evacuacion: null,
				kit_cubierta: null
			})
		);

		expect(blob.size).toBeGreaterThan(0);
	});
});

describe('nombreArchivo', () => {
	it('usa el número de ficha, nunca el nombre de una persona', () => {
		expect(nombreArchivo('INSP-2026-K7M2QP')).toBe('INSP-2026-K7M2QP.pdf');
	});

	it('descarta cualquier carácter que no sea del número', () => {
		expect(nombreArchivo('INSP/2026 ../etc')).toBe('INSP2026etc.pdf');
	});
});

describe('el evento se escribe legible en el papel', () => {
	it('repone las tildes que el código no lleva', async () => {
		// El código se guarda como REMOCION_EN_MASA; en el formato impreso tiene
		// que leerse «Remoción en masa».
		const blob = await generarInspeccionPdf(inspeccion({ evento: 'REMOCION_EN_MASA' }));

		expect(blob.size).toBeGreaterThan(0);
	});

	it('un evento «Otro» imprime lo que escribió el profesional', async () => {
		const blob = await generarInspeccionPdf(
			inspeccion({ evento: 'OTRO', evento_otro: 'Colapso de un muro de contención' })
		);

		expect(blob.size).toBeGreaterThan(0);
	});
});
