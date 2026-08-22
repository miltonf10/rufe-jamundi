// Qué fotos se llevan a la cola de envío, y cuáles ya no.
//
// Este archivo se subió VACÍO en el commit e9fdea6 y desde entonces la suite
// venía fallando por él. Se rehace con lo que debía fijar: el fallo de la ficha
// 9, donde cada foto ya subida volvía a mandarse y la ficha acababa con la misma
// evidencia repetida.

import { describe, expect, it, vi } from 'vitest';
import type { Catalogos, EvidenciaLocal } from './tipos';

vi.mock('$app/environment', () => ({ browser: false }));

vi.stubGlobal('window', { location: { hostname: 'grj.oticjamundi.com' }, localStorage: {
	getItem: () => null, setItem() {}, removeItem() {}
} });

const { GestorEvidencias } = await import('./evidencias.svelte');

const CATALOGOS = {
	limites: { evidencias_documento: 1, evidencias_dano: 4 }
} as unknown as Catalogos;

function foto(uid: string, cambios: Partial<EvidenciaLocal> = {}): EvidenciaLocal {
	return {
		uid,
		tipo: 'DANO',
		archivo: new File([new Uint8Array([1, 2, 3])], `${uid}.webp`, { type: 'image/webp' }),
		nombre: `${uid}.webp`,
		tamano: 3,
		estado: 'listo',
		progreso: 100,
		...cambios
	};
}

function gestor(archivos: EvidenciaLocal[]) {
	const g = GestorEvidencias.paraRufe(CATALOGOS, 'borrador-de-prueba');
	g.archivos = archivos;

	return g;
}

describe('paraLaCola', () => {
	it('marca como subida la foto que ya tiene identificador del servidor', () => {
		// El fallo de la ficha 9: se marcaban TODAS como pendientes, así que la
		// cola las volvía a subir y la ficha terminaba con la evidencia duplicada.
		const cola = gestor([
			foto('ya-esta', { idServidor: 41 }),
			foto('falta', { estado: 'pendiente' })
		]).paraLaCola();

		expect(cola.find((a) => a.uid === 'ya-esta')?.subida).toBe(true);
		expect(cola.find((a) => a.uid === 'falta')?.subida).toBe(false);
	});

	it('no se lleva las que fallaron ni las que aún se están optimizando', () => {
		// Una foto a medio optimizar todavía es la original, que NUNCA debe salir
		// del teléfono; y una fallida no tiene archivo utilizable que mandar.
		const cola = gestor([
			foto('rota', { estado: 'error' }),
			foto('procesando', { estado: 'optimizando' }),
			foto('buena', { estado: 'pendiente' })
		]).paraLaCola();

		expect(cola.map((a) => a.uid)).toEqual(['buena']);
	});

	it('conserva el tipo de cada foto, que decide dónde va en la ficha', () => {
		const cola = gestor([
			foto('cedula', { tipo: 'DOCUMENTO' }),
			foto('grieta', { tipo: 'DANO' })
		]).paraLaCola();

		expect(cola.map((a) => a.tipo)).toEqual(['DOCUMENTO', 'DANO']);
	});
});

describe('cupos y estado', () => {
	it('cada tipo tiene su propio límite y no compiten por el mismo hueco', () => {
		const g = gestor([]);

		expect(g.limiteDe('DOCUMENTO')).toBe(1);
		expect(g.limiteDe('DANO')).toBe(4);
	});

	it('un fallo de red no cuenta como fallo: se reintenta solo', () => {
		// Si contara, la pantalla pediría intervención del ciudadano por algo que
		// se resuelve solo en cuanto vuelva la señal.
		const g = gestor([foto('sin-senal', { estado: 'error', reintentable: true })]);

		expect(g.hayFallos).toBe(false);
		expect(g.pendientes).toBe(1);
	});

	it('un rechazo del servidor sí cuenta como fallo', () => {
		const g = gestor([foto('rechazada', { estado: 'error', reintentable: false })]);

		expect(g.hayFallos).toBe(true);
	});
});

describe('el registro fotográfico de la inspección', () => {
	// El numeral 11 imprime diez recuadros, cada uno con su «FOTOGRAFIA DE:». El
	// mismo gestor sirve a los dos formatos; lo único distinto es el cupo y el
	// pie de foto.
	function gestorInspeccion(archivos: EvidenciaLocal[] = []) {
		const g = new GestorEvidencias({ INSPECCION: 10 }, 'inspeccion-de-prueba');
		g.archivos = archivos;

		return g;
	}

	it('tiene las diez casillas del formato, no las cuatro del censo', () => {
		expect(gestorInspeccion().limiteDe('INSPECCION')).toBe(10);
	});

	it('un tipo que este formato no usa no deja hueco libre', () => {
		// `limiteDe` devolvía el cupo de las fotos del daño para cualquier tipo que
		// no fuera DOCUMENTO. Con tres tipos eso ya no vale: un cupo inventado
		// dejaría adjuntar cédulas a una inspección.
		expect(gestorInspeccion().limiteDe('DOCUMENTO')).toBe(0);
	});

	it('el pie de foto viaja con la foto a la cola', () => {
		// Si no viajara, la hoja 3 del PDF saldría con los diez pies en blanco y
		// nadie sabría qué muestra cada imagen.
		const g = gestorInspeccion([
			foto('f1', { tipo: 'INSPECCION', descripcion: 'Fisura en muro de carga' })
		]);

		expect(g.paraLaCola()[0].descripcion).toBe('Fisura en muro de carga');
	});

	it('una foto sin pie no inventa uno', () => {
		const g = gestorInspeccion([foto('f2', { tipo: 'INSPECCION' })]);

		expect(g.paraLaCola()[0].descripcion).toBeUndefined();
	});
});
