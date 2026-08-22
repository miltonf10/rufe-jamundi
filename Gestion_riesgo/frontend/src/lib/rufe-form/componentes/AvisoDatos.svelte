<script lang="ts">
	// Aviso de tratamiento de datos personales, con el texto que el propio formato
	// FR-1703-SMD-69 trae impreso al pie.
	//
	// Se muestra dos veces: en el paso de orientación, para que el ciudadano sepa
	// a qué se compromete antes de escribir nada, y junto a las casillas del
	// último paso, que es donde consta el consentimiento.

	type Props = { compacto?: boolean };

	let { compacto = false }: Props = $props();

	const POLITICA =
		'https://portal.gestiondelriesgo.gov.co/Documents/Ley_Transparencia/Politica-de-Tratamiento-de-Datos-Personales.pdf';
</script>

<div class="aviso-datos" class:aviso-datos--compacto={compacto}>
	<h3 class="aviso-datos__titulo">Tratamiento de sus datos personales</h3>

	<p>
		Los datos personales solicitados serán tratados y almacenados de manera confidencial por la
		Unidad Nacional para la Gestión del Riesgo de Desastres y por la Alcaldía Municipal de Jamundí,
		con el fin de realizar análisis estadísticos y mejorar la atención de la emergencia. En ningún
		caso serán utilizados para otros propósitos ni compartidos con terceros sin su consentimiento.
	</p>

	{#if !compacto}
		<p>
			Este formulario recoge <strong>identidad de género</strong> y
			<strong>pertenencia étnica</strong>, que la ley considera datos sensibles. Responderlos es
			voluntario y sirve para priorizar la atención de poblaciones con protección especial.
		</p>

		<p>
			Puede solicitar en cualquier momento el acceso, la corrección o la supresión de sus datos ante
			la Secretaría de Gestión del Riesgo de Desastres de Jamundí.
		</p>
	{/if}

	<p class="aviso-datos__enlace">
		<a href={POLITICA} target="_blank" rel="noopener noreferrer">
			Consultar la política de tratamiento de datos (se abre en otra pestaña)
		</a>
	</p>
</div>

<style>
	.aviso-datos {
		padding: 0.9rem 1rem;
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--color-primary);
		border-radius: 10px;
		background: var(--color-surface-alt);
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.aviso-datos--compacto {
		font-size: 0.8rem;
	}

	.aviso-datos__titulo {
		margin: 0 0 0.5rem;
		font-size: 0.88rem;
		font-weight: 700;
	}

	.aviso-datos p {
		margin: 0 0 0.55rem;
	}

	.aviso-datos p:last-child {
		margin-bottom: 0;
	}

	.aviso-datos__enlace a {
		color: var(--color-primary-dark);
	}
</style>
