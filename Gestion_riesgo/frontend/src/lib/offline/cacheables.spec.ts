// La regla que separa lo que el teléfono puede guardar de lo que no.
//
// Se prueba porque un descuido aquí no se ve: la aplicación seguiría
// funcionando igual, solo que con fichas de hogares damnificados guardadas en un
// teléfono que puede perderse o prestarse.

import { describe, expect, it } from 'vitest';
import { API_CACHEABLE, seGuardaDeLaApi } from './cacheables';

describe('seGuardaDeLaApi', () => {
	it('guarda los catálogos, sin los cuales no hay formulario sin señal', () => {
		expect(seGuardaDeLaApi('/api/rufe/catalogos')).toBe(true);
		expect(seGuardaDeLaApi('/api/inspeccion/catalogos')).toBe(true);
	});

	it('NO guarda nada que lleve datos de personas', () => {
		for (const ruta of [
			'/api/rufe/reportes',
			'/api/rufe/reportes/9',
			'/api/usuarios',
			'/api/mapa/fichas',
			'/api/inspeccion/fichas',
			'/api/inspeccion/fichas/3',
			'/api/inspeccion/duplicados',
			'/api/auth/me',
			'/api/rufe/reportes?buscar=cedula'
		]) {
			expect(seGuardaDeLaApi(ruta)).toBe(false);
		}
	});

	it('no cae en la trampa del prefijo', () => {
		// Si mañana existe una ruta que cuelgue de los catálogos y sí lleve datos,
		// no debe entrar en la caché por parecerse en el nombre.
		expect(seGuardaDeLaApi('/api/rufe/catalogos/personas')).toBe(false);
		expect(seGuardaDeLaApi('/api/rufe/catalogos-privados')).toBe(false);
	});

	it('la lista se mantiene mínima a propósito', () => {
		// Que crecer la lista obligue a tocar esta prueba es el punto: cada entrada
		// nueva es una decisión sobre datos personales, no un detalle técnico.
		// Las dos que hay son catálogos de formato: opciones, límites y los anexos
		// de la norma. Ninguna trae el nombre de nadie.
		expect(API_CACHEABLE).toEqual(['/api/rufe/catalogos', '/api/inspeccion/catalogos']);
	});
});
