<script lang="ts">
	// Campo de texto de una o varias líneas.
	//
	// El error se ata al control con aria-describedby en vez de dejarlo suelto
	// debajo: así un lector de pantalla lo lee al enfocar el campo, y no solo
	// quien pueda verlo.

	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = {
		id: string;
		etiqueta: string;
		valor: string;
		error?: string;
		ayuda?: string;
		requerido?: boolean;
		tipo?: 'text' | 'email' | 'tel' | 'date' | 'number';
		multilinea?: boolean;
		filas?: number;
		maximo?: number;
		modoTeclado?: 'text' | 'numeric' | 'tel' | 'email';
		autocompletar?: HTMLInputAttributes['autocomplete'];
		marcador?: string;
		soloLectura?: boolean;
		min?: string;
		max?: string;
		alCambiar?: () => void;
	};

	let {
		id,
		etiqueta,
		valor = $bindable(''),
		error = '',
		ayuda = '',
		requerido = false,
		tipo = 'text',
		multilinea = false,
		filas = 4,
		maximo,
		modoTeclado,
		autocompletar,
		marcador,
		soloLectura = false,
		min,
		max,
		alCambiar
	}: Props = $props();

	const idAyuda = $derived(`${id}-ayuda`);
	const idError = $derived(`${id}-error`);
	const descrito = $derived(
		[ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="campo campo--grande" class:campo--invalido={!!error}>
	<label class="campo__etiqueta" for={id}>
		{etiqueta}{#if requerido}<span class="campo__requerido" aria-hidden="true">*</span
			><span class="visualmente-oculto"> (obligatorio)</span>{/if}
	</label>

	{#if ayuda}
		<span class="campo__ayuda" id={idAyuda}>{ayuda}</span>
	{/if}

	{#if multilinea}
		<textarea
			{id}
			class="campo__control"
			rows={filas}
			maxlength={maximo}
			placeholder={marcador}
			readonly={soloLectura}
			aria-required={requerido}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={descrito}
			bind:value={valor}
			oninput={alCambiar}
		></textarea>
		{#if maximo}
			<span class="campo__ayuda" aria-live="polite">
				{valor.length} de {maximo} caracteres
			</span>
		{/if}
	{:else}
		<input
			{id}
			{min}
			{max}
			class="campo__control"
			type={tipo}
			maxlength={maximo}
			inputmode={modoTeclado}
			autocomplete={autocompletar}
			placeholder={marcador}
			readonly={soloLectura}
			aria-required={requerido}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={descrito}
			bind:value={valor}
			oninput={alCambiar}
		/>
	{/if}

	{#if error}
		<span class="campo__error" id={idError}>{error}</span>
	{/if}
</div>

<style>
	.visualmente-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
