<script lang="ts">
	// Lista desplegable. Se usa cuando hay más de seis opciones; con menos, un
	// grupo de radios (CampoOpciones) es más rápido de usar en un teléfono porque
	// no obliga a abrir un menú del sistema.

	type Opcion = { valor: string | number; etiqueta: string };

	type Props = {
		id: string;
		etiqueta: string;
		valor: string | number | null;
		opciones: Opcion[];
		error?: string;
		ayuda?: string;
		requerido?: boolean;
		vacio?: string;
		numerico?: boolean;
		alCambiar?: () => void;
	};

	let {
		id,
		etiqueta,
		valor = $bindable(null),
		opciones,
		error = '',
		ayuda = '',
		requerido = false,
		vacio = 'Seleccione…',
		numerico = false,
		alCambiar
	}: Props = $props();

	const idAyuda = $derived(`${id}-ayuda`);
	const idError = $derived(`${id}-error`);
	const descrito = $derived(
		[ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined
	);

	function seleccionar(evento: Event) {
		const bruto = (evento.currentTarget as HTMLSelectElement).value;

		// Los catálogos del formato usan códigos numéricos; el DOM siempre devuelve
		// cadenas, así que hay que reconvertir o el === contra el catálogo fallaría.
		valor = bruto === '' ? null : numerico ? Number(bruto) : bruto;
		alCambiar?.();
	}
</script>

<div class="campo campo--grande" class:campo--invalido={!!error}>
	<label class="campo__etiqueta" for={id}>
		{etiqueta}{#if requerido}<span class="campo__requerido" aria-hidden="true">*</span>{/if}
	</label>

	{#if ayuda}
		<span class="campo__ayuda" id={idAyuda}>{ayuda}</span>
	{/if}

	<select
		{id}
		class="campo__control"
		value={valor === null ? '' : String(valor)}
		aria-required={requerido}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={descrito}
		onchange={seleccionar}
	>
		<option value="">{vacio}</option>
		{#each opciones as opcion (opcion.valor)}
			<option value={String(opcion.valor)}>{opcion.etiqueta}</option>
		{/each}
	</select>

	{#if error}
		<span class="campo__error" id={idError}>{error}</span>
	{/if}
</div>
