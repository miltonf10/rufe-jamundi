// El estado de la preparación para trabajar sin internet, compartido.
//
// La precarga la disparan tres sitios —al instalar la aplicación, al iniciar
// sesión y el botón de «Pendientes»— pero el resultado lo muestra uno solo. Sin
// un estado común, cada sitio tendría su propia copia y el censador podría ver
// «listo» en una pantalla y «falta» en otra.

import { prepararParaCampo, type Parte } from './preparar';

class Preparacion {
	parte = $state<Parte | null>(null);
	trabajando = $state(false);

	/** Cuándo se preparó por última vez, para poder decir «hace un rato». */
	momento = $state<number | null>(null);

	/**
	 * Deja el teléfono listo.
	 *
	 * Si ya hay una en marcha no se lanza otra: al iniciar sesión desde una
	 * aplicación recién instalada los dos disparos llegan casi a la vez, y
	 * duplicar las descargas solo gastaría los datos del censador.
	 */
	async ejecutar(): Promise<Parte | null> {
		if (this.trabajando) return this.parte;

		// Sin señal no hay nada que descargar, y un parte hecho a oscuras diría que
		// falta todo cuando en realidad puede estar completo desde antes.
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.parte;

		this.trabajando = true;

		try {
			this.parte = await prepararParaCampo();
			this.momento = Date.now();

			return this.parte;
		} finally {
			this.trabajando = false;
		}
	}
}

export const preparacion = new Preparacion();
