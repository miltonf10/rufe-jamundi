import { parseBarrioTabCsv } from './parse';
import { csvUrlFor, pestanasVigentes } from './source';
import type { PersonRecord } from '../rufe/parse';

/**
 * Trae y parsea TODAS las pestañas conocidas de BASE-DATOS RUFE. A
 * diferencia de `rufe/live.ts#fetchLiveDataset`, una pestaña que falla NO
 * tumba a las demás — se seguirán agregando pestañas nuevas a esta hoja
 * (`BARRIO_TABS`), así que un problema puntual en una no debe dejar sin
 * datos a las otras 12.
 */
export async function fetchLiveBaseDatosRufe(
	signal?: AbortSignal
): Promise<{ records: PersonRecord[]; warnings?: string[] }> {
	// La lista se pide en cada carga: así un barrio nuevo aparece sin necesidad
	// de recompilar ni redesplegar el sitio.
	const pestanas = await pestanasVigentes(signal);

	const resultados = await Promise.allSettled(
		pestanas.map(async (tab) => {
			const res = await fetch(csvUrlFor(tab.gid), { signal, cache: 'no-store' });
			if (!res.ok) {
				throw new Error(`"${tab.nombre}" respondió ${res.status}.`);
			}
			return parseBarrioTabCsv(await res.text(), tab.nombre);
		})
	);

	const records: PersonRecord[] = [];
	const warnings: string[] = [];
	for (const r of resultados) {
		if (r.status === 'fulfilled') records.push(...r.value);
		else
			warnings.push(`BASE-DATOS RUFE: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
	}

	return { records, ...(warnings.length ? { warnings } : {}) };
}
