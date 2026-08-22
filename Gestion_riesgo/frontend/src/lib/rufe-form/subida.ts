// Subir a una carga las fotos que una ficha lleva guardadas en el dispositivo.
//
// Vive fuera del Service Worker porque hacen falta los dos caminos. Donde hay
// Background Sync envía el Service Worker; donde no lo hay —Firefox, Safari y
// Brave, que lo trae desactivado— envía la propia pestaña. Mientras esta lógica
// existió solo en el Service Worker, una ficha diferida enviada desde la pestaña
// salía con el token de carga que el formulario había abierto horas antes, ya
// caducado, y sin subir ninguna de sus fotos.

import { fotosDe, type FichaEnCola, type FotoEnCola } from './cola';

/**
 * La misma resolución que hace el cliente de la API, pero sin
 * `$app/environment`: un Service Worker no puede importar ese módulo. Se
 * calcula al usarla, no al cargar el archivo, para que valga igual en la
 * pestaña y en el trabajador, y no se evalúe durante la compilación.
 */
export function baseApi(): string {
	const host = location.hostname;

	return host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:8000' : '/api';
}

/** Fallo de red o del servidor: se resuelve esperando y reintentando. */
export class ErrorDeRed extends Error {}

/**
 * Margen de seguridad sobre la vigencia real de una carga en el servidor
 * (`Archivos::HORAS_CARGA`, 2 horas). Se recorta a 100 minutos para no enviar
 * una carga que caduque entre que se decide usarla y que el servidor la adopta.
 */
const VIGENCIA_CARGA_MS = 100 * 60 * 1000;

/**
 * Deja las fotos de la ficha en el servidor y devuelve el token de carga que
 * debe viajar en el cuerpo, o `null` para conservar el que ya trae.
 *
 * Reutiliza la carga que abrió el formulario mientras siga viva: en el envío
 * inmediato las fotos ya están arriba y volver a subirlas gastaría los datos
 * móviles del censador dos veces. Solo cuando la ficha esperó más que la
 * vigencia se abre una carga nueva y se suben todas otra vez — el `subida` de
 * cada foto se refería a una carga que para entonces ya no existe.
 */
export async function subirFotosDe(ficha: FichaEnCola, token: string): Promise<string | null> {
	const fotos = await fotosDe(ficha.envioId);
	if (fotos.length === 0) return null;

	const cargaDelFormulario = ficha.cuerpo.carga;
	const sigueViva = Date.now() - ficha.creadoEn < VIGENCIA_CARGA_MS;

	if (typeof cargaDelFormulario === 'string' && cargaDelFormulario !== '' && sigueViva) {
		const faltantes = fotos.filter((f) => !f.subida);
		if (faltantes.length === 0) return null;

		for (const foto of faltantes) await subirFoto(cargaDelFormulario, foto, token);

		return null;
	}

	const carga = await abrirCarga(token);
	for (const foto of fotos) await subirFoto(carga, foto, token);

	return carga;
}

async function abrirCarga(token: string): Promise<string> {
	const respuesta = await fetch(`${baseApi()}/rufe/cargas`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: '{}'
	}).catch(() => {
		throw new ErrorDeRed();
	});

	if (!respuesta.ok) throw new ErrorDeRed();

	const datos = await respuesta.json().catch(() => {
		throw new ErrorDeRed();
	});

	return datos.data.carga as string;
}

async function subirFoto(carga: string, foto: FotoEnCola, token: string): Promise<void> {
	const cuerpo = new FormData();
	cuerpo.append('tipo', foto.tipo);
	// El «FOTOGRAFIA DE:» del numeral 11 viaja CON la foto por este camino: aquí
	// la subida ocurre al enviar la ficha, cuando el pie ya está escrito. En el
	// formulario es al revés —primero se dispara, luego se describe— y por eso
	// allí se manda aparte.
	if (foto.descripcion) cuerpo.append('descripcion', foto.descripcion);
	cuerpo.append('archivo', foto.blob, foto.nombre);

	const respuesta = await fetch(`${baseApi()}/rufe/cargas/${carga}/archivos`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: cuerpo
	}).catch(() => {
		throw new ErrorDeRed();
	});

	// Una foto rechazada por su formato no debe impedir que la ficha salga: el
	// dato del hogar vale mucho más que una evidencia. Se deja constancia y se
	// sigue.
	if (!respuesta.ok && respuesta.status < 500) return;
	if (!respuesta.ok) throw new ErrorDeRed();
}
