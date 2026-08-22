<script lang="ts">
	// Botón para volver al inicio de la página.
	//
	// El tablero y el formulario son páginas largas: en un teléfono, volver
	// arriba desde el final del listado de barrios son varios barridos con el
	// pulgar. Aparece solo cuando hace falta —después de una pantalla completa
	// de desplazamiento— porque un botón flotante permanente le quita sitio al
	// contenido en las pantallas pequeñas, que es justo donde más se necesita.

	import { onMount } from 'svelte';
	import { ArrowUp } from '@lucide/svelte';

	let visible = $state(false);
	let pendiente = false;

	function evaluar(): void {
		// Un umbral relativo y no uno fijo en píxeles: una pantalla de escritorio
		// y una de teléfono no recorren lo mismo antes de que valga la pena.
		visible = window.scrollY > window.innerHeight;
	}

	function alDesplazar(): void {
		// El evento de desplazamiento se dispara decenas de veces por segundo. En
		// un teléfono de gama baja, calcular en cada uno hace perder cuadros al
		// listado que se está desplazando.
		if (pendiente) return;
		pendiente = true;
		requestAnimationFrame(() => {
			pendiente = false;
			evaluar();
		});
	}

	function subir(): void {
		const sinAnimacion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		window.scrollTo({ top: 0, behavior: sinAnimacion ? 'auto' : 'smooth' });

		// Mover el foco al principio, no solo la vista. Sin esto, quien navega con
		// teclado o lector de pantalla ve la página arriba pero su foco sigue
		// abajo, y la siguiente tabulación lo devuelve al punto de partida.
		document.getElementById('inicio-de-pagina')?.focus();
	}

	onMount(evaluar);
</script>

<svelte:window onscroll={alDesplazar} onresize={alDesplazar} />

<button
	class="arriba"
	class:arriba--visible={visible}
	type="button"
	onclick={subir}
	aria-label="Volver al principio de la página"
	title="Volver arriba"
	tabindex={visible ? 0 : -1}
	aria-hidden={!visible}
>
	<ArrowUp size={20} aria-hidden="true" />
</button>

<style>
	.arriba {
		position: fixed;

		/* Las variables de entorno respetan la barra de gestos del iPhone y el
		   borde redondeado de la pantalla: sin ellas el botón queda pegado al
		   filo y se vuelve difícil de acertar. */
		right: calc(1rem + env(safe-area-inset-right, 0px));
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));

		/* Por encima de la barra superior (20) pero por debajo del velo del menú
		   (55): con el menú abierto debe quedar tapado, no flotando encima. */
		z-index: 40;

		display: grid;
		place-items: center;

		/* 44 px es el mínimo recomendado para un objetivo táctil. */
		width: 44px;
		height: 44px;

		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 6px 20px rgb(10 30 60 / 18%);
		cursor: pointer;

		/* Oculto: no se anima el `display`, se saca de la vista, para que la
		   aparición pueda tener transición y el botón no ocupe sitio antes. */
		opacity: 0;
		transform: translateY(0.5rem);
		visibility: hidden;
		transition:
			opacity 160ms ease,
			transform 160ms ease,
			visibility 160ms;
	}

	.arriba--visible {
		opacity: 1;
		transform: translateY(0);
		visibility: visible;
	}

	.arriba:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.arriba:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.arriba:active {
		transform: translateY(1px);
	}

	@media (prefers-reduced-motion: reduce) {
		.arriba {
			transition: none;
		}
	}
</style>
