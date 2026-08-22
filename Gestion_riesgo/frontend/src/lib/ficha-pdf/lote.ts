// Descargar varias fichas de una vez, cada una en su propio PDF.
//
// El resultado es un .zip con un archivo por ficha, no un PDF de muchas
// páginas: cada ficha se archiva, se remite y se firma por separado, así que
// juntarlas en un solo documento obligaría a partirlo después.
//
// Lo que gobierna el diseño es que cada ficha exige una petición al servidor
// —el listado solo trae el resumen— y que generar cincuenta PDF ocupa memoria.
// Por eso va de a pocas a la vez, informa del avance y se puede detener.

import type { DetalleCompleto } from '$lib/rufe-form/tipos';
import { generarFichaPdf, plantillaOficial } from './generar';
import { nombreArchivo } from './texto';

/**
 * Cuántas fichas se piden a la vez.
 *
 * Ni una —tardaría demasiado con cincuenta— ni todas de golpe, que dejaría al
 * servidor compartido atendiendo cincuenta consultas pesadas mientras alguien
 * más intenta levantar una ficha en campo.
 */
const A_LA_VEZ = 3;

export type Avance = { hechas: number; total: number; fallidas: number };

export type ResultadoLote = {
	zip: Blob;
	generadas: number;
	fallidas: { radicado: string; motivo: string }[];
};

/**
 * Genera las fichas indicadas y las devuelve en un zip.
 *
 * `traerDetalle` se recibe en vez de importarse para poder probar esto sin
 * servidor: lo que hay que comprobar es el reparto del trabajo y qué pasa cuando
 * una ficha falla, no la capa de red.
 */
export async function generarLote(
	fichas: { id: number; radicado: string }[],
	traerDetalle: (id: number) => Promise<DetalleCompleto>,
	opciones: {
		alAvanzar?: (avance: Avance) => void;
		detenido?: () => boolean;
	} = {}
): Promise<ResultadoLote> {
	// Se trae antes de empezar: si el formato oficial no está, no tiene sentido
	// pedir cincuenta detalles para descubrirlo al final.
	await plantillaOficial();

	const archivos: Record<string, Uint8Array> = {};
	const fallidas: ResultadoLote['fallidas'] = [];
	let hechas = 0;

	const avisar = () =>
		opciones.alAvanzar?.({ hechas, total: fichas.length, fallidas: fallidas.length });

	avisar();

	for (let i = 0; i < fichas.length; i += A_LA_VEZ) {
		if (opciones.detenido?.()) break;

		const tanda = fichas.slice(i, i + A_LA_VEZ);

		await Promise.all(
			tanda.map(async (ficha) => {
				try {
					const detalle = await traerDetalle(ficha.id);
					const pdf = await generarFichaPdf(detalle);
					archivos[nombreArchivo(ficha.radicado)] = new Uint8Array(await pdf.arrayBuffer());
				} catch (e) {
					// Una ficha que falla no puede llevarse el lote por delante: se
					// anota y las demás siguen. Quien descarga cuarenta y nueve de
					// cincuenta puede volver por la que falta.
					fallidas.push({
						radicado: ficha.radicado,
						motivo: e instanceof Error ? e.message : 'No se pudo generar'
					});
				} finally {
					hechas++;
					avisar();
				}
			})
		);
	}

	const { zipSync } = await import('fflate');

	// Sin comprimir: un PDF ya viene comprimido por dentro, así que apretarlo otra
	// vez gasta tiempo y memoria para ahorrar casi nada.
	const bytes = zipSync(archivos, { level: 0 });

	return {
		zip: new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }),
		generadas: Object.keys(archivos).length,
		fallidas
	};
}

/** Nombre del zip: dice qué trae y cuándo se sacó, para no confundir descargas. */
export function nombreZip(cantidad: number, ahora = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	const fecha = `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}`;
	const hora = `${p(ahora.getHours())}${p(ahora.getMinutes())}`;

	return `fichas-rufe-${cantidad}-${fecha}-${hora}.zip`;
}
