import barrioTabsData from './barrioTabs.json';

/**
 * "BASE-DATOS RUFE — Sismo Jamundí": una hoja de cálculo DISTINTA a la del
 * RUFE original (`$lib/rufe/source.ts`), donde cada pestaña es un barrio o
 * vereda con el mismo encabezado. Es la continuación de la digitalización
 * del RUFE, ahora con apoyo de IA — se van agregando pestañas nuevas a
 * medida que se digitaliza cada barrio.
 *
 * Igual que con Instituciones Educativas/Equipamientos, el export CSV con
 * `gid` es CORS-permisivo (confirmado con curl), pero la lista de pestañas
 * en sí NO se puede leer desde el navegador (la página /edit de Google
 * Sheets no tiene CORS abierto), así que esta lista vive en
 * `barrioTabs.json` en vez de acá directamente — así puede reescribirla sola
 * `scripts/check-nuevas-pestanas.ts`, que corre por hora vía
 * `.github/workflows/check-nuevas-pestanas.yml` y comitea + dispara el
 * despliegue cuando aparece una pestaña nueva. No hace falta tocar nada a
 * mano al agregar un barrio — ver ese workflow para el detalle.
 */
export const BASE_DATOS_SHEET_ID = '1kXXZqZow7UgbqW44UMz76FjELBZz1TRpT4hbtFHoby4';

export interface BarrioTab {
	/** Nombre del barrio/vereda tal como aparece en la pestaña de Google Sheets. */
	nombre: string;
	gid: string;
}

/**
 * La lista que venía compilada dentro del paquete. Sirve de respaldo.
 */
export const BARRIO_TABS: BarrioTab[] = barrioTabsData;

/** Dónde se publica la lista viva, fuera del paquete de JavaScript. */
export const RUTA_PESTANAS = '/datos/barrios-rufe.json';

/**
 * La lista de barrios vigente, leída en el momento de usarla.
 *
 * Antes esta lista viajaba dentro del paquete compilado, y eso convertía un
 * cambio de DATOS en un cambio de CÓDIGO: para que apareciera un barrio nuevo
 * había que recompilar el sitio entero y volver a subirlo. El proceso
 * automático que vigila la hoja hacía justamente eso cada hora, y al publicar
 * el sitio completo pisaba cualquier otro trabajo que hubiera en producción.
 *
 * Publicada como archivo aparte, agregar un barrio es subir un JSON de dos
 * kilobytes. No hay compilación, no hay despliegue y no hay nada más que se
 * pueda romper de paso.
 *
 * Si el archivo no está o no se puede leer, se usa la lista compilada: quedará
 * desactualizada, pero el tablero sigue mostrando datos, que es lo que importa.
 */
export async function pestanasVigentes(signal?: AbortSignal): Promise<BarrioTab[]> {
	try {
		const res = await fetch(RUTA_PESTANAS, { signal, cache: 'no-store' });
		if (!res.ok) return BARRIO_TABS;

		const datos: unknown = await res.json();
		if (!Array.isArray(datos) || datos.length === 0) return BARRIO_TABS;

		const validas = datos.filter(
			(t): t is BarrioTab =>
				typeof t === 'object' &&
				t !== null &&
				typeof (t as BarrioTab).nombre === 'string' &&
				typeof (t as BarrioTab).gid === 'string'
		);

		// Una lista más corta que la compilada casi siempre significa un archivo a
		// medio escribir, no que se hayan borrado barrios de la hoja. Ante la duda
		// se prefiere la compilada: perder un barrio del tablero es peor que
		// tardar en ver uno nuevo.
		return validas.length >= BARRIO_TABS.length ? validas : BARRIO_TABS;
	} catch {
		return BARRIO_TABS;
	}
}

export function csvUrlFor(gid: string): string {
	return `https://docs.google.com/spreadsheets/d/${BASE_DATOS_SHEET_ID}/export?format=csv&gid=${gid}`;
}
