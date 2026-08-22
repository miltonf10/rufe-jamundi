// La forma de una inspección ya registrada, tal como la devuelve el servidor.
//
// Vive aparte de `tipos.ts` porque no es lo mismo: aquello describe el
// formulario que se está llenando y esto el expediente que ya existe. Mezclarlos
// obligaría a que cada campo fuera opcional en los dos sentidos.

export type ItemMaterial = { descripcion: string; unidad: string; cantidad: string };

export type KitMaterial = { kit: string; items: ItemMaterial[] };

export type ListaMateriales = {
	kits: KitMaterial[];
	/** El Anexo 2 no define materiales para colapso total. */
	sin_lista: boolean;
	nota: string;
};

export type DanoRegistrado = {
	elemento: string;
	etiqueta: string;
	afectado: boolean;
	nivel: string | null;
	etiqueta_nivel: string | null;
};

export type InspeccionRegistrada = {
	id: number;
	numero: string;
	estado: string;
	fecha_evaluacion: string;
	cumple_requisitos: number;
	profesional_nombre: string;
	profesional_tarjeta: string;
	profesional_profesion: string;
	profesional_documento: string;
	profesional_documento_de: string | null;
	profesional_telefono: string;
	profesional_direccion: string | null;
	propietario_nombres: string;
	propietario_documento: string;
	propietario_documento_de: string | null;
	propietario_telefono: string | null;
	propietario_direccion: string | null;
	departamento: string;
	municipio: string;
	direccion_cabecera: string | null;
	corregimiento: string | null;
	vereda: string | null;
	/** El punto GPS tomado frente a la vivienda. Nulo si no se pudo tomar. */
	latitud: string | null;
	longitud: string | null;
	precision_m: number | null;
	req_no_beneficiario: number | null;
	req_propietario: number | null;
	req_no_alto_riesgo: number | null;
	evento: string | null;
	evento_otro: string | null;
	sistema_constructivo: string | null;
	material_muros: string | null;
	material_pisos: string | null;
	material_estructura: string | null;
	material_cubierta: string | null;
	colapso_total: number;
	requiere_evacuacion: number | null;
	combo: string | null;
	combo_nivel: string | null;
	combo_motivo: string | null;
	kit_cubierta: string | null;
	informante_nombre: string | null;
	informante_documento: string | null;
	informante_parentesco: number | null;
	informante_telefono: string | null;
	acta_modalidad: string | null;
	acta_nombre: string | null;
	acta_documento: string | null;
	acta_telefono: string | null;
	aprobacion_profesional: string;
	aprobacion_coordinador: string | null;
	rufe_reporte_id: number | null;
	creado_en: string;
};

export type DetalleInspeccion = {
	inspeccion: InspeccionRegistrada;
	danos: DanoRegistrado[];
	/** La lista GUARDADA, no una recalculada: la norma puede haber cambiado. */
	materiales: ListaMateriales | null;
	parentesco: string | null;
	requisitos: Record<string, string>;
	kits_cubierta: Record<string, Record<string, string>>;
	historial: { estado: string; nota: string | null; usuario_email: string | null; creado_en: string }[];
	fotos: {
		id: number;
		/** El «FOTOGRAFIA DE:» del numeral 11. */
		descripcion: string | null;
		nombre_original: string;
		extension: string;
		tamano_bytes: number;
		mime: string;
	}[];
};
