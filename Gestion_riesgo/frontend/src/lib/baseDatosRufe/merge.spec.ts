import { describe, it, expect } from 'vitest';
import { mergeConBaseDatosRufe } from './merge';
import type { PersonRecord } from '../rufe/parse';

function persona(overrides: Partial<PersonRecord>): PersonRecord {
	return {
		hogar: '1',
		corregimiento: '',
		barrio: 'Terranova',
		direccion: '',
		documento: '',
		genero: 'M',
		edad: 30,
		tenencia: '',
		estadoBien: '',
		tipoBien: '',
		visita: '',
		quienVisita: '',
		observacion: '',
		evacuada: '',
		...overrides
	};
}

describe('mergeConBaseDatosRufe', () => {
	it('adds people who only exist in BASE-DATOS RUFE, unchanged', () => {
		const original: PersonRecord[] = [persona({ documento: '1', hogar: '471' })];
		const nuevos: PersonRecord[] = [
			persona({ documento: '999', hogar: 'PUENTE-VELEZ-1', barrio: 'Puente Vélez' })
		];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records.map((r) => r.documento).sort()).toEqual(['1', '999']);
		expect(out.reDigitalizadas).toBe(0);
	});

	it('keeps people who only exist in the original sheet, unchanged', () => {
		const original: PersonRecord[] = [
			persona({ documento: '1', hogar: '471', tenencia: 'Propietario' })
		];
		const out = mergeConBaseDatosRufe(original, []);
		expect(out.records).toEqual(original);
	});

	it('for a shared documento, replaces hogar/corregimiento/tenencia/estado with BASE-DATOS RUFE (caso real: doc 6081867)', () => {
		const original: PersonRecord[] = [
			persona({
				documento: '6081867',
				hogar: '471',
				corregimiento: 'PUENTE VELEZ',
				tenencia: 'Propietario',
				estadoBien: 'Averiado',
				observacion: 'AFECTACIONES EN GRIETAS DE TECHO Y PARED'
			})
		];
		const nuevos: PersonRecord[] = [
			persona({
				documento: '6081867',
				hogar: 'PUENTE-VELEZ-24',
				corregimiento: 'Puente Vélez',
				tenencia: 'Poseedor',
				estadoBien: 'Habitable',
				observacion: 'Afectación en grietas de techo y pared.'
			})
		];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records).toHaveLength(1);
		expect(out.records[0]).toMatchObject({
			hogar: 'PUENTE-VELEZ-24',
			corregimiento: 'Puente Vélez',
			tenencia: 'Poseedor',
			estadoBien: 'Habitable',
			observacion: 'Afectación en grietas de techo y pared.'
		});
		expect(out.reDigitalizadas).toBe(1);
	});

	it('keeps Evacuada/Visita técnica/Quién visita from the ORIGINAL for a re-digitalized person, since BASE-DATOS RUFE never captures them', () => {
		const original: PersonRecord[] = [
			persona({
				documento: '1',
				evacuada: 'SI',
				visita: 'SI',
				quienVisita: 'Cruz Roja'
			})
		];
		const nuevos: PersonRecord[] = [
			persona({ documento: '1', hogar: 'BONANZA-2', estadoBien: 'Destruido' })
		];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records[0]).toMatchObject({
			evacuada: 'SI',
			visita: 'SI',
			quienVisita: 'Cruz Roja',
			estadoBien: 'Destruido',
			hogar: 'BONANZA-2'
		});
	});

	it('falls back to the original género/edad when BASE-DATOS RUFE left that row blank for a re-digitalized person', () => {
		const original: PersonRecord[] = [persona({ documento: '1', genero: 'F', edad: 45 })];
		const nuevos: PersonRecord[] = [
			persona({ documento: '1', genero: null, edad: null, hogar: 'X-1' })
		];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records[0]).toMatchObject({ genero: 'F', edad: 45 });
	});

	it('prefers BASE-DATOS RUFE género/edad over the original when both are present', () => {
		const original: PersonRecord[] = [persona({ documento: '1', genero: 'F', edad: 45 })];
		const nuevos: PersonRecord[] = [
			persona({ documento: '1', genero: 'M', edad: 46, hogar: 'X-1' })
		];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records[0]).toMatchObject({ genero: 'M', edad: 46 });
	});

	it('does not drop or duplicate the co-members of a partially re-digitalized household', () => {
		// Hogar 471 original: 2 personas. Solo una fue re-digitalizada.
		const original: PersonRecord[] = [
			persona({ documento: '1', hogar: '471' }),
			persona({ documento: '2', hogar: '471' })
		];
		const nuevos: PersonRecord[] = [persona({ documento: '1', hogar: 'PUENTE-VELEZ-24' })];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records).toHaveLength(2);
		expect(out.records.find((r) => r.documento === '1')?.hogar).toBe('PUENTE-VELEZ-24');
		// El compañero de hogar no re-digitalizado se queda en el hogar original.
		expect(out.records.find((r) => r.documento === '2')?.hogar).toBe('471');
	});

	it('warns with the count of re-digitalized people when there is at least one overlap, and stays silent otherwise', () => {
		const original: PersonRecord[] = [persona({ documento: '1' }), persona({ documento: '2' })];
		const nuevos: PersonRecord[] = [persona({ documento: '1', hogar: 'X-1' })];
		const conSolapamiento = mergeConBaseDatosRufe(original, nuevos);
		expect(conSolapamiento.warnings).toBeDefined();
		expect(conSolapamiento.warnings![0]).toContain('1 persona(s) re-digitalizada(s)');

		const sinSolapamiento = mergeConBaseDatosRufe(original, [
			persona({ documento: '999', hogar: 'X-1' })
		]);
		expect(sinSolapamiento.warnings).toBeUndefined();
	});

	it('ignores records without documento for matching purposes (never merges blanks together)', () => {
		const original: PersonRecord[] = [persona({ documento: '' })];
		const nuevos: PersonRecord[] = [persona({ documento: '', hogar: 'X-1' })];
		const out = mergeConBaseDatosRufe(original, nuevos);
		expect(out.records).toHaveLength(2);
		expect(out.reDigitalizadas).toBe(0);
	});
});
