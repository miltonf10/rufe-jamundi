// Genera los iconos de la aplicación instalable a partir del escudo oficial.
//
//   node scripts/generar-iconos.mjs
//
// Los iconos anteriores eran un cuadrado azul con las letras «SGR» dibujadas a
// mano. Al instalar desde Chrome, Android recorta el icono a un círculo y pinta
// la pantalla de arranque con `background_color`: salía un círculo con «SGR»
// sobre un fondo casi blanco, sin ninguna relación con la identidad de la
// Alcaldía.
//
// Esto los deriva de la misma fuente que la tarjeta para compartir enlaces
// (`og-tarjeta.html`): el escudo oficial sobre el azul institucional, con la
// franja amarilla del pie. Los colores están escritos otra vez aquí y no
// extraídos a un archivo común a propósito — son dos piezas de diseño que se
// rasterizan una vez y se versionan como imagen, no dos consumidores de un
// mismo token en tiempo de ejecución.
//
// ── Sobre el rasterizador ───────────────────────────────────────────────────
//
// Se compone un SVG y se convierte con `qlmanage` y `sips`, que vienen con
// macOS. La alternativa evidente era Chrome sin ventana, pero aquí se queda
// colgado sin escribir la captura; y bajar sharp o playwright para producir
// cuatro imágenes que cambian una vez al año no compensa en un proyecto que se
// despliega desde el portátil de una alcaldía.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');

/** El maestro se dibuja grande y se reduce: al revés se ven los dientes. */
const MAESTRO = 1024;

// ── El escudo ───────────────────────────────────────────────────────────────
//
// Se anida como un <svg> dentro del SVG del icono, en vez de referenciarlo con
// <image href="...">: así se rasteriza en el mismo paso y no depende de que el
// renderizador resuelva rutas relativas, que es donde fallaba al principio.

const original = readFileSync(join(aqui, 'og-escudo.svg'), 'utf8');

/** El escudo colocado en una caja, sin el prólogo XML ni el DOCTYPE. */
function escudoEn({ x, y, lado }) {
	return original
		.slice(original.indexOf('<svg'))
		.replace(
			/^<svg[^>]*>/s,
			`<svg x="${x}" y="${y}" width="${lado}" height="${lado}" viewBox="0 0 130 130" preserveAspectRatio="xMidYMid meet">`
		);
}

// ── La identidad, la misma de og-tarjeta.html ───────────────────────────────

/**
 * @param franja  alto de la franja amarilla del pie, en unidades del maestro.
 *                Cero la quita: en el icono `maskable` la franja va pegada al
 *                borde y el recorte circular de Android la dejaba convertida en
 *                un arco amarillo suelto, que parece un defecto.
 * @param radio   esquinas redondeadas ya dibujadas. Cero para los iconos que
 *                enmascara el propio sistema, que si no las redondearía dos
 *                veces y dejaría un borde oscuro alrededor.
 * @param escudo  alto del escudo respecto al lienzo. Es el número que decide si
 *                el icono sobrevive al recorte: Android solo garantiza el 80%
 *                central del `maskable`, así que ahí baja.
 */
function componer({ franja, radio, escudo }) {
	const L = MAESTRO;
	const altoFranja = Math.round(L * franja);
	const lado = Math.round(L * escudo);

	// Centrado en el espacio que queda POR ENCIMA de la franja, no en el lienzo:
	// centrarlo en el lienzo lo dejaba visiblemente hundido hacia el amarillo.
	const y = Math.round((L - altoFranja - lado) / 2);

	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
	width="${L}" height="${L}" viewBox="0 0 ${L} ${L}">
<defs>
	<linearGradient id="base" x1="0" y1="0" x2="0.42" y2="1">
		<stop offset="0" stop-color="#123a63"/>
		<stop offset="0.52" stop-color="#0d2b4e"/>
		<stop offset="1" stop-color="#0a2140"/>
	</linearGradient>

	<!-- El mismo golpe de luz azul que la tarjeta lleva arriba a la derecha. -->
	<radialGradient id="brillo" cx="0.74" cy="-0.12" r="0.85">
		<stop offset="0" stop-color="#1577d6" stop-opacity="0.5"/>
		<stop offset="0.62" stop-color="#1577d6" stop-opacity="0"/>
	</radialGradient>

	<!-- Retícula tenue: evoca la cuadrícula de un plano sin competir con el
	     escudo. A 48 px de un lanzador ya no se distingue, y no molesta. -->
	<pattern id="malla" width="128" height="128" patternUnits="userSpaceOnUse">
		<path d="M0 0H128M0 0V128" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2" fill="none"/>
	</pattern>

	<clipPath id="marco">
		<rect width="${L}" height="${L}" rx="${Math.round(L * radio)}"/>
	</clipPath>
</defs>

<g clip-path="url(#marco)">
	<rect width="${L}" height="${L}" fill="url(#base)"/>
	<rect width="${L}" height="${L}" fill="url(#brillo)"/>
	<rect width="${L}" height="${L}" fill="url(#malla)"/>
	${escudoEn({ x: Math.round((L - lado) / 2), y, lado })}
	${altoFranja > 0 ? `<rect x="0" y="${L - altoFranja}" width="${L}" height="${altoFranja}" fill="#f2b705"/>` : ''}
</g>
</svg>`;
}

// ── Qué se genera ───────────────────────────────────────────────────────────

const ICONOS = [
	// `purpose: any` — el lienzo se ve entero, con sus esquinas y su franja.
	{ archivo: 'icono-192.png', lado: 192, franja: 0.086, radio: 0.22, escudo: 0.6 },
	{ archivo: 'icono-512.png', lado: 512, franja: 0.086, radio: 0.22, escudo: 0.6 },

	// `purpose: maskable` — a sangre y con el escudo dentro del 80% central.
	{ archivo: 'icono-maskable-512.png', lado: 512, franja: 0, radio: 0, escudo: 0.56 },

	// iOS enmascara con su propio cuadrado redondeado, que conserva bastante
	// más que el círculo de Android: la franja sobrevive y vale la pena.
	{ archivo: 'apple-touch-icon.png', lado: 180, franja: 0.086, radio: 0, escudo: 0.58 }
];

const temporal = mkdtempSync(join(tmpdir(), 'iconos-sgr-'));

try {
	for (const icono of ICONOS) {
		const base = icono.archivo.replace(/\.png$/, '');
		const svg = join(temporal, `${base}.svg`);
		writeFileSync(svg, componer(icono));

		// qlmanage escribe <nombre>.svg.png dentro del directorio de salida.
		execFileSync('qlmanage', ['-t', '-s', String(MAESTRO), '-o', temporal, svg], {
			stdio: 'ignore'
		});

		const maestro = join(temporal, `${base}.svg.png`);
		const destino = join(raiz, 'static', icono.archivo);

		copyFileSync(maestro, destino);
		execFileSync('sips', ['-z', String(icono.lado), String(icono.lado), destino], {
			stdio: 'ignore'
		});

		console.log(`  ✓ static/${icono.archivo}  (${icono.lado}×${icono.lado})`);
	}
} finally {
	rmSync(temporal, { recursive: true, force: true });
}

console.log('\nIconos regenerados desde el escudo oficial.');
