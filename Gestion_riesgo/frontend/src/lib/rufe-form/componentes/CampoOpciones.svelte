<script lang="ts">
	// Grupo de opciones excluyentes, dibujadas como tarjetas grandes.
	//
	// Va en un <fieldset> con <legend> porque un grupo de radios sin ellos deja al
	// lector de pantalla anunciando "Urbano, botón de opción" sin decir nunca de
	// qué pregunta se trata.

	// El booleano existe para las preguntas de sí/no del formato de inspección,
	// donde la respuesta es un sí o un no de verdad y no un código. Guardar 'SI'
	// y 'NO' como texto obligaría a traducirlos en cada sitio que los lea, y
	// tarde o temprano uno se traduciría mal.
	type Valor = string | number | boolean;

	type Opcion = { valor: Valor; etiqueta: string; nota?: string };

	type Props = {
		id: string;
		etiqueta: string;
		valor: Valor | null;
		opciones: Opcion[];
		error?: string;
		ayuda?: string;
		requerido?: boolean;
		columnas?: boolean;
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
		columnas = false,
		alCambiar
	}: Props = $props();

	const idAyuda = $derived(`${id}-ayuda`);
	const idError = $derived(`${id}-error`);
	const descrito = $derived(
		[ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined
	);

	function elegir(opcion: Opcion) {
		valor = opcion.valor;
		alCambiar?.();
	}
</script>

<!--
	role="radiogroup" y no el `group` implícito del <fieldset>: `group` no admite
	aria-required ni aria-invalid, así que sin esto el lector de pantalla no podría
	anunciar que la pregunta es obligatoria ni que quedó mal respondida.
-->
<fieldset
	class="campo grupo"
	class:campo--invalido={!!error}
	role="radiogroup"
	aria-required={requerido}
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={descrito}
>
	<legend class="campo__etiqueta">
		{etiqueta}{#if requerido}<span class="campo__requerido" aria-hidden="true">*</span>{/if}
	</legend>

	{#if ayuda}
		<span class="campo__ayuda" id={idAyuda}>{ayuda}</span>
	{/if}

	<div class="opciones" class:opciones--dos={columnas}>
		{#each opciones as opcion (opcion.valor)}
			<label class="opcion" class:opcion--activa={valor === opcion.valor}>
				<input
					type="radio"
					name={id}
					value={String(opcion.valor)}
					checked={valor === opcion.valor}
					onchange={() => elegir(opcion)}
				/>
				<span class="opcion__texto">
					{opcion.etiqueta}
					{#if opcion.nota}<span class="opcion__nota">{opcion.nota}</span>{/if}
				</span>
			</label>
		{/each}
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

	/* Dos columnas solo cuando hay sitio: en un teléfono de 360 px una etiqueta
	   como "Centro de bienestar del adulto mayor" no cabe partida en dos. */
	@media (min-width: 560px) {
		.opciones--dos {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
