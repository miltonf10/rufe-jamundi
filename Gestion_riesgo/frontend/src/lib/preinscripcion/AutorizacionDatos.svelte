<script lang="ts">
	// La autorización de datos, resumida arriba y completa si se pide.
	//
	// El texto anterior era un párrafo de ocho renglones metido dentro de la
	// propia casilla. Ocupaba media pantalla de celular y conseguía lo contrario
	// de lo que buscaba: nadie lee un contrato que le tapa el botón de enviar, y
	// una autorización que nadie lee no es informada por mucho que esté escrita.
	//
	// Ahora se marca sobre una frase que sí se lee, y el texto completo está a un
	// toque de distancia. Esto NO recorta lo que se autoriza: lo que se guarda
	// como consentimiento sigue siendo la versión del aviso —`aviso_version`—, y
	// el texto íntegro que esa versión contiene es el de aquí abajo. Por eso el
	// resumen enumera los datos uno por uno, incluida la foto de la cédula: un
	// resumen que escondiera algo sería peor que el párrafo largo.

	import { ChevronDown, ShieldCheck } from '@lucide/svelte';

	type Props = { aceptado: boolean; error?: string };

	let { aceptado = $bindable(false), error = '' }: Props = $props();

	let desplegado = $state(false);

	const POLITICA =
		'https://portal.gestiondelriesgo.gov.co/Documents/Ley_Transparencia/Politica-de-Tratamiento-de-Datos-Personales.pdf';
</script>

<div class="autorizacion">
	<label class="opcion opcion--legal" class:opcion--activa={aceptado}>
		<input type="checkbox" bind:checked={aceptado} />
		<span class="opcion__texto">
			Autorizo a la <strong>Alcaldía de Jamundí</strong> a tratar mis datos personales y las fotos y
			videos que envío, únicamente para programar y realizar la inspección de mi vivienda.
		</span>
	</label>

	{#if error}
		<span class="campo__error">{error}</span>
	{/if}

	<button
		type="button"
		class="desplegar"
		aria-expanded={desplegado}
		onclick={() => (desplegado = !desplegado)}
	>
		<ChevronDown size={15} class={desplegado ? 'girado' : ''} aria-hidden="true" />
		{desplegado ? 'Ocultar el texto completo' : 'Leer el texto completo antes de aceptar'}
	</button>

	{#if desplegado}
		<div class="texto">
			<h3>Autorización para el tratamiento de datos personales</h3>

			<p>
				Con la marcación de la casilla anterior autorizo de manera <strong>libre, previa, expresa
				e informada</strong> a la <strong>Alcaldía Municipal de Jamundí</strong>, en calidad de
				responsable del tratamiento, a recolectar, almacenar, usar y suprimir los datos personales
				que entrego en este formulario, en los términos de la Ley 1581 de 2012 y el Decreto 1074 de
				2015.
			</p>

			<h4>Qué datos entrego</h4>
			<ul>
				<li>Nombre y apellidos, número de cédula, teléfono y, si lo escribí, correo electrónico.</li>
				<li>La dirección o referencia de mi vivienda, la zona y, cuando la tomé, su ubicación en el mapa.</li>
				<li>La descripción de los daños y las señales que marqué.</li>
				<li>
					Las <strong>fotografías</strong> que adjunto, incluida la de mi
					<strong>documento de identidad</strong>, y los <strong>videos</strong> que grabo de la
					vivienda.
				</li>
			</ul>

			<h4>Para qué se usan</h4>
			<p>
				Únicamente para programar y realizar la inspección técnica de la vivienda afectada, atender
				la emergencia y, si corresponde, tramitar la entrega de materiales. No se usan para
				publicidad ni se comparten con terceros sin mi consentimiento, salvo requerimiento de
				autoridad competente.
			</p>

			<h4>Cuánto tiempo se conservan</h4>
			<p>
				Los datos se conservan mientras dure la atención del caso y por el término que exijan las
				normas de archivo aplicables a la entidad. <strong>Los videos se eliminan cuando se
				decide la solicitud</strong>, conservándose únicamente la constancia de que existieron.
			</p>

			<h4>Qué derechos tengo</h4>
			<p>
				Conocer, actualizar y rectificar mis datos; solicitar prueba de esta autorización; ser
				informado sobre su uso; presentar quejas ante la Superintendencia de Industria y Comercio;
				y solicitar la supresión de mis datos cuando no exista un deber legal de conservarlos.
				Puedo ejercerlos ante la Secretaría de Gestión del Riesgo de Desastres de Jamundí.
			</p>

			<h4>Es voluntario</h4>
			<p>
				Entregar estos datos es voluntario. Sin embargo, sin ellos no es posible ubicar la vivienda
				ni contactarme para programar la visita, de modo que la solicitud no podría atenderse.
			</p>

			<p class="texto__nota">
				Este formulario <strong>no recoge datos sensibles</strong> —identidad de género,
				pertenencia étnica, salud—. Si el caso avanza, esa información la levanta un funcionario
				durante la visita, explicando el aviso de viva voz.
			</p>

			<p>
				<a href={POLITICA} target="_blank" rel="noopener noreferrer">
					Política de tratamiento de datos personales (se abre en otra pestaña)
				</a>
			</p>
		</div>
	{/if}

	<p class="pie">
		<ShieldCheck size={14} aria-hidden="true" />
		<span>Registrarse no garantiza por sí solo la entrega de materiales: eso lo decide la inspección técnica.</span>
	</p>
</div>

<style>
	.autorizacion {
		display: grid;
		gap: 0.75rem;
	}

	/* Un poco más de aire que una opción normal: es la casilla que compromete
	   jurídicamente al ciudadano, y tocarla por accidente no debe ser fácil. */
	.opcion--legal {
		align-items: flex-start;
		padding: 0.85rem 0.9rem;
		line-height: 1.5;
	}

	.desplegar {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.83rem;
		color: var(--color-primary);
		text-align: left;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.desplegar :global(.girado) {
		transform: rotate(180deg);
	}

	.texto {
		max-height: 22rem;
		overflow-y: auto;
		padding: 0.9rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface-alt);
		font-size: 0.82rem;
		line-height: 1.55;
	}

	.texto h3 {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
	}

	.texto h4 {
		margin: 0.9rem 0 0.3rem;
		font-size: 0.83rem;
		color: var(--color-primary-dark);
	}

	.texto p,
	.texto ul {
		margin: 0 0 0.5rem;
	}

	.texto ul {
		padding-left: 1.1rem;
	}

	.texto li {
		margin-bottom: 0.25rem;
	}

	.texto__nota {
		margin-top: 0.9rem;
		padding-top: 0.7rem;
		border-top: 1px solid var(--color-border);
		color: var(--color-muted);
	}

	.pie {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--color-muted);
	}

	.pie :global(svg) {
		flex: none;
		margin-top: 0.15rem;
	}
</style>
