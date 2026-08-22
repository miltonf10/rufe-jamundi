<script lang="ts">
	// Convertir las direcciones del censo en coordenadas.
	//
	// Se hace por lotes y a mano por una razón del hosting, no de diseño: aquí no
	// hay cron ni procesos en segundo plano, y OpenStreetMap solo admite una
	// consulta por segundo. Así que se procesa una decena, se vuelve a llamar, y
	// así hasta acabar. La pantalla puede encadenar las llamadas sola mientras
	// esté abierta.

	import { onDestroy, onMount } from 'svelte';
	import { LoaderCircle, MapPinned, Play, RefreshCw, Square, TriangleAlert } from '@lucide/svelte';
	import { mapaApi } from '$lib/api/servicios';
	import { ApiError } from '$lib/api/client';

	type Estado = {
		por_precision: Record<string, number>;
		pendientes: number;
		lote: number;
		google_activo: boolean;
		segundos_por_direccion: number;
	};

	let estado = $state<Estado | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let corriendo = $state(false);
	let procesadas = $state(0);
	let ubicadas = $state(0);

	let detener = false;
	let confirmandoRehacer = $state(false);
	let rehaciendo = $state(false);
	let resultadoRehacer = $state<string | null>(null);

	const ETIQUETA: Record<string, string> = {
		EXACTA: 'Ubicación exacta',
		CALLE: 'Sobre la vía',
		BARRIO: 'Aproximada del sector',
		MUNICIPIO: 'Solo llegó al municipio',
		FALLIDA: 'Sin ubicar'
	};

	const utiles = $derived(
		estado
			? (estado.por_precision.EXACTA ?? 0) +
				(estado.por_precision.CALLE ?? 0) +
				(estado.por_precision.BARRIO ?? 0)
			: 0
	);

	const minutosRestantes = $derived(
		estado ? Math.ceil((estado.pendientes * estado.segundos_por_direccion) / 60) : 0
	);

	onMount(() => void refrescar());
	onDestroy(() => {
		detener = true;
	});

	async function refrescar() {
		try {
			estado = await mapaApi.estado();
			error = null;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo leer el estado.';
		} finally {
			cargando = false;
		}
	}

	/**
	 * Vuelve a poner todas las direcciones en cola.
	 *
	 * Hace falta cuando el buscador mejora: lo ya guardado se calculó con las
	 * reglas viejas y no se recalcula solo, porque la caché existe justamente para
	 * no volver a preguntar.
	 */
	async function rehacer() {
		rehaciendo = true;
		error = null;

		try {
			const r = await mapaApi.reubicar();
			resultadoRehacer =
				`${r.reencoladas} direcciones vuelven a la cola.` +
				(r.conservadas > 0 ? ` Se conservan ${r.conservadas} corregidas a mano.` : '');
			confirmandoRehacer = false;
			await refrescar();
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudieron reencolar.';
		} finally {
			rehaciendo = false;
		}
	}

	async function procesar() {
		corriendo = true;
		detener = false;
		procesadas = 0;
		ubicadas = 0;
		error = null;

		// Se encadenan lotes hasta que no queden pendientes o el administrador
		// pare. Si cierra la pantalla, lo hecho queda guardado: cada lote se
		// escribe en la base al terminar.
		while (!detener) {
			try {
				const r = await mapaApi.geocodificar();
				procesadas += r.procesadas;
				ubicadas += r.ubicadas;
				await refrescar();

				if (r.procesadas === 0 || r.pendientes === 0) break;
			} catch (e) {
				error = e instanceof ApiError ? e.message : 'Se interrumpió la ubicación.';
				break;
			}
		}

		corriendo = false;
	}
</script>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">Ubicación de las direcciones del censo</h2>
	<p class="tarjeta__nota">
		Convierte las direcciones escritas en el censo en puntos del mapa. Cada dirección se resuelve
		una sola vez y queda guardada, así que esto solo hay que correrlo cuando entran direcciones
		nuevas.
	</p>

	{#if error}
		<p class="aviso aviso--error" role="alert">
			<TriangleAlert size={15} aria-hidden="true" />
			{error}
		</p>
	{/if}

	{#if cargando}
		<p class="cargando">
			<LoaderCircle size={18} class="girando" aria-hidden="true" />
			Leyendo el estado…
		</p>
	{:else if estado}
		<div class="resumen">
			<div class="cifra">
				<span class="cifra__valor">{utiles}</span>
				<span class="cifra__nota">ubicadas y utilizables</span>
			</div>
			<div class="cifra">
				<span class="cifra__valor">{estado.pendientes}</span>
				<span class="cifra__nota">por procesar</span>
			</div>
		</div>

		{#if confirmandoRehacer}
			<div class="aviso aviso--alerta">
				<p>
					<strong>Se vuelven a ubicar todas las direcciones desde cero.</strong> Es lo que hay que
					hacer cuando el buscador mejora: lo ya guardado se calculó con las reglas anteriores y no
					se recalcula solo.
				</p>
				<p>
					Las <strong>corregidas a mano no se tocan</strong>. Después habrá que volver a pulsar
					«Ubicar las pendientes», y tardará lo mismo que la primera vez.
				</p>
				<div class="acciones">
					<button type="button" class="boton" onclick={rehacer} disabled={rehaciendo}>
						{#if rehaciendo}
							<LoaderCircle size={15} class="girando" aria-hidden="true" />
							Reencolando…
						{:else}
							Sí, rehacer todas
						{/if}
					</button>
					<button
						type="button"
						class="boton boton--suave"
						onclick={() => (confirmandoRehacer = false)}
					>
						Cancelar
					</button>
				</div>
			</div>
		{/if}

		{#if resultadoRehacer}
			<p class="aviso aviso--ok" role="status">{resultadoRehacer}</p>
		{/if}

		<table class="tabla">
			<thead>
				<tr><th>Resultado</th><th class="num">Direcciones</th></tr>
			</thead>
			<tbody>
				{#each Object.entries(ETIQUETA) as [codigo, etiqueta] (codigo)}
					<tr>
						<td>{etiqueta}</td>
						<td class="num">{estado.por_precision[codigo] ?? 0}</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="acciones">
			{#if !corriendo && !confirmandoRehacer}
				<button
					type="button"
					class="boton boton--suave"
					onclick={() => (confirmandoRehacer = true)}
					disabled={rehaciendo}
				>
					<RefreshCw size={15} aria-hidden="true" />
					Rehacer todas
				</button>
			{/if}

			{#if corriendo}
				<button type="button" class="boton boton--suave" onclick={() => (detener = true)}>
					<Square size={15} aria-hidden="true" />
					Detener
				</button>
				<span class="progreso">
					<LoaderCircle size={15} class="girando" aria-hidden="true" />
					{procesadas} procesadas, {ubicadas} ubicadas…
				</span>
			{:else}
				<button
					type="button"
					class="boton"
					onclick={procesar}
					disabled={estado.pendientes === 0}
				>
					<Play size={15} aria-hidden="true" />
					Ubicar las pendientes
				</button>
				{#if estado.pendientes > 0}
					<span class="progreso">
						Tardará unos {minutosRestantes}
						{minutosRestantes === 1 ? 'minuto' : 'minutos'}. Deje esta pantalla abierta.
					</span>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">
		<MapPinned size={17} aria-hidden="true" />
		Cómo funciona
	</h2>
	<ul class="explicacion">
		<li>
			A cada dirección se le añade <strong>«Jamundí, Valle del Cauca»</strong> antes de
			consultarla. Sin eso, una «Carrera 11 # 8 26» existe en media Colombia.
		</li>
		<li>
			Se consulta primero <strong>OpenStreetMap</strong>, que es gratuito.
			{#if estado?.google_activo}
				Lo que falla se reintenta con <strong>Google</strong>, que está activado.
			{:else}
				Google está apagado: para encenderlo hay que poner su clave en la configuración del
				servidor.
			{/if}
		</li>
		<li>
			Va a una consulta por segundo porque es lo que permite OpenStreetMap. Por eso tarda, y por
			eso conviene dejarlo corriendo y ocuparse de otra cosa.
		</li>
		<li>
			Una dirección que solo se resuelve hasta el municipio <strong>no se pinta</strong>. Sería
			un punto válido y falso: amontonaría cientos de hogares sobre el parque principal.
		</li>
		<li>
			Las direcciones incompletas no tienen arreglo automático. Se corrigen en la hoja del censo,
			o el censador toma la ubicación exacta con el botón de ubicación del formulario.
		</li>
	</ul>
</div>

<style>
	.resumen {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.cifra {
		display: flex;
		flex-direction: column;
	}

	.cifra__valor {
		font-size: 1.8rem;
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.cifra__nota {
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.acciones {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.progreso {
		font-size: 0.83rem;
		color: var(--color-muted);
	}

	.explicacion {
		margin: 0;
		padding-left: 1.15rem;
		display: grid;
		gap: 0.45rem;
		font-size: 0.87rem;
		line-height: 1.55;
	}
</style>
