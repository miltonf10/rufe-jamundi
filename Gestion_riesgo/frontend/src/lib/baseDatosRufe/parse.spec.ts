import { describe, it, expect } from 'vitest';
import { parseBarrioTabCsv } from './parse';
import { buildDataset } from '../rufe/parse';

const HEADER =
	'N° Hogar,Departamento,Municipio,Evento,Fecha Evento,Fecha RUFE,Ubicación del Bien,Corregimiento,Vereda/Sector/Barrio,Dirección,Alojamiento Actual,Forma de Tenencia,Estado del Bien,Tipo de Bien,Item,Nombre(s),Apellido(s),Tipo de Documento,Número de Documento,Parentesco,Identidad de Género,Fecha de Nacimiento,Pertenencia Étnica,N° de Teléfono,Tipo de Cultivo,Unidad de Medida,Área (Cantidad),Sector Pecuario (Especie),Cantidad (Unidades),Observaciones';

function csv(rows: string[]): string {
	return [HEADER, ...rows].join('\n');
}

// 30 columnas, por posición — evita contar comas a mano (ver el error que
// corrigió esto: una fila con una coma de menos corrió "Rural" a la columna
// de fecha en vez de la de zona, y las pruebas lo agarraron).
const COLS = [
	'hogar',
	'departamento',
	'municipio',
	'evento',
	'fechaEvento',
	'fechaRufe',
	'ubicacion',
	'corregimiento',
	'barrio',
	'direccion',
	'alojamiento',
	'tenencia',
	'estadoBien',
	'tipoBien',
	'item',
	'nombre',
	'apellido',
	'tipoDoc',
	'documento',
	'parentesco',
	'genero',
	'fechaNacimiento',
	'etnia',
	'telefono',
	'cultivo',
	'unidadMedida',
	'area',
	'sectorPecuario',
	'cantidad',
	'observacion'
] as const;

function row(overrides: Partial<Record<(typeof COLS)[number], string>>): string {
	return COLS.map((c) => overrides[c] ?? '')
		.map((v) => (v.includes(',') ? `"${v}"` : v))
		.join(',');
}

describe('parseBarrioTabCsv', () => {
	it('parses a household with two members, scoping hogar by tab name', () => {
		const out = parseBarrioTabCsv(
			csv([
				row({
					hogar: '1',
					ubicacion: 'Rural',
					corregimiento: 'Puente Vélez',
					tenencia: 'Arrendatario',
					estadoBien: 'Averiado',
					tipoBien: 'Vivienda',
					item: '1',
					nombre: 'Rosalba',
					apellido: 'Lopez Henao',
					documento: '30399508',
					genero: 'Femenino',
					fechaNacimiento: '07/01/1979',
					observacion: 'Afectación agrietamiento columna.'
				}),
				row({
					hogar: '1',
					ubicacion: 'Rural',
					corregimiento: 'Puente Vélez',
					tenencia: 'Arrendatario',
					estadoBien: 'Averiado',
					tipoBien: 'Vivienda',
					item: '2',
					nombre: 'Jerman',
					apellido: 'Londoño',
					documento: '1112478080',
					genero: 'Masculino',
					fechaNacimiento: '15/09/1992'
				})
			]),
			'PUENTE-VELEZ'
		);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({
			hogar: 'PUENTE-VELEZ-1',
			corregimiento: 'Puente Vélez',
			documento: '30399508',
			genero: 'F',
			tenencia: 'Arrendatario',
			estadoBien: 'Averiado',
			tipoBien: 'Vivienda',
			zonaDirecta: 'Rural',
			visita: '',
			evacuada: ''
		});
	});

	it('scopes hogar numbers per tab so the same N° Hogar in two barrios never collides', () => {
		const a = parseBarrioTabCsv(
			csv([row({ hogar: '1', nombre: 'A', apellido: 'B', documento: '111' })]),
			'BONANZA'
		);
		const b = parseBarrioTabCsv(
			csv([row({ hogar: '1', nombre: 'C', apellido: 'D', documento: '222' })]),
			'PANGOLA'
		);
		expect(a[0].hogar).toBe('BONANZA-1');
		expect(b[0].hogar).toBe('PANGOLA-1');
	});

	it('computes edad from Fecha de Nacimiento against the sismo date (2026-08-10), not today', () => {
		const out = parseBarrioTabCsv(
			csv([
				row({
					hogar: '1',
					nombre: 'A',
					apellido: 'B',
					documento: '1',
					fechaNacimiento: '15/09/1992'
				})
			]),
			'X'
		);
		// 1992-09-15 aún no cumplía años el 2026-08-10 → 33, no 34.
		expect(out[0].edad).toBe(33);
	});

	it('tolerates an unparsable Fecha de Nacimiento (annotated by a validator) without throwing', () => {
		const out = parseBarrioTabCsv(
			csv([
				row({
					hogar: '1',
					nombre: 'A',
					apellido: 'B',
					documento: '1',
					fechaNacimiento: '01/03/2026 (año imposible, ver nota)'
				})
			]),
			'X'
		);
		expect(out[0].edad).toBeNull();
	});

	it('maps Identidad de Género Masculino/Femenino to M/F, anything else to null', () => {
		const out = parseBarrioTabCsv(
			csv([
				row({ hogar: '1', nombre: 'A', apellido: 'B', documento: '1', genero: 'Masculino' }),
				row({ hogar: '1', nombre: 'C', apellido: 'D', documento: '2', genero: 'Femenino' }),
				row({ hogar: '1', nombre: 'E', apellido: 'F', documento: '3', genero: '' })
			]),
			'X'
		);
		expect(out.map((r) => r.genero)).toEqual(['M', 'F', null]);
	});

	it('falls back to the tab name as barrio/corregimiento when a row has neither, keeping the row instead of dropping its zona', () => {
		const rural = parseBarrioTabCsv(
			csv([row({ hogar: '1', ubicacion: 'Rural', nombre: 'A', apellido: 'B', documento: '1' })]),
			'LA-VENTURA'
		);
		expect(rural[0].corregimiento).toBe('La Ventura');

		const urbano = parseBarrioTabCsv(
			csv([row({ hogar: '1', ubicacion: 'Urbano', nombre: 'A', apellido: 'B', documento: '1' })]),
			'PANGOLA'
		);
		expect(urbano[0].barrio).toBe('Pangola');
	});

	it('skips filler rows with neither hogar nor documento', () => {
		const out = parseBarrioTabCsv(
			csv([row({ hogar: '1', nombre: 'A', apellido: 'B', documento: '1' }), row({})]),
			'X'
		);
		expect(out).toHaveLength(1);
	});

	it('reads corregimiento/barrio directly per row — this sheet does not need forward-fill, unlike the original RUFE sheet', () => {
		const out = parseBarrioTabCsv(
			csv([
				row({
					hogar: '1',
					ubicacion: 'Rural',
					corregimiento: 'Puente Vélez',
					nombre: 'A',
					apellido: 'B',
					documento: '1'
				}),
				row({
					hogar: '1',
					ubicacion: 'Rural',
					corregimiento: 'Puente Vélez',
					nombre: 'C',
					apellido: 'D',
					documento: '2'
				})
			]),
			'PUENTE-VELEZ'
		);
		expect(out.every((r) => r.corregimiento === 'Puente Vélez')).toBe(true);
	});

	it('finds Observaciones by header name even if the sheet inserts columns before it (regression: el 2026-08-18 la hoja agregó "PERSONAS EVACUADAS"/"REALIZÓ VISITA" antes de Observaciones en las 26 pestañas y un índice fijo leyó la columna equivocada)', () => {
		const headerConColumnasNuevas =
			'N° Hogar,Departamento,Municipio,Evento,Fecha Evento,Fecha RUFE,Ubicación del Bien,Corregimiento,Vereda/Sector/Barrio,Dirección,Alojamiento Actual,Forma de Tenencia,Estado del Bien,Tipo de Bien,Item,Nombre(s),Apellido(s),Tipo de Documento,Número de Documento,Parentesco,Identidad de Género,Fecha de Nacimiento,Pertenencia Étnica,N° de Teléfono,Tipo de Cultivo,Unidad de Medida,Área (Cantidad),Sector Pecuario (Especie),Cantidad (Unidades),PERSONAS EVACUADAS,REALIZÓ VISITA,Observaciones';
		const filaConColumnasNuevas =
			'1,,,,,,Urbano,,Terranova,,,,,,,A,B,,1,,,,,,,,,,,,,Vivienda colapsada';
		const out = parseBarrioTabCsv(
			[headerConColumnasNuevas, filaConColumnasNuevas].join('\n'),
			'TERRANOVA'
		);
		expect(out[0].observacion).toBe('Vivienda colapsada');
	});

	it('throws a clear per-tab error when an expected column is missing, instead of silently misreading another one', () => {
		const headerSinObservaciones =
			'N° Hogar,Departamento,Municipio,Evento,Fecha Evento,Fecha RUFE,Ubicación del Bien,Corregimiento,Vereda/Sector/Barrio,Dirección,Alojamiento Actual,Forma de Tenencia,Estado del Bien,Tipo de Bien,Item,Nombre(s),Apellido(s),Tipo de Documento,Número de Documento,Parentesco,Identidad de Género,Fecha de Nacimiento';
		expect(() => parseBarrioTabCsv(headerSinObservaciones, 'X')).toThrow(/Observaciones/);
	});
});

describe('parseBarrioTabCsv + buildDataset integration', () => {
	it('lets the SAME barrio name split into two zona groups when the property-level zona genuinely differs (Puente Vélez case)', () => {
		const records = parseBarrioTabCsv(
			csv([
				// Corregimiento Puente Vélez, pero el predio puntual es Urbano.
				row({
					hogar: '1',
					ubicacion: 'Urbano',
					corregimiento: 'Puente Vélez',
					nombre: 'A',
					apellido: 'B',
					documento: '1'
				}),
				// Otro predio del mismo corregimiento, éste sí Rural.
				row({
					hogar: '2',
					ubicacion: 'Rural',
					corregimiento: 'Puente Vélez',
					nombre: 'C',
					apellido: 'D',
					documento: '2'
				})
			]),
			'PUENTE-VELEZ'
		);
		const ds = buildDataset(records, 't');
		const entradas = ds.barrios.filter((b) => b.name === 'Puente Vélez');
		expect(entradas).toHaveLength(2);
		expect(entradas.map((b) => b.zona).sort()).toEqual(['Rural', 'Urbana']);
		expect(ds.warnings).toBeUndefined();
	});

	it('classifies corregimientos with accents (Vélez, Jordán) as rural, matching the unaccented RURAL set', () => {
		const records = parseBarrioTabCsv(
			csv([
				row({ hogar: '1', corregimiento: 'Jordán', nombre: 'A', apellido: 'B', documento: '1' })
			]),
			'PORTAL-JORDAN'
		);
		const ds = buildDataset(records, 't');
		expect(ds.barrios[0]).toMatchObject({ name: 'Jordán', zona: 'Rural' });
	});
});

describe('dirección del predio', () => {
	it('la lee para poder ubicar el predio en el mapa', () => {
		const out = parseBarrioTabCsv(
			csv([row({ hogar: '1', direccion: 'Carrera 11 # 8-26', item: '1', nombre: 'Ana', documento: '1' })]),
			'Terranova'
		);

		expect(out[0].direccion).toBe('Carrera 11 # 8-26');
	});

	// La dirección solo la necesita la sección Mapas, así que su encabezado es
	// opcional. Tratarlo como obligatorio haría que una pestaña sin esa columna
	// tumbara la lectura entera de BASE-DATOS RUFE y, con ella, las cifras del
	// tablero: dejar al municipio sin datos porque falta un dato de un mapa sería
	// una respuesta desproporcionada.
	it('si la pestaña no trae esa columna, no se cae: solo queda sin ubicar', () => {
		const encabezadoSinDireccion = HEADER.replace(',Dirección,', ',Otra Cosa,');
		const fila = row({ hogar: '1', item: '1', nombre: 'Ana', documento: '1' });

		const out = parseBarrioTabCsv([encabezadoSinDireccion, fila].join('\n'), 'Terranova');

		expect(out).toHaveLength(1);
		expect(out[0].direccion).toBe('');
	});
});
