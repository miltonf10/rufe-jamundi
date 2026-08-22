<script lang="ts">
	// Fecha de nacimiento en tres listas: día, mes y año.
	//
	// El formato de papel ya la pide así (DÍA / MES / AÑO) y, sobre todo,
	// <input type="date"> obliga a manejar un calendario para llegar a 1948, que
	// en un teléfono de gama baja es un suplicio. Tres listas se recorren rápido y
	// funcionan igual en cualquier navegador.

	type Props = {
		id: string;
		etiqueta: string;
		dia: string;
		mes: string;
		ano: string;
		error?: string;
		ayuda?: string;
		alCambiar?: () => void;
	};

	let {
		id,
		etiqueta,
		dia = $bindable(''),
		mes = $bindable(''),
		ano = $bindable(''),
		error = '',
		ayuda = '',
		alCambiar
	}: Props = $props();

	const MESES = [
		'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
		'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
	];

	const anoActual = new Date().getFullYear();
	const dias = Array.from({ length: 31 }, (_, i) => i + 1);
	const anos = Array.from({ length: 121 }, (_, i) => anoActual - i);

	const idAyuda = $derived(`${id}-ayuda`);
	const idError = $derived(`${id}-error`);
	const descrito = $derived(
		[ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined
	);
</script>

<fieldset class="campo grupo" class:campo--invalido={!!error}>
	<legend class="campo__etiqueta">{etiqueta}</legend>

	{#if ayuda}
		<span class="campo__ayuda" id={idAyuda}>{ayuda}</span>
	{/if}

	<div class="partes">
		<div class="parte">
			<label class="parte__etiqueta" for="{id}-dia">Día</label>
			<select
				id="{id}-dia"
				class="campo__control"
				bind:value={dia}
				onchange={alCambiar}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={descrito}
			>
				<option value="">--</option>
				{#each dias as d (d)}<option value={String(d)}>{d}</option>{/each}
			</select>
		</div>

		<div class="parte parte--ancha">
			<label class="parte__etiqueta" for="{id}-mes">Mes</label>
			<select id="{id}-mes" class="campo__control" bind:value={mes} onchange={alCambiar}>
				<option value="">--</option>
				{#each MESES as nombre, i (nombre)}<option value={String(i + 1)}>{nombre}</option>{/each}
			</select>
		</div>

		<div class="parte">
			<label class="parte__etiqueta" for="{id}-ano">Año</label>
			<select id="{id}-ano" class="campo__control" bind:value={ano} onchange={alCambiar}>
				<option value="">----</option>
				{#each anos as a (a)}<option value={String(a)}>{a}</option>{/each}
			</select>
		</div>
	</div>

	{#if error}
		<span class="campo__error" id={idError}>{error}</span>
	{/if}
</fieldset>

<style>
	.grupo {
		border: 0;
		padding: 0;
		margin: 0 0 0.9rem;
		min-width: 0;
	}

	.grupo legend {
		padding: 0;
	}

	.partes {
		display: grid;
		grid-template-columns: 1fr 1.4fr 1fr;
		gap: 0.5rem;
	}

	.parte__etiqueta {
		display: block;
		font-size: 0.72rem;
		color: var(--color-muted);
		margin-bottom: 0.2rem;
	}

	.parte :global(.campo__control) {
		min-height: 44px;
	}
</style>
