// Genera el «Formato de Inspección de Viviendas Afectadas» en su formato
// oficial, escribiendo sobre el PDF en blanco de la NGRD.
//
// Se dibuja SOBRE la plantilla y no se recrea el formato desde cero: es un
// documento de la Unidad Nacional, con su membrete y su rejilla, y redibujarlo
// produciría un parecido, no el formato.
//
// Dos decisiones que conviene no deshacer sin pensarlo:
//
//  • Las firmas se dejan en blanco. Este sistema no captura firmas, y dibujar
//    cualquier trazo sobre esa línea sería fabricar una rúbrica.
//  • Las fotos no se incrustan. La hoja 3 sale con sus recuadros vacíos y los
//    pies escritos: meter diez imágenes convertiría un PDF de 220 KB en uno de
//    varios megas, imposible de mandar desde una vereda, y las fotos ya viven
//    en el expediente donde se ven completas.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
	ACTA,
	APROBACION,
	COMBOS,
	CUMPLE,
	EVACUACION,
	EVALUACION,
	EVENTOS,
	EVENTO_OTRO,
	FECHA_EVALUACION,
	GENERAL,
	HOJA2,
	HOJA3,
	INFORMANTE,
	INFRAESTRUCTURA,
	KITS_CUBIERTA,
	LETRA,
	LOCALIZACION,
	PAGINA,
	REQUISITOS,
	RUTA_PLANTILLA,
	SISTEMA,
	SOBRE_LINEA,
	type Renglon
} from './coordenadas';
import { ajustar, paraPdf, partirFecha } from '$lib/ficha-pdf/texto';
import type { DetalleInspeccion } from '$lib/inspeccion-form/detalle';

export { RUTA_PLANTILLA };

const TINTA = rgb(0.05, 0.09, 0.15);

/** Convierte «medido desde arriba» a las coordenadas del PDF, que crecen hacia arriba. */
const arriba = (y: number) => PAGINA.alto - y;

type Pincel = {
	pagina: PDFPage;
	fuente: PDFFont;
	negrita: PDFFont;
};

/**
 * La plantilla, pedida una sola vez.
 *
 * Descargarla en cada ficha serían 220 KB por documento; quien imprime veinte
 * inspecciones seguidas bajaría cuatro megas para tener siempre el mismo
 * archivo.
 */
let plantilla: Promise<ArrayBuffer> | null = null;

export function plantillaOficial(): Promise<ArrayBuffer> {
	plantilla ??= fetch(RUTA_PLANTILLA).then((res) => {
		if (!res.ok) throw new Error('No se encontró el formato oficial en blanco.');

		return res.arrayBuffer();
	});

	return plantilla;
}

// ── Primitivas de dibujo ────────────────────────────────────────────────────

/**
 * Escribe un texto sobre un renglón, encogiendo la letra antes que recortar.
 *
 * Un nombre largo o una dirección con referencias desbordaría sobre el renglón
 * de al lado y el formato quedaría ilegible justo donde importa.
 */
function enRenglon(
	p: Pincel,
	r: Renglon,
	texto: string | null | undefined,
	sangria = 2,
	// La escalera baja hasta 5 pt porque el formato tiene columnas muy estrechas
	// —la de NOMBRE del numeral 7 mide 66 puntos— y un nombre completo cabe a
	// esa altura. Por debajo no se baja: en papel dejaría de leerse, y un dato
	// ilegible no vale más que uno recortado con puntos suspensivos.
	tamanos: number[] = [LETRA.normal, LETRA.pequena, LETRA.minima, LETRA.diminuta]
): void {
	const limpio = paraPdf((texto ?? '').toString());
	if (limpio.trim() === '') return;

	const ancho = r.x1 - r.x0 - sangria * 2;
	const { texto: final, tamano } = ajustar(
		limpio,
		ancho,
		(t, s) => p.fuente.widthOfTextAtSize(t, s),
		tamanos
	);

	p.pagina.drawText(final, {
		x: r.x0 + sangria,
		y: arriba(r.y) + SOBRE_LINEA,
		size: tamano,
		font: p.fuente,
		color: TINTA
	});
}

/** Una X centrada en una casilla. */
function marcar(p: Pincel, punto: { x: number; y: number }): void {
	const tamano = LETRA.marca;
	const ancho = p.negrita.widthOfTextAtSize('X', tamano);

	p.pagina.drawText('X', {
		x: punto.x - ancho / 2,
		y: arriba(punto.y) - tamano * 0.35,
		size: tamano,
		font: p.negrita,
		color: TINTA
	});
}

/**
 * Rodea con un óvalo la palabra impresa que se elige.
 *
 * Para las respuestas de sí/no el formato imprime las dos palabras juntas y no
 * deja casilla: una X encima taparía justo lo que hay que leer, y una al lado
 * dejaría en duda a cuál de las dos se refiere. Un óvalo alrededor se entiende
 * en papel sin ninguna explicación.
 */
function rodear(p: Pincel, centroX: number, centroY: number, ancho = 15, alto = 7): void {
	p.pagina.drawEllipse({
		x: centroX,
		y: arriba(centroY),
		xScale: ancho,
		yScale: alto,
		borderColor: TINTA,
		borderWidth: 0.9,
		opacity: 0
	});
}

// ── El documento ────────────────────────────────────────────────────────────

export async function generarInspeccionPdf(detalle: DetalleInspeccion): Promise<Blob> {
	const doc = await PDFDocument.load((await plantillaOficial()).slice(0));
	const fuente = await doc.embedFont(StandardFonts.Helvetica);
	const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
	const [hoja1, hoja2, hoja3] = doc.getPages();

	const p1: Pincel = { pagina: hoja1, fuente, negrita };
	const i = detalle.inspeccion;

	// ── Numeral 1 ──
	enRenglon(p1, GENERAL.entidad, `Alcaldía Municipal de ${i.municipio}`);
	// Solo el sufijo, y en letra diminuta: ver el comentario de GENERAL.ficha.
	enRenglon(p1, GENERAL.ficha, i.numero.split('-').at(-1) ?? i.numero, 1, [
		LETRA.minima,
		LETRA.diminuta
	]);

	const fecha = partirFecha(i.fecha_evaluacion);
	for (const [clave, valor] of [
		['dia', fecha.dia],
		['mes', fecha.mes],
		['anio', fecha.anio]
	] as const) {
		if (valor === '') continue;

		const x = FECHA_EVALUACION[clave];
		// La casilla mide unos 7 pt de alto: con la letra normal los dígitos
		// tocarían el filete de arriba.
		const ancho = fuente.widthOfTextAtSize(valor, LETRA.pequena);
		hoja1.drawText(valor, {
			x: x - ancho / 2,
			y: arriba(FECHA_EVALUACION.y),
			size: LETRA.pequena,
			font: fuente,
			color: TINTA
		});
	}

	enRenglon(p1, GENERAL.profesionalNombre, i.profesional_nombre);
	enRenglon(p1, GENERAL.profesionalTarjeta, i.profesional_tarjeta);
	enRenglon(p1, GENERAL.profesionalProfesion, i.profesional_profesion);
	enRenglon(p1, GENERAL.profesionalDocumento, i.profesional_documento);
	enRenglon(p1, GENERAL.profesionalDocumentoDe, i.profesional_documento_de);
	enRenglon(p1, GENERAL.profesionalTelefono, i.profesional_telefono);
	enRenglon(p1, GENERAL.profesionalDireccion, i.profesional_direccion);

	enRenglon(p1, GENERAL.propietarioNombres, i.propietario_nombres);
	enRenglon(p1, GENERAL.propietarioDocumento, i.propietario_documento);
	enRenglon(p1, GENERAL.propietarioDocumentoDe, i.propietario_documento_de);
	enRenglon(p1, GENERAL.propietarioTelefono, i.propietario_telefono);
	enRenglon(p1, GENERAL.propietarioDireccion, i.propietario_direccion);

	// ── Numeral 2 ──
	enRenglon(p1, LOCALIZACION.departamento, i.departamento);
	enRenglon(p1, LOCALIZACION.municipio, i.municipio);
	enRenglon(p1, LOCALIZACION.direccionCabecera, i.direccion_cabecera);
	enRenglon(p1, LOCALIZACION.corregimiento, i.corregimiento);
	enRenglon(p1, LOCALIZACION.vereda, i.vereda);

	// ── Numerales 3 y 4 ──
	const respuestas: Record<string, number | null> = {
		NO_BENEFICIARIO: i.req_no_beneficiario,
		PROPIETARIO: i.req_propietario,
		NO_ALTO_RIESGO: i.req_no_alto_riesgo
	};

	for (const [codigo, y] of Object.entries(REQUISITOS.filas)) {
		const valor = respuestas[codigo];
		// Sin contestar se deja en blanco: marcar «no» por defecto sería negarle
		// el apoyo a alguien por una casilla que nadie llegó a preguntar.
		if (valor === null || valor === undefined) continue;

		marcar(p1, { x: valor ? REQUISITOS.columnaSi : REQUISITOS.columnaNo, y });
	}

	rodear(p1, i.cumple_requisitos ? CUMPLE.si : CUMPLE.no, CUMPLE.y, 9, 6);

	// A partir de aquí, si no cumple los requisitos el formato ordena no seguir:
	// la inspección queda en blanco y solo se llena el acta del numeral 8.
	if (i.cumple_requisitos) {
		dibujarInspeccion(p1, detalle);
	} else {
		dibujarActa(p1, i);
	}

	// ── Numeral 9 ──
	// Las líneas de FIRMA quedan vacías, a propósito.
	enRenglon(p1, APROBACION.profesional, i.aprobacion_profesional);
	enRenglon(p1, APROBACION.coordinador, i.aprobacion_coordinador);

	dibujarHoja2({ pagina: hoja2, fuente, negrita }, detalle);
	dibujarHoja3({ pagina: hoja3, fuente, negrita }, detalle);

	const bytes = await doc.save();

	return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
}

function dibujarInspeccion(p: Pincel, detalle: DetalleInspeccion): void {
	const i = detalle.inspeccion;

	// ── 5.1 ──
	if (i.evento && EVENTOS[i.evento]) marcar(p, EVENTOS[i.evento]);
	if (i.evento_otro) enRenglon(p, EVENTO_OTRO, i.evento_otro);

	// ── 5.2 y 5.3 ──
	const sistema = i.sistema_constructivo;
	if (!sistema) return;

	if (SISTEMA[sistema]) marcar(p, SISTEMA[sistema]);

	const materiales: Record<string, string | null> = {
		MUROS_DIVISORIOS: i.material_muros,
		PISOS: i.material_pisos,
		ESTRUCTURA: i.material_estructura,
		CUBIERTA: i.material_cubierta
	};

	for (const [categoria, letra] of Object.entries(materiales)) {
		if (!letra || !INFRAESTRUCTURA[categoria]) continue;

		const punto = INFRAESTRUCTURA[categoria];
		const ancho = p.negrita.widthOfTextAtSize(letra, LETRA.normal);
		p.pagina.drawText(paraPdf(letra), {
			x: punto.x - ancho / 2,
			y: arriba(punto.y) - LETRA.normal * 0.35,
			size: LETRA.normal,
			font: p.negrita,
			color: TINTA
		});
	}

	// ── 5.4 ──
	const tabla = EVALUACION[sistema];

	if (tabla && !i.colapso_total) {
		for (const dano of detalle.danos) {
			const y = tabla.filas[dano.elemento];
			if (y === undefined) continue;

			rodear(p, dano.afectado ? tabla.columnas.si : tabla.columnas.no, y, 8, 5.5);

			if (dano.afectado && dano.nivel) {
				const x = tabla.columnas[dano.nivel as keyof typeof tabla.columnas];
				if (typeof x === 'number') marcar(p, { x, y });
			}
		}
	}

	if (i.requiere_evacuacion !== null) {
		rodear(p, i.requiere_evacuacion ? EVACUACION.si : EVACUACION.no, EVACUACION.y, 9, 5.5);
	}

	// ── Numeral 6 ──
	if (i.combo && COMBOS[i.combo]) marcar(p, COMBOS[i.combo]);
	if (i.kit_cubierta && KITS_CUBIERTA[sistema]?.[i.kit_cubierta]) {
		marcar(p, KITS_CUBIERTA[sistema][i.kit_cubierta]);
	}

	// ── Numeral 7 ──
	enRenglon(p, INFORMANTE.nombre, i.informante_nombre);
	enRenglon(p, INFORMANTE.documento, i.informante_documento);
	enRenglon(p, INFORMANTE.parentesco, detalle.parentesco);
	enRenglon(p, INFORMANTE.telefono, i.informante_telefono);
}

function dibujarActa(p: Pincel, i: DetalleInspeccion['inspeccion']): void {
	if (i.acta_modalidad === 'REHABILITACION') marcar(p, ACTA.rehabilitacion);
	if (i.acta_modalidad === 'CONSTRUCCION') marcar(p, ACTA.construccion);

	enRenglon(p, ACTA.nombre, i.acta_nombre);
	enRenglon(p, ACTA.documento, i.acta_documento);
	enRenglon(p, ACTA.telefono, i.acta_telefono);
}

/**
 * La hoja 2 solo lleva su encabezado.
 *
 * Los dos esquemas a mano alzada del numeral 10 se imprimen vacíos: este
 * sistema no los captura. Se entrega la hoja igual porque quitarle una página a
 * un formato oficial de la NGRD es peor que entregarla lista para dibujar.
 */
function dibujarHoja2(p: Pincel, detalle: DetalleInspeccion): void {
	const i = detalle.inspeccion;

	enRenglon(p, HOJA2.entidad, `Alcaldía de ${i.municipio}`);
	enRenglon(p, HOJA2.evento, etiquetaEvento(i));
	enRenglon(p, HOJA2.departamento, i.departamento);
	enRenglon(p, HOJA2.municipio, i.municipio);
	enRenglon(p, HOJA2.veredaBarrio, i.vereda ?? i.corregimiento);
	enRenglon(p, HOJA2.beneficiario, i.propietario_nombres);
	enRenglon(p, HOJA2.cedula, i.propietario_documento);
}

/** La hoja 3: los recuadros quedan vacíos y se escribe el pie de cada foto. */
function dibujarHoja3(p: Pincel, detalle: DetalleInspeccion): void {
	enRenglon(p, HOJA3.entidad, `Alcaldía de ${detalle.inspeccion.municipio}`);
	enRenglon(p, HOJA3.evento, etiquetaEvento(detalle.inspeccion));

	detalle.fotos.slice(0, HOJA3.filas * HOJA3.columnas.length).forEach((foto, n) => {
		// Se llena por filas: primero la izquierda y luego la derecha, que es como
		// se lee el papel.
		const columna = HOJA3.columnas[n % HOJA3.columnas.length];
		const fila = Math.floor(n / HOJA3.columnas.length);

		enRenglon(p, {
			y: HOJA3.primeraY + fila * HOJA3.separacion,
			x0: columna.x0,
			x1: columna.x1
		}, foto.descripcion ?? foto.nombre_original);
	});
}

function etiquetaEvento(i: DetalleInspeccion['inspeccion']): string {
	if (!i.evento) return '';
	if (i.evento === 'OTRO') return i.evento_otro ?? 'Otro';

	// «REMOCION_EN_MASA» → «Remoción en masa». El código se guarda sin tildes;
	// las que faltan se reponen aquí para que el papel se lea bien escrito.
	const con = { REMOCION_EN_MASA: 'Remoción en masa', INUNDACION: 'Inundación' } as const;
	const legible = con[i.evento as keyof typeof con];
	if (legible) return legible;

	const texto = i.evento.replace(/_/g, ' ').toLowerCase();

	return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** El nombre del archivo: el número de ficha, nunca el nombre de una persona. */
export function nombreArchivo(numero: string): string {
	return `${numero.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}
