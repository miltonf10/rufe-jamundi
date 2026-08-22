<script lang="ts">
	// Constancia de la ficha registrada.
	//
	// El radicado se muestra grande y se puede copiar o imprimir porque es lo que
	// el funcionario le deja al hogar como constancia de la visita. Se dicta en voz
	// alta con frecuencia, de ahí la tipografía tabular y el alfabeto sin
	// caracteres que se confundan.
	//
	// El botón de registrar otra ficha es el camino habitual: una brigada levanta
	// varias casas seguidas y no debería tener que volver por el menú cada vez.

	import { Check, ClipboardPlus, CloudOff, Copy, List, Printer } from '@lucide/svelte';

	type Props = {
		radicado: string;
		recibidoEn: string;
		evento: string;
		direccion: string;
		personas: number;
		onOtra: () => void;
		/** La ficha quedó guardada sin salir: todavía no hay radicado. */
		enCola?: boolean;
		/** Cuántas fichas esperan salir, contando las de visitas anteriores. */
		pendientes?: number;
		/** El navegador puede enviarlas con la aplicación cerrada. */
		enSegundoPlano?: boolean;
	};

	let {
		radicado,
		recibidoEn,
		evento,
		direccion,
		personas,
		onOtra,
		enCola = false,
		pendientes = 0,
		enSegundoPlano = false
	}: Props = $props();

	let copiado = $state(false);

	const fecha = $derived(
		new Date(recibidoEn).toLocaleString('es-CO', {
			dateStyle: 'long',
			timeStyle: 'short',
			timeZone: 'America/Bogota'
		})
	);

	async function copiar() {
		try {
			await navigator.clipboard.writeText(radicado);
			copiado = true;
			setTimeout(() => (copiado = false), 2500);
		} catch {
			// Sin permiso de portapapeles (o sin HTTPS en desarrollo): el número
			// está a la vista y se puede seleccionar a mano.
			copiado = false;
		}
	}
</script>

<div class="confirmacion">
	{#if enCola}
		<div class="marca marca--espera" aria-hidden="true"><CloudOff size={30} /></div>

		<h1 class="titulo">Ficha guardada en el teléfono</h1>
		<p class="entrada">
			No se ha perdido nada: los datos están guardados en este dispositivo y se enviarán solos.
		</p>

		<div class="espera">
			<p class="espera__texto">
				{#if enSegundoPlano}
					Se enviará en cuanto el teléfono recupere señal, <strong>aunque cierre la aplicación</strong>.
				{:else}
					Se enviará en cuanto vuelva la señal. Deje la aplicación abierta: este navegador no
					permite enviarla en segundo plano.
				{/if}
			</p>

			{#if pendientes > 0}
				<p class="espera__cuenta">
					{pendientes === 1
						? 'Hay 1 ficha esperando salir.'
						: `Hay ${pendientes} fichas esperando salir.`}
				</p>
			{/if}

			<p class="espera__nota">
				El número de radicado se genera cuando la ficha llega a la Alcaldía. Podrá consultarlo
				después en <strong>Reportes RUFE</strong>.
			</p>
		</div>
	{:else}
		<div class="marca" aria-hidden="true"><Check size={32} /></div>

		<h1 class="titulo">Ficha registrada</h1>
		<p class="entrada">Entregue este número al hogar. Es su constancia ante la Alcaldía.</p>

		<p class="radicado">{radicado}</p>
	{/if}

	<div class="acciones no-imprimir" class:acciones--ocultas={enCola}>
		<button type="button" class="boton" onclick={copiar}>
			{#if copiado}
				<Check size={16} aria-hidden="true" />
				Copiado
			{:else}
				<Copy size={16} aria-hidden="true" />
				Copiar el número
			{/if}
		</button>

		<button type="button" class="boton boton--suave" onclick={() => window.print()}>
			<Printer size={16} aria-hidden="true" />
			Imprimir o guardar en PDF
		</button>
	</div>

	<p class="aviso-copia" role="status" aria-live="polite">
		{copiado ? 'El número de radicado se copió al portapapeles.' : ''}
	</p>

	<dl class="detalle">
		{#if !enCola}
			<div><dt>Registrada el</dt><dd>{fecha}</dd></div>
		{/if}
		<div><dt>Evento reportado</dt><dd>{evento}</dd></div>
		<div><dt>Dirección</dt><dd>{direccion}</dd></div>
		<div>
			<dt>Personas registradas</dt>
			<dd>{personas}</dd>
		</div>
	</dl>

	<div class="siguiente no-imprimir">
		<button type="button" class="boton boton--otra" onclick={onOtra}>
			<ClipboardPlus size={17} aria-hidden="true" />
			Registrar otra ficha
		</button>

		<a class="boton boton--suave" href="/riesgo/reportes">
			<List size={16} aria-hidden="true" />
			Ver los reportes registrados
		</a>
	</div>

	{#if !enCola}
		<section class="siguientes no-imprimir">
			<h2>Qué sigue</h2>
			<ol>
				<li>La ficha queda en estado <strong>Recibido</strong>: todavía no es oficial.</li>
				<li>Un gestor la revisa y le da el Vo.Bo. desde la bandeja de reportes.</li>
				<li>Si algo no cuadra, llamarán al teléfono de contacto que registró.</li>
			</ol>

			<p class="indicacion">
				Dígale al hogar que, para consultar el estado, se acerque a la Secretaría de Gestión del
				Riesgo de Desastres con este número de radicado.
			</p>
		</section>
	{/if}
</div>

<style>
	.confirmacion {
		text-align: center;
		max-width: 34rem;
		margin: 0 auto;
	}

	.marca {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		margin: 0 auto 1rem;
		border-radius: 50%;
		background: var(--color-success-bg);
		color: var(--color-success);
	}

	/* Azul y no verde: la ficha está a salvo, pero todavía no llegó. Usar el
	   mismo verde del éxito haría creer que ya está en la Alcaldía. */
	.marca--espera {
		background: var(--color-info-bg);
		color: var(--color-primary);
	}

	.espera {
		margin-bottom: 1.4rem;
		padding: 0.9rem;
		border: 1px solid var(--aviso-info-borde);
		border-radius: 12px;
		background: var(--color-info-bg);
		text-align: left;
	}

	.espera__texto {
		margin: 0 0 0.5rem;
		font-size: 0.88rem;
		color: var(--color-primary-dark);
	}

	.espera__cuenta {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-primary-dark);
	}

	.espera__nota {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.acciones--ocultas {
		display: none;
	}

	.titulo {
		margin: 0 0 0.35rem;
		font-size: 1.35rem;
		font-weight: 700;
	}

	.entrada {
		margin: 0 0 1.2rem;
		color: var(--color-muted);
		font-size: 0.9rem;
	}

	/* Tabular y espaciado: el número está para dictarlo y copiarlo a mano. */
	.radicado {
		margin: 0 0 1rem;
		padding: 0.9rem 0.6rem;
		border: 2px dashed var(--color-primary);
		border-radius: 12px;
		background: var(--color-info-bg);
		color: var(--color-primary-deep);
		font-size: clamp(1.1rem, 6vw, 1.6rem);
		font-weight: 700;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
		word-break: break-all;
		user-select: all;
	}

	.acciones {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		flex-wrap: wrap;
	}

	.aviso-copia {
		min-height: 1.1rem;
		margin: 0.4rem 0 1.2rem;
		font-size: 0.78rem;
		color: var(--color-success);
	}

	.detalle {
		margin: 0 0 1.5rem;
		text-align: left;
		display: grid;
		gap: 0.4rem;
		padding: 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
	}

	.detalle > div {
		display: grid;
		grid-template-columns: minmax(9rem, 40%) 1fr;
		gap: 0.5rem;
		font-size: 0.84rem;
	}

	.detalle dt {
		color: var(--color-muted);
	}

	.detalle dd {
		margin: 0;
		word-break: break-word;
	}

	.siguientes {
		text-align: left;
	}

	.siguientes h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		font-weight: 700;
	}

	.siguientes ol {
		margin: 0 0 1rem;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.4rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.indicacion {
		margin: 0;
		padding: 0.7rem 0.9rem;
		border-radius: 10px;
		background: var(--color-info-bg);
		color: var(--color-primary-dark);
		font-size: 0.86rem;
	}

	.siguiente {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1.6rem;
	}

	.siguiente .boton {
		justify-content: center;
		min-height: 48px;
		font-size: 0.95rem;
		text-decoration: none;
	}

	/* La acción que se repite decenas de veces al día va primero y destacada. */
	.boton--otra {
		background: var(--color-success);
	}

	.boton--otra:hover {
		background: color-mix(in srgb, var(--color-success) 82%, black);
	}

	@media (min-width: 480px) {
		.siguiente {
			grid-template-columns: 1.4fr 1fr;
		}
	}

	@media print {
		.no-imprimir {
			display: none;
		}
	}

	@media (max-width: 420px) {
		.detalle > div {
			grid-template-columns: 1fr;
			gap: 0.05rem;
		}
	}
</style>
