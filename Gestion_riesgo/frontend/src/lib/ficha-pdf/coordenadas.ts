// Dónde va cada dato dentro del formato oficial FR-1703-SMD-69.
//
// Estas cifras NO están estimadas a ojo: se midieron sobre el propio PDF,
// extrayendo la posición de cada etiqueta impresa y las líneas de la rejilla.
// Por eso los límites de columna de la tabla demográfica son números tan
// concretos — son las líneas verticales reales del formato.
//
// El origen de coordenadas de un PDF está abajo a la izquierda y crece hacia
// arriba, al revés que en una pantalla. Como todas las medidas se tomaron
// contando desde arriba, se guardan así y se convierten en un solo sitio, al
// dibujar. Mezclar los dos sistemas es la forma más fácil de que todo quede
// desplazado sin entender por qué.

/**
 * Dónde vive el formato oficial en blanco.
 *
 * Está aquí, y no junto al código que dibuja, porque lo necesitan tres sitios
 * que no deben cargar la librería de PDF: el Service Worker, que decide si lo
 * guarda, y la preparación para trabajar sin conexión, que lo descarga.
 */
export const RUTA_PLANTILLA = '/formatos/rufe-fr-1703-smd-69-v01.pdf';

/** Tamaño de la página del formato: Carta horizontal. */
export const PAGINA = { ancho: 792, alto: 612 };

/** Un punto donde escribir, medido desde arriba a la izquierda. */
export type Punto = { x: number; y: number; tamano?: number; ancho?: number };

/**
 * Cabecera del evento.
 *
 * Departamento y municipio son constantes del sistema, pero se imprimen igual:
 * el formato es de la UNGRD y debe poder leerse suelto, sin saber de dónde salió.
 */
export const CABECERA = {
	departamento: { x: 115, y: 55, ancho: 142 },
	municipio: { x: 115, y: 66, ancho: 142 },
	evento: { x: 372, y: 55, ancho: 155 },
	// La fecha del evento va dígito a dígito sobre el «D D / M M / A A» impreso.
	fechaEvento: { dia: 399, mes: 426, anio: 459, y: 66 },
	fechaRufe: { dia: 657, mes: 689, anio: 728, y: 58 }
};

/**
 * Casillas que se marcan con una X.
 *
 * En el formato de papel son cuadros vacíos junto a cada opción. La columna de
 * marcado está siempre a la derecha del texto de la opción.
 */
export const MARCAS = {
	zona: {
		URBANO: { x: 124, y: 95 },
		RURAL: { x: 236, y: 95 }
	},
	alojamiento: {
		LUGAR_HABITUAL: { x: 236, y: 151 },
		EVACUADO: { x: 236, y: 162 }
	},
	tenencia: {
		ARRENDATARIO: { x: 350, y: 106 },
		OCUPANTE: { x: 350, y: 117 },
		POSEEDOR: { x: 350, y: 128 },
		PROPIETARIO: { x: 350, y: 139 },
		NO_INFORMA: { x: 350, y: 151 }
	},
	estadoBien: {
		HABITABLE: { x: 452, y: 117 },
		NO_HABITABLE: { x: 452, y: 128 },
		DESTRUIDO: { x: 452, y: 139 },
		NO_INFORMA: { x: 452, y: 151 },
		AVERIADO: { x: 452, y: 162 }
	},
	// El tipo de bien va en dos columnas: la de la izquierda marca en x=598 y la
	// de la derecha en x=770.
	tipoBien: {
		VIVIENDA: { x: 598, y: 95 },
		FINCA: { x: 598, y: 106 },
		LOCAL_COMERCIAL: { x: 598, y: 117 },
		FABRICA: { x: 598, y: 128 },
		BODEGA: { x: 598, y: 139 },
		LOTE: { x: 598, y: 151 },
		CENTRO_BIENESTAR: { x: 598, y: 162 },
		CENTRO_EDUCATIVO: { x: 770, y: 95 },
		CENTRO_ADULTO_MAYOR: { x: 770, y: 106 },
		HOSPITAL: { x: 770, y: 117 },
		ESTADIO: { x: 770, y: 128 },
		IGLESIA: { x: 770, y: 139 },
		ALCALDIA: { x: 770, y: 151 },
		ESTACION_POLICIA: { x: 770, y: 162 }
	}
} as const;

/** Ubicación del bien: los tres campos de texto libre. */
export const UBICACION = {
	corregimiento: { x: 120, y: 106, ancho: 138 },
	veredaSectorBarrio: { x: 120, y: 117, ancho: 138 },
	direccion: { x: 120, y: 128, ancho: 138 }
};

/**
 * Columnas de la tabla demográfica.
 *
 * Son las líneas verticales reales del formato, extraídas del PDF. Cada una
 * define el borde izquierdo y derecho de su celda, para poder centrar los
 * códigos y recortar los nombres largos sin invadir la casilla vecina.
 */
export const COLUMNAS = {
	item: { desde: 12, hasta: 24 },
	nombres: { desde: 24, hasta: 163 },
	apellidos: { desde: 163, hasta: 281 },
	tipoDocumento: { desde: 281, hasta: 329 },
	numeroDocumento: { desde: 329, hasta: 440 },
	parentesco: { desde: 440, hasta: 481 },
	generoM: { desde: 481, hasta: 507 },
	generoF: { desde: 507, hasta: 530 },
	generoT: { desde: 530, hasta: 556 },
	dia: { desde: 556, hasta: 583 },
	mes: { desde: 583, hasta: 607 },
	anio: { desde: 607, hasta: 643 },
	etnia: { desde: 643, hasta: 706 },
	telefono: { desde: 706, hasta: 779 }
} as const;

/** Las diez filas de personas, de 20 puntos cada una. */
export const FILA_PERSONA = { primera: 220, alto: 20, cantidad: 10 };

/** Las cuatro filas del sector agropecuario. */
export const AGRO = {
	primera: 539,
	alto: 15,
	cantidad: 4,
	columnas: {
		tipoCultivo: { desde: 24, hasta: 105 },
		unidadMedida: { desde: 105, hasta: 190 },
		area: { desde: 190, hasta: 240 },
		especie: { desde: 240, hasta: 300 },
		cantidad: { desde: 300, hasta: 346 }
	}
};

/**
 * Vo.Bo. y observaciones.
 *
 * El Vo.Bo. es una firma. Se deja en blanco a propósito cuando la ficha no está
 * validada, y cuando lo está se anota quién y cuándo — pero nunca se dibuja algo
 * que parezca una rúbrica.
 */
export const PIE = {
	vobo: { x: 374, y: 505, ancho: 228, alto: 32 },
	observaciones: { x: 613, y: 505, ancho: 162, alto: 32 }
};

/** Tamaños de letra, del más grande al más pequeño que sigue siendo legible. */
export const LETRA = { normal: 8, tabla: 7.5, pequena: 6.5, minima: 5.5 };
