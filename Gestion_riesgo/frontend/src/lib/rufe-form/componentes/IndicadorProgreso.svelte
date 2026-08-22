<script lang="ts">
	// Progreso del formulario. El paso de orientación y el de revisión no cuentan
	// como avance: si contaran, el ciudadano vería "paso 1 de 9" antes de haber
	// escrito nada y el indicador dejaría de significar cuánto le falta.

	type Props = { indice: number; total: number; titulo: string };

	let { indice, total, titulo }: Props = $props();

	const porcentaje = $derived(total > 0 ? Math.round((indice / total) * 100) : 0);
</script>

<div class="pasos">
	<p class="pasos__texto">
		<span class="pasos__actual">{titulo}</span>
		{#if indice > 0}
			<span>Paso {indice} de {total}</span>
		{/if}
	</p>

	<div
		class="pasos__barra"
		role="progressbar"
		aria-valuenow={indice}
		aria-valuemin={0}
		aria-valuemax={total}
		aria-label="Avance del formulario"
	>
		<div class="pasos__avance" style="width: {porcentaje}%"></div>
	</div>
</div>
