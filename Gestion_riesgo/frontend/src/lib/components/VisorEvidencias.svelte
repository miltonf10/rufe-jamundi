<script lang="ts">
	// Ver las fotos de una ficha sin descargarlas una por una.
	//
	// Hasta ahora la única forma de mirar una evidencia era bajarla al disco,
	// abrirla y borrarla. Para decidir si una vivienda quedó habitable eso son
	// tres pasos por foto, y quien valida fichas revisa decenas al día.
	//
	// Las imágenes no se pueden poner en un `src` normal: viven fuera del
	// servidor web y solo salen por un endpoint que exige el token en una
	// cabecera, algo que una etiqueta `<img>` no sabe enviar. Así que cada una se
	// trae con `fetch` y se convierte en una URL de objeto, que hay que revocar
	// después o el navegador se queda con todas las fotos en memoria.

	import { onDestroy } from 'svelte';
	import { ChevronLeft, ChevronRight, Download, LoaderCircle, TriangleAlert, X, ZoomIn } from '@lucide/svelte';
	import { inspeccionApi, preinscripcionApi, rufeApi } from '$lib/api/servicios';

	type Evidencia = {
		id: number;
		nombre_original: string;
		extension: string;
		tamano_bytes: number;
		mime?: string;
		tipo?: string;
		/** El «FOTOGRAFIA DE:» del numeral 11, solo en la inspección. */
		descripcion?: string | null;
	};

	type Props = {
		/** Ficha dueña de las fotos. Censo o inspección, según `origen`. */
		reporteId: number;
		evidencias: Evidencia[];
		/**
		 * De qué formato son. Cambia el endpoint del que salen las imágenes.
		 *
		 * Se pasa el origen y no una función de descarga porque el visor sigue
		 * haciendo lo mismo con las dos: la única diferencia está en la ruta.
		 */
		origen?: 'rufe' | 'inspeccion' | 'preinscripcion';
		/** Muestra el «FOTOGRAFIA DE:» del numeral 11 bajo cada miniatura. */
		conPie?: boolean;
	};

	let { reporteId, evidencias, origen = 'rufe', conPie = false }: Props = $props();

	const POR_ORIGEN = { rufe: rufeApi, inspeccion: inspeccionApi, preinscripcion: preinscripcionApi };
	const api = $derived(POR_ORIGEN[origen]);

	/** URL de objeto por evidencia, para no volver a pedir una imagen ya traída. */
	let urls = $state<Record<number, string>>({});
	let cargando = $state<Record<number, boolean>>({});
	let fallidas = $state<Record<number, string>>({});

	/** Índice abierto en el visor a pantalla completa, o null si está cerrado. */
	let abierta = $state<number | null>(null);

	/** Aviso de una descarga que no salió. */
	let problema = $state<string | null>(null);

	const ES_IMAGEN = /^(webp|jpe?g|png)$/i;

	const visibles = $derived(evidencias.filter((e) => ES_IMAGEN.test(e.extension)));
	const otros = $derived(evidencias.filter((e) => !ES_IMAGEN.test(e.extension)));

	const actual = $derived(abierta !== null ? visibles[abierta] : null);

	onDestroy(() => {
		for (const url of Object.values(urls)) URL.revokeObjectURL(url);
	});

	async function traer(ev: Evidencia): Promise<void> {
		if (urls[ev.id] || cargando[ev.id]) return;

		cargando = { ...cargando, [ev.id]: true };

		try {
			const url = await api.verEvidencia(reporteId, ev.id);
			urls = { ...urls, [ev.id]: url };
			fallidas = { ...fallidas, [ev.id]: '' };
		} catch {
			fallidas = { ...fallidas, [ev.id]: 'No se pudo cargar' };
		} finally {
			cargando = { ...cargando, [ev.id]: false };
		}
	}

	// Las miniaturas se traen al montar. Son las mismas imágenes optimizadas que
	// subió el censador —ninguna pasa de 900 KB—, así que no hay una versión más
	// liviana que pedir ni tiene sentido esperar a que alguien pulse.
	$effect(() => {
		for (const ev of visibles) void traer(ev);
	});

	function abrir(i: number): void {
		abierta = i;
	}

	// Con la vista abierta, la rueda del ratón movía la página de detrás: se
	// cerraba la foto y uno aparecía en otro punto de la ficha sin saber por qué.
	$effect(() => {
		if (abierta === null) return;

		const previo = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previo;
		};
	});

	function cerrar(): void {
		abierta = null;
	}

	function mover(paso: number): void {
		if (abierta === null || visibles.length === 0) return;
		// Da la vuelta: desde la última se pasa a la primera. Con tres fotos,
		// toparse con un botón muerto molesta más que dar la vuelta.
		abierta = (abierta + paso + visibles.length) % visibles.length;
	}

	function alPulsar(e: KeyboardEvent): void {
		if (abierta === null) return;

		if (e.key === 'Escape') cerrar();
		else if (e.key === 'ArrowRight') mover(1);
		else if (e.key === 'ArrowLeft') mover(-1);
		else return;

		e.preventDefault();
	}

	/**
	 * Descarga avisando si falla.
	 *
	 * Sin esto un fallo de red no produce ningún efecto visible: el usuario pulsa,
	 * no pasa nada, y no tiene forma de saber si el archivo se guardó.
	 */
	async function descargar(ev: Evidencia): Promise<void> {
		try {
			await api.descargarEvidencia(reporteId, ev.id, ev.nombre_original);
			problema = null;
		} catch {
			problema = 'No se pudo descargar el archivo. Intente de nuevo.';
		}
	}

	function tamano(bytes: number): string {
		return bytes >= 1048576
			? `${(bytes / 1048576).toFixed(1)} MB`
			: `${Math.round(bytes / 1024)} KB`;
	}

	/** Nombre corto, porque el generado por la cámara no dice nada a nadie. */
	function etiqueta(ev: Evidencia, i: number): string {
		if (ev.tipo === 'DOCUMENTO' || ev.nombre_original.startsWith('documento-')) {
			return 'Documento de identidad';
		}

		return `Foto del daño ${i + 1}`;
	}
</script>

<svelte:window onkeydown={alPulsar} />

{#if problema}
	<p class="aviso aviso--error" role="alert">
		<TriangleAlert size={15} aria-hidden="true" />
		{problema}
	</p>
{/if}

{#if visibles.length > 0}
	<ul class="galeria">
		{#each visibles as ev, i (ev.id)}
			<li class="miniatura">
				<button
					type="button"
					class="miniatura__boton"
					onclick={() => abrir(i)}
					disabled={!urls[ev.id]}
					aria-label="Ampliar {etiqueta(ev, i)}"
				>
					{#if urls[ev.id]}
						<img src={urls[ev.id]} alt={etiqueta(ev, i)} loading="lazy" />
						<span class="miniatura__lupa" aria-hidden="true"><ZoomIn size={18} /></span>
					{:else if fallidas[ev.id]}
						<span class="miniatura__estado">
							<TriangleAlert size={17} aria-hidden="true" />
							{fallidas[ev.id]}
						</span>
					{:else}
						<span class="miniatura__estado">
							<LoaderCircle size={17} class="girando" aria-hidden="true" />
						</span>
					{/if}
				</button>

				<div class="miniatura__pie">
					<span class="miniatura__nombre">{etiqueta(ev, i)}</span>
					{#if conPie}
						<!-- El pie que escribió el profesional en campo. Sin él, diez
						     fotos de grietas son indistinguibles entre sí. -->
						<span class="miniatura__descripcion">
							{ev.descripcion || 'Sin descripción'}
						</span>
					{/if}
					<span class="miniatura__peso">{ev.extension.toUpperCase()} · {tamano(ev.tamano_bytes)}</span>
				</div>

				<button
					type="button"
					class="boton boton--suave miniatura__descargar"
					onclick={() => descargar(ev)}
				>
					<Download size={13} aria-hidden="true" />
					Descargar
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if otros.length > 0}
	<ul class="otros">
		{#each otros as ev (ev.id)}
			<li>
				<span>{ev.nombre_original}</span>
				<span class="miniatura__peso">{ev.extension.toUpperCase()} · {tamano(ev.tamano_bytes)}</span>
				<button
					type="button"
					class="boton boton--suave"
					onclick={() => descargar(ev)}
				>
					<Download size={13} aria-hidden="true" />
					Descargar
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if abierta !== null && actual}
	<!-- El fondo cierra al pulsarlo; el diálogo detiene la propagación para que
	     un clic sobre la imagen no lo cierre por error. -->
	<div
		class="visor"
		role="dialog"
		aria-modal="true"
		aria-label="{etiqueta(actual, abierta)} · {abierta + 1} de {visibles.length}"
		tabindex="-1"
	>
		<button class="visor__fondo" type="button" aria-label="Cerrar la vista ampliada" onclick={cerrar}
		></button>

		<div class="visor__caja">
			<div class="visor__barra">
				<span class="visor__titulo">
					{etiqueta(actual, abierta)}
					<span class="visor__contador">{abierta + 1} de {visibles.length}</span>
				</span>

				<div class="visor__acciones">
					<button
						type="button"
						class="boton boton--suave"
						onclick={() => descargar(actual)}
					>
						<Download size={14} aria-hidden="true" />
						Descargar
					</button>
					<button type="button" class="visor__cerrar" onclick={cerrar} aria-label="Cerrar">
						<X size={20} aria-hidden="true" />
					</button>
				</div>
			</div>

			<div class="visor__imagen">
				{#if urls[actual.id]}
					<img src={urls[actual.id]} alt={etiqueta(actual, abierta)} />
				{:else}
					<span class="visor__estado">
						<LoaderCircle size={22} class="girando" aria-hidden="true" />
					</span>
				{/if}

				{#if visibles.length > 1}
					<button
						type="button"
						class="visor__flecha visor__flecha--izq"
						onclick={() => mover(-1)}
						aria-label="Imagen anterior"
					>
						<ChevronLeft size={26} aria-hidden="true" />
					</button>
					<button
						type="button"
						class="visor__flecha visor__flecha--der"
						onclick={() => mover(1)}
						aria-label="Imagen siguiente"
					>
						<ChevronRight size={26} aria-hidden="true" />
					</button>
				{/if}
			</div>

			{#if visibles.length > 1}
				<div class="visor__tiras">
					{#each visibles as ev, i (ev.id)}
						<button
							type="button"
							class="tira"
							class:tira--activa={i === abierta}
							onclick={() => abrir(i)}
							aria-label="Ver {etiqueta(ev, i)}"
							aria-current={i === abierta ? 'true' : undefined}
						>
							{#if urls[ev.id]}<img src={urls[ev.id]} alt="" />{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.galeria {
		list-style: none;
		margin: 0 0 0.6rem;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.8rem;
	}

	.miniatura {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.miniatura__boton {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		overflow: hidden;
		background: var(--color-surface-alt);
		cursor: zoom-in;
	}

	.miniatura__boton:disabled {
		cursor: default;
	}

	.miniatura__boton img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.miniatura__boton:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	.miniatura__boton:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.miniatura__lupa {
		position: absolute;
		right: 0.4rem;
		bottom: 0.4rem;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: rgb(10 25 45 / 62%);
		color: #fff;
		opacity: 0;
		transition: opacity 140ms ease;
	}

	.miniatura__boton:hover .miniatura__lupa,
	.miniatura__boton:focus-visible .miniatura__lupa {
		opacity: 1;
	}

	.miniatura__estado {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--color-muted);
	}

	.miniatura__pie {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.miniatura__nombre {
		font-size: 0.85rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.miniatura__descripcion {
		display: block;
		font-size: 0.76rem;
		line-height: 1.35;
		color: var(--color-text);
	}

	.miniatura__peso {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.miniatura__descargar {
		align-self: flex-start;
	}

	.otros {
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.otros li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	/* ── Vista ampliada ─────────────────────────────────────────────────── */

	.visor {
		position: fixed;
		inset: 0;
		/* Por encima del menú (60) y del modal (80): mientras está abierta, esta
		   vista es lo único con lo que se interactúa. */
		z-index: 90;

		/*
		 * Flex y no rejilla, por una razón concreta.
		 *
		 * Con `display: grid` la fila se dimensiona según su contenido, así que el
		 * `max-height: 100%` de la caja no tenía contra qué resolverse y no se
		 * aplicaba: la caja crecía hasta el tamaño natural de la foto, se salía de
		 * la pantalla y la imagen aparecía muy por debajo del borde inferior.
		 *
		 * En un contenedor flex de altura definida —que aquí lo es, por `inset: 0`—
		 * los porcentajes de los hijos sí se resuelven, y la caja queda acotada a
		 * la ventana.
		 */
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(0.5rem, 3vw, 2rem);
	}

	.visor__fondo {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		background: rgb(6 16 30 / 88%);
		backdrop-filter: blur(3px);
		cursor: zoom-out;
	}

	.visor__caja {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: min(1100px, 100%);
		max-height: 100%;
		min-height: 0;
	}

	.visor__barra {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
		color: #eef3f9;
	}

	.visor__titulo {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.visor__contador {
		font-size: 0.8rem;
		font-weight: 400;
		opacity: 0.72;
		font-variant-numeric: tabular-nums;
	}

	.visor__acciones {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.visor__cerrar {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 1px solid rgb(255 255 255 / 26%);
		border-radius: 9px;
		background: rgb(255 255 255 / 8%);
		color: #eef3f9;
		cursor: pointer;
	}

	.visor__cerrar:hover {
		background: rgb(255 255 255 / 16%);
	}

	.visor__imagen {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;

		/* `min-height: 0` deja que este bloque se encoja por debajo del tamaño de
		   la foto; sin él, un elemento flex nunca baja del tamaño de su contenido
		   y volvería a empujar la caja fuera de la pantalla. */
		min-height: 0;
		flex: 1 1 auto;
	}

	.visor__imagen img {
		/* Ahora el 100% se resuelve contra un alto real, así que la foto se ajusta
		   al hueco que quede entre la barra y las miniaturas, sea el que sea. */
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: 10px;
		background: #0d1a2b;
	}

	.visor__estado {
		display: grid;
		place-items: center;
		min-height: 12rem;
		color: #cfe0f2;
	}

	.visor__flecha {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border: 1px solid rgb(255 255 255 / 26%);
		border-radius: 50%;
		background: rgb(10 22 38 / 74%);
		color: #eef3f9;
		cursor: pointer;
	}

	.visor__flecha:hover {
		background: rgb(10 22 38 / 92%);
	}

	.visor__flecha--izq {
		left: 0.4rem;
	}

	.visor__flecha--der {
		right: 0.4rem;
	}

	.visor__tiras {
		flex: 0 0 auto;
		display: flex;
		gap: 0.45rem;
		justify-content: center;
		flex-wrap: wrap;
	}

	.tira {
		width: 66px;
		height: 50px;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 7px;
		overflow: hidden;
		background: rgb(255 255 255 / 10%);
		cursor: pointer;
		opacity: 0.62;
	}

	.tira img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.tira--activa,
	.tira:hover {
		opacity: 1;
		border-color: var(--color-primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.miniatura__lupa {
			transition: none;
		}
	}
</style>
