<script lang="ts">
	// Instalar el sistema como aplicación del teléfono.
	//
	// No es un adorno. Instalada, Android le concede al sistema garantías de
	// almacenamiento mucho mejores: deja de ser una pestaña más que el navegador
	// puede desalojar cuando le falte espacio, y con ella se irían las fichas
	// levantadas que aún no se han enviado. En iPhone es todavía más importante:
	// Safari desaloja la caché de los sitios NO instalados tras unos días sin
	// usarlos, y con ella se va la aplicación guardada para trabajar sin señal.
	//
	// Antes, en iPhone no se mostraba nada, porque allí no existe el evento
	// `beforeinstallprompt`. Callarse no era neutral: dejaba a esos usuarios sin
	// instalar y sin saber que les hacía falta. Ahora se explican los dos pasos.

	import { onDestroy, onMount } from 'svelte';
	import { Download, Share, Info } from '@lucide/svelte';
	import { esIOS, estaInstalada } from '$lib/offline/preparar';
	import { preparacion } from '$lib/offline/estado.svelte';

	type EventoInstalar = Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	};

	let pendiente: EventoInstalar | null = $state(null);
	let instalando = $state(false);
	let instalada = $state(true);
	let ios = $state(false);
	let comoEnIphone = $state(false);

	let alOfrecer: ((e: Event) => void) | null = null;
	let alInstalar: (() => void) | null = null;

	onMount(() => {
		instalada = estaInstalada();
		ios = esIOS();

		alOfrecer = (e: Event) => {
			// Sin esto Chrome muestra su propia barra, que en esta aplicación
			// aparece encima del formulario y estorba más de lo que ayuda.
			e.preventDefault();
			pendiente = e as EventoInstalar;
		};

		alInstalar = () => {
			pendiente = null;
			instalada = true;

			// Recién instalada es el mejor momento para dejarlo todo descargado: hay
			// señal, la persona acaba de decidir que va a usar esto en campo y aún
			// no ha salido. Esperar a la primera ficha sería esperar a la vereda.
			void preparacion.ejecutar();
		};

		window.addEventListener('beforeinstallprompt', alOfrecer);
		window.addEventListener('appinstalled', alInstalar);
	});

	onDestroy(() => {
		if (alOfrecer) window.removeEventListener('beforeinstallprompt', alOfrecer);
		if (alInstalar) window.removeEventListener('appinstalled', alInstalar);
	});

	async function instalar() {
		if (!pendiente || instalando) return;

		instalando = true;

		try {
			await pendiente.prompt();
			await pendiente.userChoice;
		} finally {
			// El evento solo sirve una vez, se acepte o no.
			pendiente = null;
			instalando = false;
		}
	}
</script>

{#if pendiente}
	<button type="button" class="boton boton--suave instalar" onclick={instalar} disabled={instalando}>
		<Download size={15} aria-hidden="true" />
		Instalar en este teléfono
	</button>
{:else if ios && !instalada}
	<button
		type="button"
		class="boton boton--suave instalar"
		onclick={() => (comoEnIphone = !comoEnIphone)}
		aria-expanded={comoEnIphone}
	>
		<Share size={15} aria-hidden="true" />
		Instalar en este iPhone
	</button>

	{#if comoEnIphone}
		<div class="instalar__ayuda">
			<p>
				Toque <strong>Compartir</strong> en la barra de Safari y luego
				<strong>Añadir a inicio</strong>.
			</p>
			<p class="instalar__ojo">
				<Info size={14} aria-hidden="true" />
				<span>
					Después <strong>inicie sesión otra vez desde el icono instalado</strong>, con señal: en
					iPhone la aplicación instalada guarda sus datos aparte de Safari.
				</span>
			</p>
		</div>
	{/if}
{/if}

<style>
	.instalar {
		width: 100%;
		justify-content: center;
	}

	.instalar__ayuda {
		margin-top: 0.4rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-surface-alt);
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--color-muted);
	}

	.instalar__ayuda p {
		margin: 0;
	}

	.instalar__ojo {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.45rem !important;
		padding-top: 0.45rem;
		border-top: 1px solid var(--color-border);
	}

	.instalar__ojo :global(svg) {
		flex: none;
		margin-top: 0.1rem;
	}
</style>
