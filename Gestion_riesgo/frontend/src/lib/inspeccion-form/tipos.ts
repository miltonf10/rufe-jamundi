// La forma de los datos del «Formato de Inspección de Viviendas Afectadas».
//
// Los nombres de los campos siguen a los numerales del papel, no a una
// nomenclatura propia: quien coteje el expediente con el formato impreso tiene
// que poder seguir la pista sin traducir.
//
// Todo lo que en el papel es una casilla que se puede dejar en blanco es aquí
// `null`, nunca `false`. La diferencia importa en el numeral 3: «no cumple» y
// «todavía no lo he preguntado» son cosas distintas, y solo la primera cierra
// la puerta al banco de materiales.

import type { TablasCombo } from './combo';
import type { Anexo2 } from './materiales';

export type Sistema = 'MAMPOSTERIA' | 'MADERA';

export type Opcion = { codigo: string; etiqueta: string };

/** Un nivel de daño con los criterios del Anexo 1 que lo definen. */
export type NivelConCriterios = {
	codigo: string;
	etiqueta: string;
	/** Reparación, reforzamiento, reconstrucción parcial… */
	alcance: string;
	criterios: string[];
};

export type ElementoEvaluable = {
	codigo: string;
	etiqueta: string;
	/** Los que deciden el combo del numeral 6. */
	estructural: boolean;
	niveles: NivelConCriterios[];
};

export type Convencion = { etiqueta: string; opciones: Record<string, string> };

/** Lo que devuelve `GET /inspeccion/catalogos`. Incluye las tablas del combo. */
export type Catalogos = TablasCombo & {
	formato: { nombre: string; codigo: string };
	fijos: { departamento: string; municipio: string };
	limites: {
		fotos: number;
		descripcion_foto: number;
		texto: number;
		anos_atras: number;
		bytes_archivo: number;
		objetivo_bytes_foto: number;
		bytes_carga: number;
		extensiones: string[];
	};
	profesiones: Opcion[];
	eventos: Opcion[];
	requisitos: Opcion[];
	corregimientos: string[];
	parentescos: Opcion[];
	convenciones: Record<string, Convencion>;
	/** Qué kit de cubierta sugiere el material encontrado: Z → ZINC, Ac → FIBROCEMENTO. */
	kit_sugerido: Record<string, string>;
	sistemas: Opcion[];
	kits_cubierta: Record<string, Record<string, string>>;
	evaluacion: Record<string, ElementoEvaluable[]>;
	/** El Anexo 2 entero, para armar la lista de materiales sin señal. */
	anexo2: Anexo2;
};

/** Una fila de la tabla del numeral 5.4. */
export type DanoElemento = {
	/** «¿El elemento fue afectado?» — null mientras no se conteste. */
	afectado: boolean | null;
	/** Solo tiene sentido con `afectado === true`. */
	nivel: string | null;
};

export type FormularioInspeccion = {
	// ── 1. Información general ───────────────────────────────────────────────
	fecha_evaluacion: string;
	profesional_nombre: string;
	profesional_tarjeta: string;
	profesional_profesion: string;
	/** Solo cuando la profesión elegida es «Otra». */
	profesional_profesion_otra: string;
	profesional_documento: string;
	/** El «De ___» del formato: dónde se expidió la cédula. */
	profesional_documento_de: string;
	profesional_telefono: string;
	profesional_direccion: string;

	/** El formato pide «Nombres y Apellidos» en un solo renglón. Se respeta. */
	propietario_nombres: string;
	propietario_documento: string;
	propietario_documento_de: string;
	propietario_telefono: string;
	propietario_direccion: string;

	// ── 2. Localización de la vivienda ───────────────────────────────────────
	direccion_cabecera: string;
	corregimiento: string;
	vereda: string;
	/**
	 * El punto GPS de la vivienda, tomado estando frente a ella.
	 *
	 * No tiene casilla en el papel, y aun así se guarda: «finca La Esperanza, vía
	 * a Potrerito» no lleva a nadie hasta la casa dos semanas después, cuando hay
	 * que ir a entregar los materiales. Es opcional, como en el censo, porque el
	 * GPS no siempre engancha.
	 */
	latitud: number | null;
	longitud: number | null;
	precision_m: number | null;

	// ── 3. Requisitos ────────────────────────────────────────────────────────
	/** Uno por cada requisito del formato. `null` es «sin contestar». */
	requisitos: Record<string, boolean | null>;

	// ── 5. Inspección ────────────────────────────────────────────────────────
	evento: string;
	evento_otro: string;
	sistema_constructivo: Sistema | '';
	/** 5.3: la letra de la convención por cada categoría. */
	infraestructura: Record<string, string>;

	/** 5.4, por código de elemento. */
	danos: Record<string, DanoElemento>;
	colapso_total: boolean;
	requiere_evacuacion: boolean | null;

	// ── 6. Banco de materiales ───────────────────────────────────────────────
	/** El combo lo calcula el servidor; aquí solo se elige la cubierta. */
	kit_cubierta: string;

	// ── 7. Quién suministra la información ───────────────────────────────────
	informante_nombre: string;
	informante_documento: string;
	informante_parentesco: number | null;
	informante_telefono: string;

	// ── 8. Acta de quien no cumple los requisitos ────────────────────────────
	/** «…para la rehabilitación ( ) o construcción ( ) de vivienda». */
	acta_modalidad: 'REHABILITACION' | 'CONSTRUCCION' | '';
	acta_nombre: string;
	acta_documento: string;
	acta_telefono: string;

	// El numeral 9 —la aprobación— NO se captura aquí. Quien llena la ficha no
	// puede aprobarla en el mismo acto: se levanta en la puerta de una casa y de
	// ella depende una entrega de materiales públicos. La decisión se toma
	// después, sobre la ficha guardada, igual que en el censo.

	// ── Vínculo opcional con el censo ────────────────────────────────────────
	/** Ficha RUFE de la que se partió, si se partió de una. */
	rufe_reporte_id: number | null;
};
