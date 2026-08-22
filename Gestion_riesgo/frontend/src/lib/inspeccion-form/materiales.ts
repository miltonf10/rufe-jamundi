// La lista de materiales del Anexo 2, armada en el navegador.
//
// Espejo de `BancoMateriales::materiales()` en PHP, que es la que queda
// guardada en el expediente. Esta existe para que el profesional VEA los
// materiales mientras evalúa, sin señal y sin esperar a guardar: ver que un
// combo severo son 2050 ladrillos cambia la conversación que se está teniendo
// en la puerta de la casa.
//
// El anexo entero viaja en los catálogos, así que aquí solo se filtra por
// nivel. Los datos no se duplican; el filtro sí, y son diez líneas.

import type { ListaMateriales } from './detalle';

type ItemAnexo = { descripcion: string; unidad: string; cantidades: Record<string, string> };
type KitAnexo = { kit: string; items: ItemAnexo[] };

export type Anexo2 = Record<string, { combo: KitAnexo[]; cubierta: Record<string, KitAnexo[]> }>;

/**
 * Los materiales del combo, con el kit de cubierta si se eligió.
 *
 * Devuelve `sin_lista` con su nota cuando no hay nada que listar, en vez de una
 * lista vacía: el caso más importante es el colapso total, donde el Anexo 2
 * sencillamente no define materiales y hay que decirlo.
 */
export function materialesDe(
	anexo: Anexo2 | undefined,
	sistema: string,
	nivel: string | null,
	kitCubierta: string | null
): ListaMateriales | null {
	if (!anexo || !sistema || nivel === null) return null;

	const delSistema = anexo[sistema];
	if (!delSistema) return null;

	// El Anexo 2 solo trae columnas para leve, moderado y severo. Para el
	// colapso total el formato nombra un combo pero no lista sus materiales. Se
	// dice, en vez de rellenarlo con las cantidades del severo: son materiales
	// públicos y una cifra inventada no se distingue de una correcta al
	// imprimirla.
	if (nivel === 'COLAPSO_TOTAL') {
		return {
			kits: [],
			sin_lista: true,
			nota: 'El Anexo 2 no define lista de materiales para colapso total; la determina el Consejo Territorial.'
		};
	}

	const kits = filtrar(delSistema.combo, nivel);

	if (kitCubierta && delSistema.cubierta[kitCubierta]) {
		kits.push(...filtrar(delSistema.cubierta[kitCubierta], nivel));
	}

	return { kits, sin_lista: kits.length === 0, nota: '' };
}

/** Deja de cada kit solo los ítems que ese nivel lleva; un kit vacío no se devuelve. */
function filtrar(kits: KitAnexo[], nivel: string) {
	return kits
		.map((kit) => ({
			kit: kit.kit,
			items: kit.items
				.filter((i) => i.cantidades[nivel] !== undefined)
				.map((i) => ({ descripcion: i.descripcion, unidad: i.unidad, cantidad: i.cantidades[nivel] }))
		}))
		.filter((kit) => kit.items.length > 0);
}
