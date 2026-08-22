<script lang="ts">
	// Resumen de los errores del paso, con un enlace a cada campo.
	//
	// Existe porque en un formulario largo el error puede quedar fuera de la
	// pantalla: sin este resumen, pulsar "Siguiente" no parece hacer nada. Lleva
	// role="alert" y recibe el foco, de modo que un lector de pantalla lo anuncia
	// en cuanto aparece.

	type Props = { errores: Record<string, string>; etiquetas?: Record<string, string> };

	let { errores, etiquetas = {} }: Props = $props();

	let contenedor = $state<HTMLDivElement | null>(null);

	const lista = $derived(Object.entries(errores));

	$effect(() => {
		if (lista.length > 0) contenedor?.focus();
	});

	function irAlCampo(clave: string) {
		const destino = document.getElementById(clave) ?? document.getElementById(`campo-${clave}`);
		if (!destino) return;

		destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
		if (destino instanceof HTMLElement) destino.focus({ preventScroll: true });
	}
</script>

{#if lista.length > 0}
	<div
		bind:this={contenedor}
		class="aviso aviso--error"
		role="alert"
		tabindex="-1"
	>
		<p class="titulo">
			{lista.length === 1
				? 'Falta corregir un dato:'
				: `Faltan corregir ${lista.length} datos:`}
		</p>
		<ul>
			{#each lista as [clave, mensaje] (clave)}
				<li>
					<button type="button" class="enlace" onclick={() => irAlCampo(clave)}>
						{etiquetas[clave] ? `${etiquetas[clave]}: ` : ''}{mensaje}
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.titulo {
		margin: 0 0 0.4rem;
		font-weight: 600;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.25rem;
	}

	.enlace {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		text-decoration: underline;
		cursor: pointer;
	}

	.enlace:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
</style>
