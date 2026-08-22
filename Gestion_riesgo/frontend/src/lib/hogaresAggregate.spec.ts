import { describe, it, expect } from 'vitest';
import {
	aggregateHogares,
	filterHogares,
	tagObservaciones,
	listObservaciones,
	criticalSeverity
} from './hogaresAggregate';
import type { Hogar } from './data';

function hogar(overrides: Partial<Hogar>): Hogar {
	return {
		hogar: '1',
		barrio: 'Terranova',
		zona: 'Urbana',
		direccion: '',
		personas: 1,
		estadoBien: '',
		tipoBien: '',
		tenencia: '',
		visita: 'Sin dato',
		quienVisita: '',
		observacion: '',
		evacuada: 'Sin dato',
		...overrides
	};
}

describe('aggregateHogares()', () => {
	it('counts hogares and tallies estado/tipo de bien, defaulting blanks to "Sin dato"', () => {
		const agg = aggregateHogares([
			hogar({ estadoBien: 'Averiado', tipoBien: 'Vivienda' }),
			hogar({ estadoBien: 'Averiado', tipoBien: 'Vivienda' }),
			hogar({ estadoBien: '', tipoBien: '' })
		]);
		expect(agg.count).toBe(3);
		expect(agg.estadoBien).toEqual({ Averiado: 2, 'Sin dato': 1 });
		expect(agg.tipoBien).toEqual({ Vivienda: 2, 'Sin dato': 1 });
	});

	it('tallies forma de tenencia, defaulting blanks to "Sin dato"', () => {
		const agg = aggregateHogares([
			hogar({ tenencia: 'Propietario' }),
			hogar({ tenencia: 'Propietario' }),
			hogar({ tenencia: 'Arrendatario' }),
			hogar({ tenencia: '' })
		]);
		expect(agg.tenencia).toEqual({ Propietario: 2, Arrendatario: 1, 'Sin dato': 1 });
	});

	it('tallies personal evacuado SI/NO/Sin dato, counting both hogares and personas', () => {
		// Un hogar de 4 integrantes evacuado no debe contar igual que uno de 1
		// — "cuánto personal ha sido evacuado" es una pregunta sobre personas.
		const agg = aggregateHogares([
			hogar({ evacuada: 'SI', personas: 4 }),
			hogar({ evacuada: 'SI', personas: 1 }),
			hogar({ evacuada: 'NO', personas: 3 }),
			hogar({ evacuada: 'Sin dato', personas: 2 })
		]);
		expect(agg.evacuadaSi).toBe(2);
		expect(agg.evacuadaNo).toBe(1);
		expect(agg.evacuadaSinDato).toBe(1);
		expect(agg.personasEvacuadas).toBe(5);
		expect(agg.personasNoEvacuadas).toBe(3);
		expect(agg.personasSinDatoEvacuacion).toBe(2);
	});

	it('tallies hogares by zona (grouped by hogar, not by persona)', () => {
		const agg = aggregateHogares([
			hogar({ hogar: '1', zona: 'Urbana' }),
			hogar({ hogar: '2', zona: 'Urbana' }),
			hogar({ hogar: '3', zona: 'Rural' })
		]);
		expect(agg.count).toBe(3);
		expect(agg.urbana).toBe(2);
		expect(agg.rural).toBe(1);
	});

	it('tallies visita SI/NO/Sin dato', () => {
		const agg = aggregateHogares([
			hogar({ visita: 'SI' }),
			hogar({ visita: 'SI' }),
			hogar({ visita: 'NO' }),
			hogar({ visita: 'Sin dato' })
		]);
		expect(agg.visitaSi).toBe(2);
		expect(agg.visitaNo).toBe(1);
		expect(agg.visitaSinDato).toBe(1);
	});

	it('counts hogares with a non-empty observación', () => {
		const agg = aggregateHogares([
			hogar({ observacion: 'Grietas en la pared' }),
			hogar({ observacion: '' })
		]);
		expect(agg.conObservacion).toBe(1);
	});

	it('ranks visitantes by how many hogares each one visited, dropping blanks', () => {
		const agg = aggregateHogares([
			hogar({ quienVisita: 'Cruz Roja' }),
			hogar({ quienVisita: 'Cruz Roja' }),
			hogar({ quienVisita: 'Defensa Civil' }),
			hogar({ quienVisita: '' })
		]);
		expect(agg.visitantes).toEqual([
			{ nombre: 'Cruz Roja', count: 2 },
			{ nombre: 'Defensa Civil', count: 1 }
		]);
	});

	it('drops "quién realizó la visita" values that are really a mistyped observación, not a name', () => {
		// Regression: algunos registros del RUFE traen una frase larga (la
		// observación, pegada en la columna equivocada) en vez de un nombre
		// de persona o entidad como "Cruz Roja" o "Pilar Patiño".
		const agg = aggregateHogares([
			hogar({ quienVisita: 'Cruz Roja' }),
			hogar({
				quienVisita: 'Grietas en las paredes edificacion en malas condiciones que requiere revision'
			})
		]);
		expect(agg.visitantes).toEqual([{ nombre: 'Cruz Roja', count: 1 }]);
	});
});

describe('filterHogares()', () => {
	const sample: Hogar[] = [
		hogar({ hogar: '1', barrio: 'Terranova', zona: 'Urbana' }),
		hogar({ hogar: '2', barrio: 'Quinamayo', zona: 'Rural' })
	];

	it('filters by zona and by barrio name (case-insensitive)', () => {
		expect(filterHogares(sample, 'Urbana', '')).toHaveLength(1);
		expect(filterHogares(sample, 'todas', 'quina')).toEqual([sample[1]]);
		expect(filterHogares(sample, 'Rural', 'terra')).toHaveLength(0);
	});
});

describe('tagObservaciones()', () => {
	it('tags known damage keywords and skips tags with zero matches', () => {
		const tags = tagObservaciones([
			hogar({ observacion: 'SE EVIDENCIAN GRIETAS EN LA PARED' }),
			hogar({ observacion: 'VIVIENDA COLAPSADA, REQUIERE EVACUACION' }),
			hogar({ observacion: '' })
		]);
		const byLabel = Object.fromEntries(tags.map((t) => [t.label, t.count]));
		expect(byLabel['Grietas']).toBe(1);
		expect(byLabel['Colapso']).toBe(1);
		expect(byLabel['Evacuación']).toBe(1);
		expect(byLabel['Fuga agua/gas']).toBeUndefined();
	});

	it('returns an empty list when no observación matches any keyword', () => {
		expect(tagObservaciones([hogar({ observacion: 'sin novedad' })])).toEqual([]);
	});

	it('flags danger-related tags as critical and cosmetic ones as not', () => {
		const tags = tagObservaciones([
			hogar({ observacion: 'GRIETAS EN LA PARED' }),
			hogar({ observacion: 'VIVIENDA COLAPSADA' }),
			hogar({ observacion: 'REQUIERE ALOJAMIENTO' })
		]);
		const criticalByLabel = Object.fromEntries(tags.map((t) => [t.label, t.critical]));
		expect(criticalByLabel['Grietas']).toBe(false);
		expect(criticalByLabel['Alojamiento']).toBe(false);
		expect(criticalByLabel['Colapso']).toBe(true);
	});
});

describe('listObservaciones()', () => {
	it('lists only hogares with a non-empty observación and carries the código de hogar', () => {
		const list = listObservaciones([
			hogar({ hogar: '2', barrio: 'Quinamayo', observacion: 'B' }),
			hogar({ hogar: '1', barrio: 'Bonanza', observacion: 'A' }),
			hogar({ hogar: '3', barrio: 'Robles', observacion: '' })
		]);
		expect(list.map((o) => o.hogar)).toEqual(['1', '2']);
		expect(list.map((o) => o.barrio)).toEqual(['Bonanza', 'Quinamayo']);
	});

	it('marks observaciones that mention imminent danger as critical', () => {
		const list = listObservaciones([
			hogar({ hogar: '1', observacion: 'Grietas leves en la fachada' }),
			hogar({ hogar: '2', observacion: 'Riesgo de colapso, requiere evacuación urgente' })
		]);
		const byHogar = Object.fromEntries(list.map((o) => [o.hogar, o.critical]));
		expect(byHogar['1']).toBe(false);
		expect(byHogar['2']).toBe(true);
	});

	it('sorts alphabetically by barrio regardless of critical, so the "solo críticas" toggle visibly changes what is shown', () => {
		// Si las críticas siempre aparecieran primero, activar/desactivar el
		// filtro no cambiaría lo que ya se ve en pantalla (mismo top de la
		// lista en ambos casos) y parecería que el botón no hace nada.
		const list = listObservaciones([
			hogar({ hogar: '1', barrio: 'Zeta', observacion: 'Grietas leves' }),
			hogar({ hogar: '2', barrio: 'Alfa', observacion: 'Colapso total, evacuación urgente' }),
			hogar({ hogar: '3', barrio: 'Beta', observacion: 'Fisuras menores' })
		]);
		expect(list.map((o) => o.hogar)).toEqual(['2', '3', '1']);
		expect(list.map((o) => o.critical)).toEqual([true, false, false]);
	});

	it('carries evacuada y personas para poder filtrar/ordenar por urgencia sin recruzar contra Hogar', () => {
		const list = listObservaciones([
			hogar({ hogar: '1', observacion: 'Grietas leves', evacuada: 'SI', personas: 3 }),
			hogar({ hogar: '2', observacion: 'Colapso total', evacuada: 'NO', personas: 5 })
		]);
		const byHogar = Object.fromEntries(list.map((o) => [o.hogar, o]));
		expect(byHogar['1'].evacuada).toBe('SI');
		expect(byHogar['1'].personas).toBe(3);
		expect(byHogar['2'].evacuada).toBe('NO');
		expect(byHogar['2'].personas).toBe(5);
	});
});

describe('criticalSeverity()', () => {
	it('counts zero for a non-critical observación', () => {
		expect(criticalSeverity('Grietas leves en la fachada')).toBe(0);
	});

	it('counts one keyword match', () => {
		expect(criticalSeverity('Riesgo de caída de muro')).toBe(1);
	});

	it('counts several distinct keyword matches, not occurrences of the same one', () => {
		// "colapso" + "urgente" + "evacuación" = 3 señales distintas, aunque
		// "colapso" podría aparecer más de una vez en el texto real.
		expect(criticalSeverity('Colapso total, requiere evacuación urgente')).toBe(3);
	});
});
