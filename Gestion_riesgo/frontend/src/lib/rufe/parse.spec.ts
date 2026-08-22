import { describe, it, expect } from 'vitest';
import { parseRufeCsv } from './parse';

const HEADER = [
	'x,68',
	',',
	',',
	'DEPARTAMENTO',
	'MUNICPIO',
	'INFORMACION',
	'ITEMS,HOGAR,CORREGIMIENTO,BARRIO,DIRECCION,NOMBRE,APELLIDO,TIPODOC,NUMDOC,PARENTESCO,GENERO,DIA,MES,ANIO,EDAD,ETNIA,TEL,TENENCIA,ESTADO,TIPOBIEN,EVACUADA,VISITA,QUIEN,OBS',
	','
];

function csv(dataRows: string[]): string {
	return [...HEADER, ...dataRows].join('\n');
}

describe('parseRufeCsv', () => {
	it('parses a basic urban household with direct M/F gender', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,,Javier,Aguilar,3,111,1,M,2,1,1957,69,6,,PROPIETARIO,HABITABLE,VIVIENDA,NO,SI,,',
				'1,1,,,,Maria,Aguilar,3,222,2,F,1,1,1960,66,6,,PROPIETARIO,HABITABLE,VIVIENDA,NO,SI,,'
			]),
			'2026-01-01'
		);
		expect(out.total).toBe(2);
		expect(out.barrios).toHaveLength(1);
		expect(out.barrios[0]).toMatchObject({
			name: 'Terranova',
			zona: 'Urbana',
			total: 2,
			M: 1,
			F: 1
		});
	});

	it('forward-fills corregimiento/barrio from the first member of a household', () => {
		const out = parseRufeCsv(
			csv([
				',5,Quinamayo,Via Principal,,Ana,Lopez,3,1,1,F,1,1,1990,36,5,,,,,,,,',
				',5,,,,,Pedro,Lopez,3,2,2,M,1,1,1988,38,5,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.barrios).toHaveLength(1);
		expect(out.barrios[0]).toMatchObject({ name: 'Quinamayo', zona: 'Rural', total: 2 });
	});

	it('classifies a known rural corregimiento as Rural and groups by corregimiento, not sector', () => {
		const out = parseRufeCsv(
			csv([
				',10,Robles,Sector A,,X,Y,3,1,1,M,1,1,1990,36,1,,,,,,,,',
				',11,Robles,Sector B,,X,Y,3,2,1,F,1,1,1990,36,1,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.barrios).toHaveLength(1);
		expect(out.barrios[0].name).toBe('Robles');
		expect(out.barrios[0].total).toBe(2);
	});

	it('reclassifies a blank corregimiento as Rural when the barrio field holds a known rural name (hogar 91/117 regression)', () => {
		const out = parseRufeCsv(
			csv(['(no)hogar91,91,,San Isidro,,Carlos,Lasso,3,1,1,M,1,1,1975,51,6,,,,,,,,']),
			'2026-01-01'
		);
		expect(out.barrios[0]).toMatchObject({ name: 'San Isidro', zona: 'Rural' });
	});

	it('treats a blank/JAMUNDI/TERRANOVA corregimiento as Urbana', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,ElRodeo,,A,B,3,1,1,M,1,1,1990,36,6,,,,,,,,',
				'2,2,JAMUNDI,ElRodeo,,C,D,3,2,1,F,1,1,1990,36,6,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.barrios).toHaveLength(1);
		expect(out.barrios[0]).toMatchObject({ name: 'Elrodeo', zona: 'Urbana', total: 2 });
	});

	it('counts an identity outside M/F (e.g. "T") toward the total but not toward M or F', () => {
		const out = parseRufeCsv(
			csv(['1,1,,Terranova,,A,B,3,1,1,T,1,1,1990,36,6,,,,,,,,']),
			'2026-01-01'
		);
		expect(out.total).toBe(1);
		expect(out.barrios[0].M).toBe(0);
		expect(out.barrios[0].F).toBe(0);
	});

	it('buckets age correctly at the boundaries (11/12, 28/29, 59/60)', () => {
		const row = (edad: number, doc: string) =>
			`1,1,,Terranova,,A,B,3,${doc},1,M,1,1,2000,${edad},6,,,,,,,,`;
		const out = parseRufeCsv(
			csv([row(11, '1'), row(12, '2'), row(28, '3'), row(29, '4'), row(59, '5'), row(60, '6')]),
			'2026-01-01'
		);
		const b = out.barrios[0];
		expect(b.Ninos).toBe(1);
		expect(b.Jovenes).toBe(2);
		expect(b.Adultos).toBe(2);
		expect(b.AdultosMayores).toBe(1);
	});

	it('skips filler rows with no nombre/apellido/documento', () => {
		const out = parseRufeCsv(
			csv(['1,1,,Terranova,,A,B,3,1,1,M,1,1,1990,36,6,,,,,,,,', ',,,,,,,,,,,,,,2026,,,,,,,,,']),
			'2026-01-01'
		);
		expect(out.total).toBe(1);
	});

	it('records a warning instead of throwing when a barrio label ends up with mixed zona', () => {
		// hogar 20's first member implies Rural via barrio="Robles" (blank
		// corregimiento), a later member of the SAME household has an
		// inconsistent non-rural corregimiento of their own.
		const out = parseRufeCsv(
			csv([
				',20,,Robles,,A,B,3,1,1,M,1,1,1990,36,6,,,,,,,,',
				',20,OtroLugar,,,,C,D,3,2,2,F,1,1,1990,36,6,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.warnings).toBeDefined();
		expect(out.warnings!.length).toBeGreaterThan(0);
		expect(out.barrios.find((b) => b.name === 'Robles')?.zona).toBe('Rural');
	});

	it('sorts barrios by total descending', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,A,,x,y,3,1,1,M,1,1,1990,36,6,,,,,,,,',
				'2,2,,B,,x,y,3,2,1,M,1,1,1990,36,6,,,,,,,,',
				'3,2,,B,,x,y,3,3,1,M,1,1,1990,36,6,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.barrios[0].name).toBe('B');
		expect(out.barrios[0].total).toBe(2);
	});

	it('carries the given asOf timestamp through untouched', () => {
		const out = parseRufeCsv(
			csv(['1,1,,A,,x,y,3,1,1,M,1,1,1990,36,6,,,,,,,,']),
			'2026-08-14 10:00'
		);
		expect(out.asOf).toBe('2026-08-14 10:00');
	});

	it('extracts estado/tipo de bien, tenencia, visita, evacuación and observación as one row per hogar', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,,Javier,Aguilar,3,111,1,M,2,1,1957,69,6,,PROPIETARIO,HABITABLE,VIVIENDA,NO,SI,Pilar Patiño,Grietas en la fachada',
				'1,1,,,,Maria,Aguilar,3,222,2,F,1,1,1960,66,6,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.hogares).toHaveLength(1);
		expect(out.hogares[0]).toMatchObject({
			hogar: '1',
			barrio: 'Terranova',
			zona: 'Urbana',
			estadoBien: 'Habitable',
			tipoBien: 'Vivienda',
			tenencia: 'Propietario',
			visita: 'SI',
			evacuada: 'NO',
			quienVisita: 'Pilar Patiño',
			observacion: 'Grietas en la fachada'
		});
	});

	it('extracts "personal evacuado: SI" and canonicalizes forma de tenencia', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,,Ana,Lopez,3,111,1,F,2,1,1990,36,6,,arrendatario,DESTRUIDO,VIVIENDA,SI,SI,,'
			]),
			'2026-01-01'
		);
		expect(out.hogares[0]).toMatchObject({ tenencia: 'Arrendatario', evacuada: 'SI' });
	});

	it('counts how many personas belong to each hogar, for "cuánto personal evacuado" by people', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,,Javier,Aguilar,3,111,1,M,2,1,1957,69,6,,,,,SI,,,',
				'1,1,,,,Maria,Aguilar,3,222,2,F,1,1,1960,66,6,,,,,,,,',
				'1,1,,,,Luis,Aguilar,3,333,3,M,1,1,1990,36,6,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.hogares).toHaveLength(1);
		expect(out.hogares[0].personas).toBe(3);
		expect(out.hogares[0].evacuada).toBe('SI');
	});

	it('takes the first non-empty value seen per hogar when later members repeat it blank', () => {
		// 24 columns, built positionally to avoid off-by-one comma counting:
		// items,hogar,core,barrio,dir,nombre,apellido,tipodoc,numdoc,parentesco,
		// genero,dia,mes,anio,edad,etnia,tel,tenencia,estado,tipobien,evacuada,
		// visita,quien,obs
		const row1 = [
			'',
			'9',
			'',
			'Bonanza',
			'',
			'A',
			'B',
			'3',
			'1',
			'1',
			'M',
			'1',
			'1',
			'1990',
			'36',
			'6',
			'',
			'',
			'',
			'',
			'',
			'NO',
			'',
			''
		].join(',');
		const row2 = [
			'',
			'9',
			'',
			'',
			'',
			'C',
			'D',
			'3',
			'2',
			'2',
			'F',
			'1',
			'1',
			'1990',
			'36',
			'6',
			'',
			'',
			'DESTRUIDO',
			'VIVIENDA',
			'',
			'SI',
			'',
			'Vivienda colapsada'
		].join(',');
		const out = parseRufeCsv(csv([row1, row2]), '2026-01-01');
		expect(out.hogares).toHaveLength(1);
		// El primer valor NO EN BLANCO de "visita" fue NO (de la primera
		// fila); no se sobrescribe con el SI de la segunda.
		expect(out.hogares[0]).toMatchObject({
			estadoBien: 'Destruido',
			tipoBien: 'Vivienda',
			visita: 'NO',
			observacion: 'Vivienda colapsada'
		});
	});

	it('defaults hogares with nothing filled in to "Sin dato" visita and empty estado/tipo', () => {
		const out = parseRufeCsv(csv(['1,1,,A,,x,y,3,1,1,M,1,1,1990,36,6,,,,,,,,']), '2026-01-01');
		expect(out.hogares[0]).toMatchObject({
			estadoBien: '',
			tipoBien: '',
			visita: 'Sin dato',
			observacion: ''
		});
	});
});

describe('dirección del predio', () => {
	// La sección Mapas necesita la dirección: es lo único con lo que se puede
	// ubicar un predio. El tablero la ignoraba porque agrega por barrio.
	it('lee la columna DIRECCION y la deja en el hogar', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,CRA 11 # 8-26,Javier,Aguilar,3,111,1,M,2,1,1957,69,6,,PROPIETARIO,HABITABLE,VIVIENDA,NO,SI,,'
			]),
			'2026-01-01'
		);
		expect(out.hogares[0].direccion).toBe('CRA 11 # 8-26');
	});

	// La dirección es del predio, no de la persona: en la hoja suele venir solo
	// en el primer integrante, igual que corregimiento y barrio.
	it('la hereda el resto del hogar aunque la celda venga vacía', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,CALLE 12 # 3-45,Javier,Aguilar,3,111,1,M,2,1,1957,69,6,,PROPIETARIO,HABITABLE,VIVIENDA,NO,SI,,',
				'1,1,,,,Maria,Aguilar,3,222,2,F,1,1,1960,66,6,,,,,,,,'
			]),
			'2026-01-01'
		);
		expect(out.hogares).toHaveLength(1);
		expect(out.hogares[0].direccion).toBe('CALLE 12 # 3-45');
		// Y lo que ya contaba el tablero no se mueve.
		expect(out.total).toBe(2);
		expect(out.hogares[0].personas).toBe(2);
	});

	it('un hogar sin dirección no rompe nada: queda vacía', () => {
		const out = parseRufeCsv(
			csv([
				'1,1,,Terranova,,Javier,Aguilar,3,111,1,M,2,1,1957,69,6,,PROPIETARIO,HABITABLE,VIVIENDA,NO,SI,,'
			]),
			'2026-01-01'
		);
		expect(out.hogares[0].direccion).toBe('');
		expect(out.total).toBe(1);
	});
});
