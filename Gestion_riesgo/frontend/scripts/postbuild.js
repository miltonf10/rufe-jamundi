import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * adapter-static genera solo `200.html` cuando no se pre-renderiza ninguna ruta
 * (esta aplicación decide qué mostrar según la sesión, así que no puede
 * pre-renderizarse). Apache, en cambio, sirve `index.html` como índice del
 * directorio: sin él, la raíz del dominio responde 403.
 *
 * Se copia en lugar de enlazar porque el despliegue viaja como ZIP y los
 * enlaces simbólicos no sobreviven a la extracción en el hosting.
 */
const build = resolve(import.meta.dirname, '..', 'build');
const origen = resolve(build, '200.html');
const destino = resolve(build, 'index.html');

if (!existsSync(origen)) {
	console.error('postbuild: no se encontró build/200.html — ¿cambió el adaptador?');
	process.exit(1);
}

copyFileSync(origen, destino);
console.log('postbuild: build/index.html generado desde 200.html');

/**
 * Publica la lista de barrios como dato servido, fuera del paquete de
 * JavaScript.
 *
 * Se copia desde `barrioTabs.json` en vez de mantenerse un segundo archivo a
 * mano: así hay una sola fuente de verdad y es imposible que la lista compilada
 * y la publicada se desincronicen en silencio.
 *
 * Lo que esto habilita es lo importante: agregar un barrio pasa a ser subir un
 * JSON al hosting, en vez de recompilar el sitio entero y volver a publicarlo
 * —que es lo que hasta ahora pisaba el resto del trabajo desplegado.
 */
const listaOrigen = resolve(import.meta.dirname, '..', 'src', 'lib', 'baseDatosRufe', 'barrioTabs.json');
const listaDestino = resolve(build, 'datos', 'barrios-rufe.json');

if (!existsSync(listaOrigen)) {
	console.error('postbuild: no se encontró barrioTabs.json — ¿se movió el archivo?');
	process.exit(1);
}

mkdirSync(resolve(build, 'datos'), { recursive: true });
copyFileSync(listaOrigen, listaDestino);
console.log('postbuild: build/datos/barrios-rufe.json publicado');
