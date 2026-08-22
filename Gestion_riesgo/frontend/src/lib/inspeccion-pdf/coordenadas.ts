// Dónde va cada dato dentro del «Formato de Inspección de Viviendas Afectadas».
//
// Estas cifras NO están estimadas a ojo: se midieron sobre el propio PDF,
// extrayendo la posición de cada etiqueta impresa y de los rectángulos finos con
// que el formato dibuja sus renglones y sus casillas. Por eso son números tan
// concretos.
//
// Igual que en el RUFE, todas las medidas se toman DESDE ARRIBA y se convierten
// en un solo sitio, al dibujar. El origen de un PDF está abajo a la izquierda;
// mezclar los dos sistemas es la forma más fácil de que todo salga desplazado
// sin entender por qué.
//
// Ojo con dos diferencias respecto del formato RUFE: la página es oficio
// VERTICAL (612 × 1008) y no carta horizontal, así que ninguna medida de aquel
// sirve aquí; y el archivo original trae nueve páginas —las tres del formato y
// los anexos—, de las que la plantilla conserva solo las tres primeras.

/** El formato oficial en blanco, ya recortado a sus tres hojas. */
export const RUTA_PLANTILLA = '/formatos/inspeccion-viviendas-ngrd.pdf';

/** Oficio vertical. */
export const PAGINA = { ancho: 612, alto: 1008 };

/** Un renglón sobre el que se escribe: su línea y el tramo que ocupa. */
export type Renglon = { y: number; x0: number; x1: number };

/** Cuánto se levanta el texto sobre la línea impresa para no montarse en ella. */
export const SOBRE_LINEA = 2.2;

export const LETRA = { normal: 8, pequena: 7, minima: 5.5, diminuta: 5, marca: 9 };

// ── Hoja 1 · Numeral 1: información general ─────────────────────────────────

export const GENERAL = {
	/**
	 * La casilla amarilla «Ficha No.» del encabezado: x 525.1–551.3, y 124.3–132.3.
	 *
	 * Son 26 puntos de ancho, pensados para un consecutivo corto. El número
	 * completo —INSP-2026-K7M2QP4B— no cabe ni en la letra más pequeña, así que
	 * se imprime solo su sufijo, que ya es único por sí mismo (32^8) y con el que
	 * el buscador del sistema encuentra la ficha. El año va al lado, en la fecha.
	 */
	ficha: { y: 132.3, x0: 525.1, x1: 551.3 },
	profesionalNombre: { y: 148.5, x0: 186.5, x1: 283.7 },
	profesionalTarjeta: { y: 160.2, x0: 140.5, x1: 283.7 },
	profesionalProfesion: { y: 171.5, x0: 96.5, x1: 197.6 },
	profesionalDocumento: { y: 179.3, x0: 85.6, x1: 197.6 },
	profesionalDocumentoDe: { y: 179.3, x0: 222.2, x1: 283.7 },
	profesionalTelefono: { y: 202.7, x0: 85.6, x1: 166.2 },
	profesionalDireccion: { y: 202.7, x0: 230.2, x1: 301.7 },

	propietarioNombres: { y: 179.3, x0: 307.9, x1: 513.7 },
	propietarioDocumento: { y: 187.1, x0: 344.8, x1: 397.0 },
	propietarioDocumentoDe: { y: 187.1, x0: 414.9, x1: 513.7 },
	propietarioTelefono: { y: 202.7, x0: 344.8, x1: 415.0 },
	propietarioDireccion: { y: 202.7, x0: 466.7, x1: 546.5 },

	/** «ALCALDÍA/GOBERNACIÓN» del encabezado. */
	entidad: { y: 113.1, x0: 270.4, x1: 466.8 }
} as const satisfies Record<string, Renglon>;

/**
 * El «D D / M M / A A» impreso de la fecha de evaluación.
 *
 * Los separadores verticales están en x 513.3, 524.3 y 535.2, así que cada par
 * de dígitos va centrado entre ellos. El año se imprime de dos cifras: escribir
 * cuatro se saldría de la casilla.
 */
export const FECHA_EVALUACION = { dia: 517, mes: 528, anio: 539, y: 147.0 } as const;

// ── Hoja 1 · Numeral 2: localización ────────────────────────────────────────

export const LOCALIZACION = {
	departamento: { y: 232.6, x0: 140.5, x1: 281.0 },
	municipio: { y: 252.1, x0: 140.5, x1: 281.0 },
	direccionCabecera: { y: 270.0, x0: 140.5, x1: 281.0 },
	corregimiento: { y: 288.7, x0: 140.5, x1: 281.0 },
	vereda: { y: 312.6, x0: 140.5, x1: 281.0 }
} as const satisfies Record<string, Renglon>;

// ── Hoja 1 · Numerales 3 y 4: requisitos ────────────────────────────────────
//
// Dos columnas de casillas —SÍ y NO— y una fila por requisito. Los centros
// salen de los bordes reales de cada casilla, no del ancho del texto: la
// columna SÍ va de x 513.9 a 524.9 y la NO de 535.8 a 546.7.

export const REQUISITOS = {
	columnaSi: 519.4,
	columnaNo: 541.2,
	// Centro vertical de cada casilla: 232.6–251.5, 256.9–288.1 y 293.5–312.0.
	filas: {
		NO_BENEFICIARIO: 244.0,
		PROPIETARIO: 275.0,
		NO_ALTO_RIESGO: 305.0
	}
} as const;

/**
 * El numeral 4, que resume los tres anteriores.
 *
 * Su recuadro va de x 307.9 a 345.0 con un separador en 328.6/329.8, y las
 * etiquetas SI/NO impresas ocupan la parte de arriba: la marca va debajo.
 */
export const CUMPLE = { si: 319.0, no: 337.5, y: 317.8 } as const;

// ── Hoja 1 · Numeral 5.1: tipo de evento ────────────────────────────────────
//
// Las casillas de esta fila son cuadros de unos 8 pt, medidos uno a uno; van
// entre y 357.9 y 365.7.

export const EVENTOS: Record<string, { x: number; y: number }> = {
	INUNDACION: { x: 136.4, y: 361.8 },
	VENDAVAL: { x: 239.3, y: 361.8 },
	SISMO: { x: 337.4, y: 361.8 },
	AVENIDA_TORRENCIAL: { x: 420.0, y: 361.8 },
	REMOCION_EN_MASA: { x: 530.3, y: 361.8 }
};

/** El renglón de «OTRO, ¿CUÁL?». */
export const EVENTO_OTRO: Renglon = { y: 376.0, x0: 131.5, x1: 222.3 };

// ── Hoja 1 · Numeral 5.2: sistema constructivo ──────────────────────────────

export const SISTEMA: Record<string, { x: number; y: number }> = {
	MAMPOSTERIA: { x: 239.3, y: 392.5 },
	MADERA: { x: 410.0, y: 392.5 }
};

// ── Hoja 1 · Numeral 5.3: infraestructura actual ────────────────────────────
//
// Cuatro casillas anchas (85.9–166.5, 211.6–270.8, 308.2–389.2 y 404.8–486.0)
// que contienen su propia etiqueta impresa; la letra de la convención se
// escribe a la derecha, dentro de la misma casilla.

export const INFRAESTRUCTURA: Record<string, { x: number; y: number }> = {
	MUROS_DIVISORIOS: { x: 155.0, y: 424.3 },
	PISOS: { x: 258.0, y: 424.3 },
	ESTRUCTURA: { x: 376.0, y: 424.3 },
	CUBIERTA: { x: 473.0, y: 424.3 }
};

// ── Hoja 1 · Numeral 5.4: evaluación técnica ────────────────────────────────
//
// Dos tablas gemelas, una por sistema constructivo. Las `y` son los centros de
// cada fila, sacados de los separadores reales (529.3, 543.2, 558.9, 573.8,
// 589.0, 603.0, 618.2 y 631.6); las `x`, los centros de las columnas del
// encabezado impreso.

export type ColumnasEvaluacion = {
	si: number;
	no: number;
	LEVE: number;
	MODERADO: number;
	SEVERO: number;
	COLAPSO_TOTAL: number;
};

export const EVALUACION: Record<
	string,
	{ columnas: ColumnasEvaluacion; filas: Record<string, number> }
> = {
	MAMPOSTERIA: {
		columnas: {
			si: 148.8,
			no: 176.8,
			LEVE: 209.9,
			MODERADO: 235.0,
			SEVERO: 259.2,
			COLAPSO_TOTAL: 286.2
		},
		filas: {
			VIGAS_COLUMNAS: 535.9,
			MUROS_CARGA: 550.7,
			MUROS_DIVISORIOS: 566.0,
			PLACA_PISO: 581.0,
			CUBIERTA: 595.7,
			HIDROSANITARIAS: 610.2,
			ELECTRICAS: 624.6
		}
	},
	MADERA: {
		columnas: {
			si: 400.6,
			no: 420.2,
			LEVE: 445.1,
			MODERADO: 470.8,
			SEVERO: 499.7,
			COLAPSO_TOTAL: 530.1
		},
		filas: {
			VIGAS_COLUMNAS: 535.9,
			ENTREPISOS: 550.7,
			MUROS_MADERA: 566.0,
			CUBIERTA: 581.0,
			HIDROSANITARIAS: 595.7,
			ELECTRICAS: 610.4
		}
	}
};

/** «Requiere evacuación la vivienda»: Sí y No, al pie de la tabla de madera. */
export const EVACUACION = { si: 439.9, no: 476.2, y: 633.8 } as const;

// ── Hoja 1 · Numeral 6: banco de materiales ─────────────────────────────────
//
// La fila de mampostería va de y 677.5 a 696.7 y la de madera de 696.7 a 710.7;
// las columnas salen de los encabezados COMBO 1 … COMBO 6. El recuadro de
// colapso total tiene su propia columna, entre x 329.6 y 344.6.

export const COMBOS: Record<string, { x: number; y: number }> = {
	COMBO_1: { x: 176.9, y: 687.1 },
	COMBO_2: { x: 214.3, y: 687.1 },
	COMBO_3: { x: 250.4, y: 687.1 },
	COMBO_4: { x: 286.2, y: 703.7 },
	COMBO_5: { x: 315.9, y: 703.7 },
	COMBO_6: { x: 348.6, y: 703.7 },
	COLAPSO_MAMPOSTERIA: { x: 337.0, y: 720.3 },
	COLAPSO_MADERA: { x: 337.0, y: 727.2 }
};

/** La columna «MARQUE CON UNA (X)» de los kits de cubierta. */
export const KITS_CUBIERTA: Record<string, Record<string, { x: number; y: number }>> = {
	MAMPOSTERIA: {
		ZINC: { x: 505.0, y: 680.5 },
		FIBROCEMENTO: { x: 505.0, y: 690.1 }
	},
	MADERA: {
		ZINC: { x: 505.0, y: 703.4 }
	}
};

// ── Hoja 1 · Numerales 7, 8 y 9 ─────────────────────────────────────────────

/** Quien suministró la información: la fila bajo el encabezado impreso. */
export const INFORMANTE = {
	nombre: { y: 778.2, x0: 74.7, x1: 140.7 },
	documento: { y: 778.2, x0: 156.1, x1: 283.7 },
	parentesco: { y: 778.2, x0: 329.2, x1: 445.4 },
	telefono: { y: 778.2, x0: 455.7, x1: 546.5 }
} as const satisfies Record<string, Renglon>;

/**
 * El acta del numeral 8.
 *
 * Los paréntesis de «rehabilitación ( ) o construcción ( )» están dentro del
 * texto impreso; sus posiciones se sacaron palabra por palabra del PDF.
 */
export const ACTA = {
	rehabilitacion: { x: 531.5, y: 799.5 },
	construccion: { x: 313.0, y: 807.0 },
	nombre: { y: 828.0, x0: 74.7, x1: 140.7 },
	documento: { y: 828.0, x0: 156.1, x1: 283.7 },
	telefono: { y: 828.0, x0: 455.7, x1: 546.5 }
} as const;

/**
 * El numeral 9.
 *
 * Los renglones de FIRMA (y 855.8) se dejan EN BLANCO a propósito: este sistema
 * no captura firmas, y dibujar cualquier cosa sobre esa línea sería fabricar
 * una rúbrica. Solo se escriben los nombres, bajo el «NOMBRE:» impreso.
 */
export const APROBACION = {
	profesional: { y: 879.8, x0: 140.5, x1: 270.5 },
	coordinador: { y: 879.8, x0: 388.9, x1: 490.5 }
} as const satisfies Record<string, Renglon>;

// ── Hoja 2 · encabezado del plano ───────────────────────────────────────────
//
// El numeral 10 son dos cuadrículas para dibujar a mano alzada, que este
// sistema no captura: se imprimen vacías. El encabezado sí se llena, para que
// la hoja no salga anónima y se pueda archivar junto a las otras dos. Quitarle
// una página a un formato oficial sería peor que entregarla lista para dibujar.

export const HOJA2 = {
	entidad: { y: 158.7, x0: 290.1, x1: 368.0 },
	evento: { y: 158.7, x0: 504.0, x1: 535.3 },
	departamento: { y: 190.3, x0: 147.6, x1: 241.5 },
	municipio: { y: 190.3, x0: 299.8, x1: 387.4 },
	veredaBarrio: { y: 190.3, x0: 504.0, x1: 535.3 },
	beneficiario: { y: 215.9, x0: 192.8, x1: 338.8 },
	cedula: { y: 215.9, x0: 387.3, x1: 474.9 }
} as const satisfies Record<string, Renglon>;

// ── Hoja 3 · registro fotográfico ───────────────────────────────────────────
//
// Diez recuadros en dos columnas de cinco, cada uno con su «FOTOGRAFIA DE:
// ____» donde se identifica el elemento afectado. Las filas están separadas
// 159.6 pt exactos, medidos entre los renglones del pie.
//
// Las fotos NO se incrustan: el registro fotográfico se imprime con los
// recuadros vacíos y los pies escritos. Meter diez imágenes convertiría un PDF
// de 220 KB en uno de varios megas que nadie puede mandar por correo desde una
// vereda, y las fotos ya viven en el expediente, donde se ven a tamaño
// completo.

export const HOJA3 = {
	entidad: { y: 110.7, x0: 270.0, x1: 330.6 },
	evento: { y: 110.7, x0: 493.2, x1: 574.7 },
	/** El renglón del pie, por columna. */
	columnas: [
		{ x0: 104.3, x1: 283.7 },
		{ x0: 384.7, x1: 561.1 }
	],
	primeraY: 300.4,
	separacion: 159.6,
	filas: 5
} as const;
