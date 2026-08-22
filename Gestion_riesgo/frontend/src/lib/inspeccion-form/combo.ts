// El combo de materiales del numeral 6, calculado en el navegador.
//
// Es un espejo de `backend/src/Inspeccion/BancoMateriales.php`, NO un
// sustituto. El servidor calcula y su resultado es el que se guarda: de este
// número depende una entrega de materiales públicos y no puede quedar en manos
// de lo que el teléfono haya decidido. Esto existe para que el profesional vea
// el combo cambiar mientras llena la tabla del 5.4, sin esperar una petición
// que en una vereda puede no llegar nunca.
//
// Lo único que está duplicado es el algoritmo —las tablas viajan en los
// catálogos, `catalogos.niveles`, `catalogos.estructurales` y
// `catalogos.combos`—, y las dos implementaciones se ejercitan contra la misma
// tabla de casos: `backend/tests/fixtures/combos.json`.

export type NivelDano = string;

/** Las tablas que manda el servidor. Se piden así para no copiarlas aquí. */
export type TablasCombo = {
	/** Los niveles de menos a más grave. El orden ES la definición de «peor». */
	niveles: NivelDano[];
	/** Qué elementos deciden el combo, por sistema constructivo. */
	estructurales: Record<string, string[]>;
	combos: Record<string, Record<string, { codigo: string; etiqueta: string }>>;
};

export type Danos = Record<string, NivelDano | null | undefined>;

export type ResultadoCombo = {
	combo: string | null;
	etiqueta: string | null;
	nivel: NivelDano | null;
	/** Cuál de los estructurales decidió. `null` con colapso total o sin daño. */
	elemento: string | null;
};

/** El peor de dos niveles. `null` es «sin daño» y pierde contra cualquiera. */
export function peor(
	a: NivelDano | null,
	b: NivelDano | null,
	niveles: NivelDano[]
): NivelDano | null {
	if (a === null) return b;
	if (b === null) return a;

	return niveles.indexOf(a) >= niveles.indexOf(b) ? a : b;
}

/**
 * El nivel que manda: el peor entre los elementos estructurales.
 *
 * Solo los estructurales, que es la regla impresa en el numeral 6. Una cubierta
 * arrancada sobre una estructura intacta no convierte el caso en severo.
 */
export function nivelEstructural(
	tablas: TablasCombo,
	sistema: string,
	danos: Danos
): { nivel: NivelDano | null; elemento: string | null } {
	let nivel: NivelDano | null = null;
	let elemento: string | null = null;

	for (const codigo of tablas.estructurales[sistema] ?? []) {
		const suyo = danos[codigo] ?? null;
		if (suyo === null) continue;

		const peorAhora = peor(nivel, suyo, tablas.niveles);

		// Solo cambia el responsable cuando el nivel de verdad empeora: con un
		// empate manda el primero de la lista, que es el orden del formato. Así
		// el motivo que se muestra no depende del orden de recorrido.
		if (peorAhora !== nivel) {
			nivel = peorAhora;
			elemento = codigo;
		}
	}

	return { nivel, elemento };
}

/**
 * El combo que corresponde, a partir de la evaluación técnica.
 *
 * Devuelve `combo: null` cuando no corresponde ninguno —sin daño estructural, o
 * sin sistema constructivo elegido todavía—, que es un estado normal del
 * formulario a medio llenar y no un error.
 */
export function determinarCombo(
	tablas: TablasCombo,
	sistema: string,
	danos: Danos,
	colapsoTotal = false
): ResultadoCombo {
	const porSistema = tablas.combos[sistema];
	const vacio: ResultadoCombo = { combo: null, etiqueta: null, nivel: null, elemento: null };

	if (!porSistema) return vacio;

	// «Si la vivienda sufrió colapso estructural total, marque solo esta
	// casilla»: manda sobre la tabla por elementos.
	if (colapsoTotal) {
		const c = porSistema.COLAPSO_TOTAL;

		return { combo: c.codigo, etiqueta: c.etiqueta, nivel: 'COLAPSO_TOTAL', elemento: null };
	}

	const { nivel, elemento } = nivelEstructural(tablas, sistema, danos);
	if (nivel === null) return vacio;

	const c = porSistema[nivel];
	if (!c) return vacio;

	return { combo: c.codigo, etiqueta: c.etiqueta, nivel, elemento };
}

/**
 * Por qué salió ese combo, en una frase.
 *
 * Se muestra siempre junto al combo: quien revisa el expediente —o la familia
 * que pregunta por qué le dan un combo y no otro— tiene derecho a ver el
 * razonamiento sin rehacerlo.
 */
export function motivoDelCombo(
	r: ResultadoCombo,
	etiquetaElemento: (codigo: string) => string,
	etiquetaNivel: (codigo: string) => string
): string {
	if (r.nivel === 'COLAPSO_TOTAL' && r.elemento === null) {
		return 'La vivienda sufrió colapso estructural total.';
	}

	if (r.combo === null) {
		return 'El sistema estructural no resultó afectado, así que no corresponde combo de materiales.';
	}

	return `Daño ${etiquetaNivel(r.nivel as string).toLowerCase()} en ${etiquetaElemento(
		r.elemento as string
	).toLowerCase()}.`;
}
