// Genera la ficha en el formato oficial FR-1703-SMD-69.
//
// No se dibuja un formato parecido: se abre el PDF oficial de la UNGRD y se
// escriben los datos encima. Lo que sale es el formato de verdad, con su código,
// su versión y su fecha de aprobación — que es lo que hace que sirva para
// archivar y para remitir.
//
// Se genera en el navegador y no en el servidor por una razón del stack: este
// backend no tiene Composer, así que las librerías PHP de PDF quedan fuera. Y
// una de las pocas que funcionaría sin él, FPDI, solo lee PDF hasta la versión
// 1.4 y esta plantilla es 1.5.
//
// Efecto secundario útil: como el Service Worker guarda la plantilla, la ficha
// se puede descargar sin conexión.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DetalleCompleto } from '$lib/rufe-form/tipos';
import {
	AGRO,
	CABECERA,
	COLUMNAS,
	FILA_PERSONA,
	LETRA,
	MARCAS,
	PAGINA,
	PIE,
	RUTA_PLANTILLA,
	UBICACION
} from './coordenadas';
import { ajustar, anioCompleto, enLineas, paraPdf, partirFecha } from './texto';

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
 * La plantilla, traída una sola vez.
 *
 * Al descargar un lote de cincuenta fichas, volver a pedirla cincuenta veces
 * serían quince megas de datos para bajar siempre el mismo archivo. Se guarda la
 * promesa, no el resultado, para que dos descargas simultáneas tampoco la pidan
 * dos veces.
 */
let plantillaEnCurso: Promise<ArrayBuffer> | null = null;

export function plantillaOficial(): Promise<ArrayBuffer> {
	plantillaEnCurso ??= (async () => {
		const res = await fetch(RUTA_PLANTILLA);
		if (!res.ok) {
			// Si falla no se guarda el fallo: el siguiente intento vuelve a probar.
			plantillaEnCurso = null;
			throw new Error('No se encontró el formato oficial para generar la ficha.');
		}

		return res.arrayBuffer();
	})();

	return plantillaEnCurso;
}

export async function generarFichaPdf(detalle: DetalleCompleto): Promise<Blob> {
	// Se copia: `PDFDocument.load` puede quedarse con el búfer, y el original
	// tiene que seguir intacto para las demás fichas del lote.
	const pdf = await PDFDocument.load((await plantillaOficial()).slice(0));
	const pincel: Pincel = {
		pagina: pdf.getPages()[0],
		fuente: await pdf.embedFont(StandardFonts.Helvetica),
		negrita: await pdf.embedFont(StandardFonts.HelveticaBold)
	};

	dibujarCabecera(pincel, detalle);
	dibujarUbicacion(pincel, detalle);
	dibujarMarcas(pincel, detalle);
	dibujarPersonas(pincel, detalle);
	dibujarAgro(pincel, detalle);
	dibujarPie(pincel, detalle);

	// `slice()` entrega un búfer propio: el que devuelve pdf-lib puede estar
	// respaldado por memoria compartida, que Blob no admite.
	const bytes = await pdf.save();

	return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
}

// ── Herramientas de dibujo ───────────────────────────────────────────────────

function escribir(
	p: Pincel,
	texto: string,
	x: number,
	y: number,
	tamano = LETRA.normal,
	fuente = p.fuente
): void {
	const limpio = paraPdf(texto);
	if (limpio === '') return;

	p.pagina.drawText(limpio, { x, y: arriba(y), size: tamano, font: fuente, color: TINTA });
}

/** Escribe dentro de un ancho dado, encogiendo la letra antes que recortar. */
function escribirAjustado(p: Pincel, texto: string, x: number, y: number, ancho: number): void {
	const limpio = paraPdf(texto);
	if (limpio.trim() === '') return;

	const { texto: final, tamano } = ajustar(
		limpio,
		ancho,
		(t, s) => p.fuente.widthOfTextAtSize(t, s),
		[LETRA.normal, LETRA.tabla, LETRA.pequena, LETRA.minima]
	);

	escribir(p, final, x, y, tamano);
}

/** Centra un texto corto —un código, una marca— dentro de su columna. */
function centrar(
	p: Pincel,
	texto: string,
	col: { desde: number; hasta: number },
	y: number,
	tamano = LETRA.tabla,
	fuente = p.fuente
): void {
	const limpio = paraPdf(texto);
	if (limpio === '') return;

	const ancho = fuente.widthOfTextAtSize(limpio, tamano);
	escribir(p, limpio, col.desde + (col.hasta - col.desde - ancho) / 2, y, tamano, fuente);
}

/** La X de una casilla marcada. */
function marcar(p: Pincel, punto: { x: number; y: number }): void {
	escribir(p, 'X', punto.x, punto.y, LETRA.normal, p.negrita);
}

// ── Cada bloque del formato ──────────────────────────────────────────────────

function dibujarCabecera(p: Pincel, { reporte: r }: DetalleCompleto): void {
	escribirAjustado(p, r.departamento, CABECERA.departamento.x, CABECERA.departamento.y, CABECERA.departamento.ancho);
	escribirAjustado(p, r.municipio, CABECERA.municipio.x, CABECERA.municipio.y, CABECERA.municipio.ancho);
	escribirAjustado(p, r.evento, CABECERA.evento.x, CABECERA.evento.y, CABECERA.evento.ancho);

	// Las fechas van dígito a dígito sobre el «D D / M M / A A» impreso.
	const evento = partirFecha(r.fecha_evento);
	escribir(p, evento.dia, CABECERA.fechaEvento.dia, CABECERA.fechaEvento.y);
	escribir(p, evento.mes, CABECERA.fechaEvento.mes, CABECERA.fechaEvento.y);
	escribir(p, evento.anio, CABECERA.fechaEvento.anio, CABECERA.fechaEvento.y);

	const rufe = partirFecha(r.fecha_rufe);
	escribir(p, rufe.dia, CABECERA.fechaRufe.dia, CABECERA.fechaRufe.y);
	escribir(p, rufe.mes, CABECERA.fechaRufe.mes, CABECERA.fechaRufe.y);
	escribir(p, rufe.anio, CABECERA.fechaRufe.anio, CABECERA.fechaRufe.y);
}

function dibujarUbicacion(p: Pincel, { reporte: r }: DetalleCompleto): void {
	escribirAjustado(p, r.corregimiento ?? '', UBICACION.corregimiento.x, UBICACION.corregimiento.y, UBICACION.corregimiento.ancho);
	escribirAjustado(p, r.vereda_sector_barrio, UBICACION.veredaSectorBarrio.x, UBICACION.veredaSectorBarrio.y, UBICACION.veredaSectorBarrio.ancho);
	escribirAjustado(p, r.direccion, UBICACION.direccion.x, UBICACION.direccion.y, UBICACION.direccion.ancho);
}

function dibujarMarcas(p: Pincel, { reporte: r }: DetalleCompleto): void {
	const zona = MARCAS.zona[r.zona as keyof typeof MARCAS.zona];
	if (zona) marcar(p, zona);

	const alojamiento = MARCAS.alojamiento[r.alojamiento as keyof typeof MARCAS.alojamiento];
	if (alojamiento) marcar(p, alojamiento);

	const tenencia = MARCAS.tenencia[r.forma_tenencia as keyof typeof MARCAS.tenencia];
	if (tenencia) marcar(p, tenencia);

	const estado = MARCAS.estadoBien[r.estado_bien as keyof typeof MARCAS.estadoBien];
	if (estado) marcar(p, estado);

	const tipo = MARCAS.tipoBien[r.tipo_bien as keyof typeof MARCAS.tipoBien];
	if (tipo) marcar(p, tipo);
}

function dibujarPersonas(p: Pincel, { personas }: DetalleCompleto): void {
	// El formato tiene diez renglones y el sistema no deja registrar más, así que
	// una ficha siempre cabe en una página.
	personas.slice(0, FILA_PERSONA.cantidad).forEach((persona, i) => {
		// El texto se apoya un poco por encima de la línea inferior de la fila.
		const y = FILA_PERSONA.primera + i * FILA_PERSONA.alto + 13;

		escribirAjustado(p, persona.nombres, COLUMNAS.nombres.desde + 3, y, COLUMNAS.nombres.hasta - COLUMNAS.nombres.desde - 6);
		escribirAjustado(p, persona.apellidos, COLUMNAS.apellidos.desde + 3, y, COLUMNAS.apellidos.hasta - COLUMNAS.apellidos.desde - 6);

		// Los códigos, no las etiquetas: es lo que el formato espera en esas
		// casillas, según la leyenda numerada de su pie.
		centrar(p, String(persona.tipo_documento), COLUMNAS.tipoDocumento, y);
		escribirAjustado(p, persona.numero_documento ?? '', COLUMNAS.numeroDocumento.desde + 3, y, COLUMNAS.numeroDocumento.hasta - COLUMNAS.numeroDocumento.desde - 6);
		centrar(p, String(persona.parentesco), COLUMNAS.parentesco, y);

		// Identidad de género: una X en la casilla que corresponde.
		const columnaGenero = { 1: COLUMNAS.generoM, 2: COLUMNAS.generoF, 3: COLUMNAS.generoT }[
			persona.genero as 1 | 2 | 3
		];
		if (columnaGenero) centrar(p, 'X', columnaGenero, y, LETRA.tabla, p.negrita);

		const nacimiento = partirFecha(persona.fecha_nacimiento);
		centrar(p, nacimiento.dia, COLUMNAS.dia, y);
		centrar(p, nacimiento.mes, COLUMNAS.mes, y);
		centrar(p, anioCompleto(persona.fecha_nacimiento), COLUMNAS.anio, y);

		centrar(p, String(persona.pertenencia_etnica), COLUMNAS.etnia, y);
		escribirAjustado(p, persona.telefono ?? '', COLUMNAS.telefono.desde + 3, y, COLUMNAS.telefono.hasta - COLUMNAS.telefono.desde - 6);
	});
}

function dibujarAgro(p: Pincel, { agropecuario }: DetalleCompleto): void {
	const c = AGRO.columnas;

	agropecuario.slice(0, AGRO.cantidad).forEach((renglon, i) => {
		const y = AGRO.primera + i * AGRO.alto + 10;

		escribirAjustado(p, renglon.tipo_cultivo ?? '', c.tipoCultivo.desde + 2, y, c.tipoCultivo.hasta - c.tipoCultivo.desde - 4);
		escribirAjustado(p, renglon.unidad_medida_etiqueta ?? '', c.unidadMedida.desde + 2, y, c.unidadMedida.hasta - c.unidadMedida.desde - 4);
		centrar(p, renglon.area_cantidad === null ? '' : String(renglon.area_cantidad), c.area, y);
		escribirAjustado(p, renglon.especie_pecuaria ?? '', c.especie.desde + 2, y, c.especie.hasta - c.especie.desde - 4);
		centrar(p, renglon.cantidad_unidades === null ? '' : String(renglon.cantidad_unidades), c.cantidad, y);
	});
}

function dibujarPie(p: Pincel, detalle: DetalleCompleto): void {
	const r = detalle.reporte;

	// El Vo.Bo. es una firma. Cuando la ficha está validada se anota quién la
	// validó y cuándo, en letra pequeña; nunca se dibuja nada que parezca una
	// rúbrica. Si no está validada, el recuadro queda en blanco para firmar a
	// mano, que es para lo que está.
	if (r.estado === 'VALIDADO' && r.vobo_en) {
		// Quién validó sale del historial: el detalle no trae ese dato aparte.
		const validacion = [...detalle.historial]
			.reverse()
			.find((m) => m.estado_nuevo === 'VALIDADO');

		const f = partirFecha(r.vobo_en.slice(0, 10));
		escribirAjustado(
			p,
			`Validado el ${f.dia}/${f.mes}/${f.anio}`,
			PIE.vobo.x,
			PIE.vobo.y,
			PIE.vobo.ancho
		);

		if (validacion?.usuario_email) {
			escribirAjustado(p, validacion.usuario_email, PIE.vobo.x, PIE.vobo.y + 10, PIE.vobo.ancho);
		}
	}

	// El radicado no está en el formato de papel, pero sin él una ficha impresa no
	// se puede volver a encontrar en el sistema. Va en el recuadro de
	// observaciones, identificado, antes del texto que escribió el censador.
	const observaciones = [`Radicado ${r.radicado}`, r.observaciones ?? '']
		.filter((t) => t.trim() !== '')
		.join(' · ');

	const lineas = enLineas(paraPdf(observaciones), PIE.observaciones.ancho, 4, (t) =>
		p.fuente.widthOfTextAtSize(t, LETRA.pequena)
	);

	lineas.forEach((linea, i) => {
		escribir(p, linea, PIE.observaciones.x, PIE.observaciones.y + i * 8, LETRA.pequena);
	});
}
