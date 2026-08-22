<script lang="ts">
	// Los dibujos de las señales de daño.
	//
	// Andrés pidió que cada criterio se reconociera «con sola verla». Son SVG
	// dibujados a mano y no fotografías, por tres razones:
	//
	//  • Van DENTRO del archivo de la página. Ocho fotos serían más de un mega
	//    que hay que descargar justo en la vereda donde no hay señal, que es
	//    exactamente donde está quien necesita llenar esto.
	//  • Una fotografía de una casa agrietada es la casa DE ALGUIEN. Publicar la
	//    de un damnificado en el formulario público sería usar su desgracia de
	//    ilustración, y una de archivo ajena confunde: la gente compara su casa
	//    con la de la foto en vez de con la idea.
	//  • El dibujo señala el daño y calla el resto. La foto trae mil detalles y
	//    ninguno indica cuál es el que hay que mirar.
	//
	// Por eso el daño va SIEMPRE en el trazo grueso de color y la vivienda en el
	// trazo fino: la mirada cae primero donde tiene que caer.

	type Props = {
		icono: string;
		/**
		 * Versión de listado, a unos 30 px.
		 *
		 * No es solo cuestión de encogerlo: a ese tamaño un trazo de 2,2 px se
		 * queda en menos de un píxel y el dibujo se deshace en una mancha gris.
		 * Los trazos engordan y la vivienda sube de opacidad para que la silueta
		 * siga leyéndose.
		 */
		compacto?: boolean;
	};

	let { icono, compacto = false }: Props = $props();
</script>

<svg
	class="dibujo"
	class:dibujo--compacto={compacto}
	viewBox="0 0 100 76"
	fill="none"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if icono === 'pared-agrietada'}
		<!-- Muro de ladrillo entero, con la grieta atravesándolo de arriba abajo. -->
		<g class="base">
			<rect x="12" y="12" width="76" height="52" rx="2" />
			<path d="M12 25h76M12 38h76M12 51h76" />
			<path d="M31 12v13M69 12v13M31 38v13M69 38v13M50 25v13M50 51v13" />
		</g>
		<path class="dano" d="M46 12l7 12-9 9 8 10-6 9 5 12" />

	{:else if icono === 'pared-caida'}
		<!-- El mismo muro, pero la mitad derecha ya no está: se ve el hueco y los
		     escombros al pie. La parte que queda en pie va inclinada. -->
		<g class="base">
			<path d="M12 64V14h30v50" />
			<path d="M12 27h30M12 40h30M12 53h30" />
		</g>
		<path class="dano" d="M42 64l6-22 9 22" />
		<path class="dano" d="M60 64l5-13 7 13" />
		<path class="dano" d="M76 64l4-8 5 8" />
		<path class="dano" d="M10 66h82" />

	{:else if icono === 'columna-danada'}
		<!-- Viga apoyada en dos columnas. La de la derecha está partida y desplazada. -->
		<g class="base">
			<rect x="14" y="12" width="72" height="10" rx="1" />
			<path d="M22 22v42M36 22v42M22 64h14" />
		</g>
		<path class="dano" d="M64 22v14M78 22v13" />
		<path class="dano" d="M62 36l18 3" />
		<path class="dano" d="M68 39v25M82 38v26M68 64h14" />
		<path class="dano" d="M12 68h76" />

	{:else if icono === 'techo-tejas'}
		<!-- Cubierta a dos aguas con hiladas de teja. Faltan tejas en el centro y
		     una quedó corrida fuera de su fila. -->
		<g class="base">
			<path d="M50 10L12 36v30h76V36L50 10z" />
			<path d="M12 36h76" />
			<path d="M20 66V48h18v18" />
		</g>
		<path class="dano" d="M36 22h12M32 27h9M52 27h8M44 32h14" />
		<path class="dano" d="M62 18l9 5-4 7" />

	{:else if icono === 'techo-caido'}
		<!-- Las paredes siguen en pie y el techo se hundió hacia adentro. -->
		<g class="base">
			<path d="M14 30v36h72V30" />
			<path d="M40 66V50h20v16" />
		</g>
		<path class="dano" d="M14 30l16 16 12-9 14 12 12-11 18 12" />
		<path class="dano" d="M46 20l6 8M62 16l-3 9" />

	{:else if icono === 'piso-danado'}
		<!-- La losa vista desde arriba, con la grieta y la parte hundida. -->
		<g class="base">
			<path d="M10 26h80l-8 40H18L10 26z" />
			<path d="M31 26l-4 40M69 26l4 40M14 46h72" />
		</g>
		<path class="dano" d="M44 26l5 12-8 9 7 10-4 9" />
		<path class="dano" d="M58 46l16 4-4 12-14-3z" />

	{:else if icono === 'agua-danada'}
		<!-- Tubería partida por la mitad, con el agua saliendo. -->
		<g class="base">
			<path d="M12 30h26M62 30h26" />
			<path d="M12 24v12M88 24v12" />
			<rect x="26" y="24" width="8" height="12" rx="1" />
			<rect x="66" y="24" width="8" height="12" rx="1" />
		</g>
		<path class="dano" d="M38 24v12M62 24v12" />
		<path class="dano" d="M44 44l-6 10M50 46v11M56 44l6 10" />
		<path class="dano" d="M36 62c4-6 8-6 12 0M54 64c4-6 8-6 12 0" />

	{:else if icono === 'luz-danada'}
		<!-- Cable roto entre dos puntos, con la chispa en la ruptura. -->
		<g class="base">
			<rect x="10" y="20" width="16" height="20" rx="2" />
			<rect x="74" y="20" width="16" height="20" rx="2" />
			<path d="M26 30h12M62 30h12" />
			<path d="M16 44v18M84 44v18M12 62h76" />
		</g>
		<path class="dano" d="M38 30l6 4-5 5" />
		<path class="dano" d="M62 30l-6-4 5-5" />
		<path class="dano" d="M52 12l-8 14h11l-8 16" />

	{:else}
		<!-- Señal nueva sin dibujo: se marca visiblemente en vez de dejar el hueco
		     en blanco, para que se note al añadirla y no pase a producción muda. -->
		<g class="base">
			<rect x="16" y="14" width="68" height="48" rx="4" />
		</g>
		<path class="dano" d="M50 26v18M50 52v2" />
	{/if}
</svg>

<style>
	.dibujo {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 100 / 76;
	}

	/* La vivienda: trazo fino y apagado. Está para dar contexto, no para mirarla. */
	.base {
		stroke: var(--color-muted);
		stroke-width: 2.2;
		opacity: 0.65;
	}

	/* El daño: grueso y en color. Es lo único que la persona tiene que reconocer. */
	.dano {
		stroke: var(--color-danger);
		stroke-width: 3.4;
	}

	.dibujo--compacto .base {
		stroke-width: 4;
		opacity: 0.8;
	}

	.dibujo--compacto .dano {
		stroke-width: 6;
	}
</style>
