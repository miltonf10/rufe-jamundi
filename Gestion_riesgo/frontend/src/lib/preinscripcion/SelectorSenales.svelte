<script lang="ts">
	// Las señales de daño, en tarjetas con dibujo y casilla.
	//
	// Va en un <fieldset> con <legend> y con casillas de verdad, no botones con
	// aria-pressed. Es la misma corrección que hubo que hacer en el formato de
	// inspección: unos botones que solo cambiaban de fondo eran invisibles en
	// modo oscuro y no se sabía qué quedaba marcado. Aquí importa más todavía,
	// porque quien mira esta pantalla no vuelve mañana a corregirlo.
	//
	// Se pueden marcar varias, o ninguna. Marcar varias es lo normal: un
	// vendaval no rompe solo el techo.

	import { Check } from '@lucide/svelte';
	import IconoSenal from './IconoSenal.svelte';

	type Senal = { codigo: string; etiqueta: string; ayuda: string; icono: string };

	type Props = {
		senales: Senal[];
		marcadas: string[];
		error?: string;
	};

	let { senales, marcadas = $bindable([]), error = '' }: Props = $props();

	function alternar(codigo: string) {
		marcadas = marcadas.includes(codigo)
			? marcadas.filter((c) => c !== codigo)
			: [...marcadas, codigo];
	}
</script>

<fieldset class="grupo" aria-describedby="senales-ayuda">
	<legend class="grupo__titulo">¿Qué le ve a su vivienda?</legend>

	<p class="grupo__ayuda" id="senales-ayuda">
		Marque <strong>todo lo que reconozca</strong>. Puede marcar varias cosas, y también puede
		continuar sin marcar ninguna si no está seguro: un profesional lo revisará en la visita.
	</p>

	<div class="rejilla">
		{#each senales as senal (senal.codigo)}
			{@const activa = marcadas.includes(senal.codigo)}
			<label class="ficha" class:ficha--activa={activa}>
				<input
					type="checkbox"
					class="ficha__casilla"
					checked={activa}
					onchange={() => alternar(senal.codigo)}
				/>

				<span class="ficha__marca" aria-hidden="true">
					{#if activa}<Check size={14} strokeWidth={3} />{/if}
				</span>

				<span class="ficha__dibujo">
					<IconoSenal icono={senal.icono} />
				</span>

				<span class="ficha__texto">
					<span class="ficha__etiqueta">{senal.etiqueta}</span>
					<span class="ficha__ayuda">{senal.ayuda}</span>
				</span>
			</label>
		{/each}
	</div>

	{#if error}
		<span class="campo__error">{error}</span>
	{/if}

	<p class="recuento" role="status" aria-live="polite">
		{#if marcadas.length === 0}
			No ha marcado ninguna todavía.
		{:else if marcadas.length === 1}
			Marcó 1 daño.
		{:else}
			Marcó {marcadas.length} daños.
		{/if}
	</p>
</fieldset>

<style>
	.grupo {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	.grupo__titulo {
		padding: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.grupo__ayuda {
		margin: 0.35rem 0 1rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	/* Dos columnas desde bien pronto: con una sola, ocho tarjetas obligan a un
	   desplazamiento largo y se pierde la sensación de «esto es una lista para
	   escoger». A 340 px caben dos de 150. */
	.rejilla {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.7rem;
	}

	@media (min-width: 640px) {
		.rejilla {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.ficha {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.7rem 0.6rem 0.75rem;
		border: 2px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
		cursor: pointer;
		transition: border-color 0.15s, background-color 0.15s;
	}

	.ficha:hover {
		border-color: var(--color-border-strong);
	}

	/* Marcada: borde grueso de color, fondo teñido Y la palomita. Tres señales a
	   la vez, no una. Con solo el fondo no se distinguía en modo oscuro. */
	.ficha--activa {
		border-color: var(--color-primary);
		background: var(--color-info-bg);
	}

	/* La casilla real sigue ahí, recibiendo el foco y el teclado; lo que se ve es
	   `.ficha__marca`. No se usa display:none, que la sacaría del orden de
	   tabulación y dejaría el grupo inservible con teclado. */
	.ficha__casilla {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		margin: 0;
	}

	.ficha__casilla:focus-visible ~ .ficha__marca {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.ficha__marca {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 2px solid var(--color-border-strong);
		border-radius: 6px;
		background: var(--color-surface);
		color: #fff;
	}

	.ficha--activa .ficha__marca {
		border-color: var(--color-primary);
		background: var(--color-primary);
	}

	.ficha__dibujo {
		display: block;
		padding: 0.2rem 1.4rem 0 0.2rem;
	}

	.ficha__texto {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.ficha__etiqueta {
		font-size: 0.87rem;
		font-weight: 600;
		line-height: 1.25;
		color: var(--color-text);
	}

	.ficha__ayuda {
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--color-muted);
	}

	.recuento {
		margin: 0.9rem 0 0;
		font-size: 0.82rem;
		color: var(--color-muted);
	}
</style>
