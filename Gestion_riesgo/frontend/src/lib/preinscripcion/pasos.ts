// Los pasos de la pre-inscripción ciudadana y qué se valida en cada uno.
//
// Antes esto era una sola página larga, y la razón que se escribió entonces era
// que «quien llena esto lo hace una vez en su vida y necesita ver de un vistazo
// qué le van a preguntar». Resultó al revés: en la pantalla de un celular esa
// página de un vistazo es un rollo de siete secciones donde no se sabe cuánto
// falta, y donde un error de validación al final obliga a subir a buscarlo. El
// censo lleva meses en producción con pasos y ese es el patrón que la gente de
// aquí ya reconoce.
//
// Como en el RUFE (`$lib/rufe-form/esquema.ts`) los pasos están como DATOS en un
// solo archivo, no repartidos por el componente: así una prueba puede comprobar
// que ningún campo se quedó sin paso y que cada condición está escrita una vez.
//
// Espejo de `backend/src/Preinscripcion/Validador.php`, no sustituto: esto
// existe para que el error salga junto al campo sin esperar una petición. Quien
// decide es PHP — la ruta es pública y cualquiera puede saltarse el navegador.

export type IdPasoPre = 'datos' | 'vivienda' | 'video' | 'envio';

export type PasoPre = {
	id: IdPasoPre;
	titulo: string;
	ayuda: string;
};

/**
 * Los cuatro pasos, en orden.
 *
 * El video es el único que puede no existir: mientras nadie haya definido
 * categorías, no hay nada que grabar. Ver `pasosVigentes`.
 */
export const PASOS_PRE: PasoPre[] = [
	{
		id: 'datos',
		titulo: 'Sus datos',
		ayuda: 'Quién es y dónde queda la vivienda afectada.'
	},
	{
		id: 'vivienda',
		titulo: 'Cómo quedó la vivienda',
		ayuda: 'Marque todo lo que reconozca. No hace falta saber de construcción.'
	},
	{
		id: 'video',
		titulo: 'Videos de la vivienda',
		ayuda: 'Grabe lo que se le pide en cada punto. Si no puede, continúe igual.'
	},
	{
		id: 'envio',
		titulo: 'Autorización y envío',
		ayuda: 'Un último paso y queda registrada su solicitud.'
	}
];

/**
 * Los pasos que se recorren de verdad.
 *
 * Sin categorías de video configuradas, el paso 3 sería una pantalla vacía con
 * un botón de «Siguiente». Y hoy en producción no hay ninguna: el catálogo lo
 * define quien tiene el criterio estructural para decidir qué debe grabarse, y
 * hasta entonces el módulo está inerte a propósito.
 */
export function pasosVigentes(hayCategoriasVideo: boolean): PasoPre[] {
	return PASOS_PRE.filter((p) => p.id !== 'video' || hayCategoriasVideo);
}

// ── Validación ───────────────────────────────────────────────────────────────

export type Errores = Record<string, string>;

/** Lo que el formulario recoge. Un espejo de lo que acepta el validador de PHP. */
export type DatosPre = {
	nombre_completo: string;
	documento: string;
	telefono: string;
	correo: string;
	direccion: string;
	zona: 'URBANA' | 'RURAL' | '';
	corregimiento: string;
	vereda: string;
	senales: string[];
	descripcion_dano: string;
	autoriza_datos: boolean;
	latitud: number | null;
	longitud: number | null;
	precision_m: number | null;
	sitio_web: string;
};

export function datosVacios(): DatosPre {
	return {
		nombre_completo: '',
		documento: '',
		telefono: '',
		correo: '',
		direccion: '',
		zona: '',
		corregimiento: '',
		vereda: '',
		senales: [],
		descripcion_dano: '',
		autoriza_datos: false,
		latitud: null,
		longitud: null,
		precision_m: null,
		// Trampa para robots: oculta por CSS, una persona nunca la ve.
		sitio_web: ''
	};
}

const SOLO_DIGITOS = /\D+/g;

// Deliberadamente laxo. Un correo se valida de verdad mandándole un mensaje, y
// aquí es opcional: la única función de esta comprobación es cazar la errata
// obvia, no decidir quién puede pedir una inspección.
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarPaso(paso: IdPasoPre, d: DatosPre): Errores {
	const e: Errores = {};

	if (paso === 'datos') {
		const nombre = d.nombre_completo.trim();
		if (nombre.length < 5 || nombre.length > 200) {
			e.nombre_completo = 'Escriba su nombre y sus apellidos.';
		}

		// La gente escribe la cédula como la lee en su documento, con puntos.
		// Se cuentan los dígitos, no los caracteres.
		const documento = d.documento.replace(SOLO_DIGITOS, '');
		if (documento.length < 5 || documento.length > 15) {
			e.documento = 'Escriba su número de cédula, sin puntos ni espacios.';
		}

		const telefono = d.telefono.replace(SOLO_DIGITOS, '');
		if (telefono.length < 7 || telefono.length > 15) {
			e.telefono = 'Escriba un teléfono donde podamos llamarle.';
		}

		const correo = d.correo.trim();
		if (correo !== '' && (!RE_CORREO.test(correo) || correo.length > 150)) {
			e.correo = 'Ese correo no parece válido. Puede dejarlo en blanco.';
		}

		const direccion = d.direccion.trim();
		if (direccion.length < 5 || direccion.length > 200) {
			e.direccion = 'Escriba dónde queda la vivienda, como se lo explicaría a alguien que va a buscarla.';
		}

		if (d.zona !== 'URBANA' && d.zona !== 'RURAL') {
			e.zona = 'Indique si la vivienda está en zona urbana o rural.';
		}
	}

	// 'vivienda' y 'video' no validan nada, y eso es una decisión, no un olvido.
	//
	// Ninguna señal es obligatoria: quien tiene la casa partida por la mitad
	// puede no reconocerse en ninguno de los ocho dibujos. Ningún video lo es
	// tampoco: quien tiene un celular viejo o está sin señal no puede quedarse
	// sin turno por eso. Lo que falte se marca en la bandeja, para que quien
	// revisa lo sepa.

	if (paso === 'envio') {
		if (!d.autoriza_datos) {
			e.autoriza_datos = 'Debe autorizar el tratamiento de sus datos para continuar.';
		}

		if (d.descripcion_dano.length > 1000) {
			e.descripcion_dano = 'Resuma en menos de 1000 caracteres.';
		}
	}

	return e;
}

/**
 * Lo que se manda al servidor.
 *
 * El corregimiento se descarta en zona urbana, igual que hace PHP: si alguien
 * eligió uno y después corrigió la zona, ese dato sobrante no debe viajar.
 */
export function paraEnviar(d: DatosPre): Record<string, unknown> {
	return {
		nombre_completo: d.nombre_completo.trim(),
		documento: d.documento.replace(SOLO_DIGITOS, ''),
		telefono: d.telefono.replace(SOLO_DIGITOS, ''),
		correo: d.correo.trim(),
		direccion: d.direccion.trim(),
		zona: d.zona,
		corregimiento: d.zona === 'RURAL' ? d.corregimiento : '',
		vereda: d.vereda.trim(),
		senales: d.senales,
		descripcion_dano: d.descripcion_dano.trim(),
		autoriza_datos: d.autoriza_datos,
		latitud: d.latitud,
		longitud: d.longitud,
		precision_m: d.precision_m,
		sitio_web: d.sitio_web
	};
}

/**
 * Qué impide seguir adelante ahora mismo, aparte de los campos.
 *
 * Devuelve el aviso que hay que enseñar, o cadena vacía si se puede.
 *
 * Vive aquí y no dentro del componente porque es una REGLA, no un detalle de
 * pantalla, y porque enviar con un video a medias no se nota: el servidor
 * recibe un archivo incompleto, lo descarta —no se puede reproducir— y la
 * persona ve «Solicitud registrada» creyendo que su video llegó. Es la clase de
 * fallo que solo se descubre cuando alguien pregunta dónde quedó su video.
 */
export function bloqueoDeAvance(estado: {
	optimizandoFotos: boolean;
	videosSubiendo: number;
}): string {
	if (estado.optimizandoFotos) {
		return 'Espere a que terminen de prepararse las fotos.';
	}

	if (estado.videosSubiendo > 0) {
		return 'Espere unos segundos: todavía se está subiendo un video. Si sale ahora, ese video se perderá.';
	}

	return '';
}
