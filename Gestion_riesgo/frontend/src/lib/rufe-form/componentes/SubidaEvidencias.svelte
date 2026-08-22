<script lang="ts">
	// Una zona de carga por tipo de evidencia. Campo añadido: el formato de papel
	// no contempla evidencias.
	//
	// Hay dos botones y no uno porque son dos gestos distintos: "Tomar foto" abre
	// la cámara (atributo `capture`) y "Elegir archivo" abre la galería. Con un
	// solo control se pierde uno de los dos — `capture` en un input impide llegar
	// a las fotos ya tomadas, que es justo lo que necesita quien fotografió el
	// daño antes de sentarse a llenar el formulario.

	import {
		Camera, ImageOff, ImagePlus, LoaderCircle, RotateCcw, TriangleAlert, Trash2
	} from '@lucide/svelte';
	import type { GestorEvidencias } from '../evidencias.svelte';
	import { tamanoLegible } from '../evidencias.svelte';
	import type { TipoEvidencia } from '../tipos';

	type Props = {
		gestor: GestorEvidencias;
		tipo: TipoEvidencia;
		titulo: string;
		ayuda: string;
		textoCamara: string;
		/**
		 * Pie de foto por imagen: el «FOTOGRAFIA DE:» del numeral 11 de la
		 * inspección. En el censo no existe y no se dibuja.
		 */
		pieDeFoto?: { etiqueta: string; marcador: string; maximo: number };
	};

	let { gestor, tipo, titulo, ayuda, textoCamara, pieDeFoto }: Props = $props();

	let entradaCamara = $state<HTMLInputElement | null>(null);
	let entradaArchivo = $state<HTMLInputElement | null>(null);
	let arrastrando = $state(false);

	// Cualquier imagen: la foto se convierte a WebP en el teléfono antes de
	// subirse, así que lo que acepta el servidor no limita lo que puede elegirse
	// aquí. Un HEIC de iPhone entra por este camino y sale convertido.
	const accept = 'image/*';
	const mios = $derived(gestor.archivosDe(tipo));
	const limite = $derived(gestor.limiteDe(tipo));
	const lleno = $derived(mios.length >= limite);
	const varios = $derived(limite > 1);

	async function alElegir(evento: Event) {
		const input = evento.currentTarget as HTMLInputElement;
		if (input.files?.length) await gestor.agregar(input.files, tipo);

		// Se limpia para que elegir dos veces el mismo archivo vuelva a disparar
		// el evento change.
		input.value = '';
	}

	/**
	 * Cómo se nombra una foto en la lista.
	 *
	 * No se usa el nombre del archivo: la cámara de Android pone una marca de
	 * tiempo de treinta dígitos que no significa nada para quien está en campo y
	 * es, además, la cadena más larga de la fila. Se prefiere la posición, que es
	 * lo que el técnico usa para referirse a ellas («quite la segunda»).
	 */
	function etiquetaDe(archivo: { uid: string }): string {
		const i = mios.findIndex((a) => a.uid === archivo.uid);

		return tipo === 'DOCUMENTO' ? 'Documento de identidad' : `Foto ${i + 1}`;
	}

	async function alSoltar(evento: DragEvent) {
		evento.preventDefault();
		arrastrando = false;
		if (evento.dataTransfer?.files.length) await gestor.agregar(evento.dataTransfer.files, tipo);
	}
</script>

<section class="zona-evidencia">
	<h3 class="titulo">
		{titulo}
		<span class="cupo">{mios.length} de {limite}</span>
	</h3>
	<p class="ayuda">{ayuda}</p>

	{#if !lleno}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="zona"
			class:zona--activa={arrastrando}
			ondragover={(e) => {
				e.preventDefault();
				arrastrando = true;
			}}
			ondragleave={() => (arrastrando = false)}
			ondrop={alSoltar}
		>
			<div class="zona__acciones">
				<button type="button" class="boton" onclick={() => entradaCamara?.click()}>
					<Camera size={17} aria-hidden="true" />
					{textoCamara}
				</button>

				<button type="button" class="boton boton--suave" onclick={() => entradaArchivo?.click()}>
					<ImagePlus size={17} aria-hidden="true" />
					Elegir archivo
				</button>
			</div>

			<p class="zona__pista">
				También puede arrastrar {varios ? 'las fotos' : 'la foto'} aquí. Se optimizan en el
				teléfono antes de enviarse: no importa que la cámara las tome muy pesadas.
			</p>

			<!-- Dos inputs sobre el mismo destino: uno fuerza la cámara, el otro no. -->
			<input
				bind:this={entradaCamara}
				id="camara-{tipo}"
				class="entrada"
				type="file"
				accept="image/*"
				capture="environment"
				multiple={varios}
				onchange={alElegir}
			/>
			<label class="entrada" for="camara-{tipo}">{textoCamara}</label>

			<input
				bind:this={entradaArchivo}
				id="archivo-{tipo}"
				class="entrada"
				type="file"
				{accept}
				multiple={varios}
				onchange={alElegir}
			/>
			<label class="entrada" for="archivo-{tipo}">Elegir archivo</label>
		</div>
	{/if}

	{#if mios.length > 0}
		<ul class="archivos">
			{#each mios as archivo (archivo.uid)}
				<li class="archivo" class:archivo--error={archivo.estado === 'error'}>
					<span class="archivo__vista" aria-hidden="true">
						{#if archivo.vistaPrevia}
							<img src={archivo.vistaPrevia} alt="" />
						{:else}
							<ImageOff size={18} />
						{/if}
					</span>

					<span class="archivo__datos">
						<span class="archivo__nombre">{etiquetaDe(archivo)}</span>

						<span class="archivo__meta">
							{#if archivo.estado === 'optimizando'}
								Optimizando foto… {archivo.progreso}%
							{:else}
								{tamanoLegible(archivo.tamano)}
								{#if archivo.estado === 'subiendo'} · subiendo {archivo.progreso}%{/if}
								{#if archivo.estado === 'listo'} · guardada{/if}
								{#if archivo.estado === 'pendiente'} · lista para enviar{/if}
							{/if}
						</span>

						<!-- Lo que se ganó al optimizar. Se muestra porque en campo importa:
						     explica por qué una foto de 8 MB no tarda una eternidad en subir. -->
						{#if archivo.metricas && archivo.estado !== 'optimizando'}
							<span class="archivo__ahorro">
								Original: {tamanoLegible(archivo.metricas.bytesOriginal)} · Optimizada:
								{tamanoLegible(archivo.metricas.bytesOptimizada)}
								{#if archivo.metricas.reduccion > 0}
									· <strong>{archivo.metricas.reduccion} % menos</strong>
								{/if}
							</span>
						{/if}

						{#if archivo.estado === 'optimizando' || archivo.estado === 'subiendo'}
							<span
								class="archivo__barra"
								role="progressbar"
								aria-valuenow={archivo.progreso}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label={archivo.estado === 'optimizando'
									? `Optimizando ${archivo.nombre}`
									: `Subiendo ${archivo.nombre}`}
							>
								<span class="archivo__avance" style="width: {archivo.progreso}%"></span>
							</span>
						{/if}

						{#if archivo.estado === 'error'}
							<span class="archivo__error" class:archivo__error--leve={archivo.reintentable}>
								<TriangleAlert size={13} aria-hidden="true" />
								{archivo.error}
							</span>
						{/if}

						{#if pieDeFoto}
							<!--
								El pie se escribe después de disparar, no antes: en campo se
								fotografía primero y se describe cuando ya se tienen todas. Por
								eso es un campo por foto y no una pregunta previa.
							-->
							<label class="pie">
								<span class="pie__etiqueta">{pieDeFoto.etiqueta}</span>
								<input
									class="pie__campo"
									type="text"
									maxlength={pieDeFoto.maximo}
									placeholder={pieDeFoto.marcador}
									value={archivo.descripcion ?? ''}
									onchange={(e) =>
										gestor.describir(archivo.uid, (e.currentTarget as HTMLInputElement).value)}
								/>
							</label>
						{/if}
					</span>

					<span class="archivo__acciones">
						{#if archivo.estado === 'subiendo' || archivo.estado === 'optimizando'}
							<LoaderCircle size={16} class="girando" aria-hidden="true" />
						{:else if archivo.estado === 'error' && !archivo.reintentable}
							<button
								type="button"
								class="boton boton--suave"
								onclick={() => gestor.reintentar(archivo.uid)}
							>
								<RotateCcw size={14} aria-hidden="true" />
								Reintentar
							</button>
						{/if}

						<button
							type="button"
							class="boton boton--peligro"
							onclick={() => gestor.quitar(archivo.uid)}
							aria-label="Quitar {archivo.nombre}"
						>
							<Trash2 size={14} aria-hidden="true" />
						</button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.zona-evidencia {
		display: grid;
		gap: 0.55rem;
		margin-bottom: 1.4rem;
		/* Una columna de rejilla se dimensiona por el contenido más ancho que
		   contenga. Sin esto, cualquier hijo difícil de partir arrastra toda la
		   sección —y con ella la página— más allá del borde de la pantalla. */
		grid-template-columns: minmax(0, 1fr);
	}

	.titulo {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
	}

	.cupo {
		font-size: 0.76rem;
		font-weight: 400;
		color: var(--color-muted);
	}

	.ayuda {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted);
		line-height: 1.45;
	}

	.zona {
		display: grid;
		gap: 0.55rem;
		padding: 1rem;
		border: 2px dashed var(--color-border-strong);
		border-radius: 12px;
		background: var(--color-surface-alt);
		text-align: center;
	}

	.zona--activa {
		border-color: var(--color-primary);
		background: var(--color-info-bg);
	}

	.zona__acciones {
		display: grid;
		gap: 0.5rem;
	}

	.zona__acciones :global(.boton) {
		justify-content: center;
		min-height: 46px;
		min-width: 0;
		/* «Tomar foto de la cédula» no cabe de una línea en 360 px. */
		white-space: normal;
		text-align: center;
	}

	@media (min-width: 420px) {
		.zona__acciones {
			grid-template-columns: 1fr 1fr;
		}
	}

	.zona__pista {
		margin: 0;
		font-size: 0.74rem;
		color: var(--color-muted);
	}

	/* Los controles reales se ocultan visualmente pero siguen en el árbol de
	   accesibilidad: con display:none el teclado y el lector de pantalla no
	   llegarían a ellos. */
	.entrada {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.archivos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.archivo {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
		/* Sin esto, en un teléfono angosto el ancho mínimo de la miniatura más los
		   botones empuja la fila fuera de la pantalla y se lleva por delante el
		   resto de la página. */
		flex-wrap: wrap;
		min-width: 0;
	}

	.archivo--error {
		border-color: var(--color-danger);
		border-width: 2px;
	}

	.archivo__vista {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		flex: none;
		border-radius: 8px;
		overflow: hidden;
		background: var(--color-surface-alt);
		color: var(--color-muted);
	}

	.archivo__vista img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.archivo__datos {
		flex: 1 1 8rem;
		min-width: 0;
	}

	.archivo__nombre {
		display: block;
		font-size: 0.84rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.archivo__meta,
	.archivo__ahorro,
	.archivo__error {
		/* Los textos largos parten donde sea antes que ensanchar la fila. */
		overflow-wrap: anywhere;
		min-width: 0;
	}

	.archivo__meta {
		display: block;
		font-size: 0.74rem;
		color: var(--color-muted);
	}

	.archivo__ahorro {
		display: block;
		margin-top: 0.15rem;
		font-size: 0.72rem;
		color: var(--color-success);
	}

	.archivo__barra {
		display: block;
		height: 4px;
		margin-top: 0.3rem;
		border-radius: var(--radius-full);
		background: var(--color-surface-alt);
		overflow: hidden;
	}

	.archivo__avance {
		display: block;
		height: 100%;
		background: var(--color-primary);
	}

	.archivo__error {
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
		flex-wrap: wrap;
		margin-top: 0.2rem;
		font-size: 0.74rem;
		color: var(--color-danger);
	}

	/* Un fallo de red no es culpa de nadie y se resuelve solo: se dice en tono
	   neutro para no alarmar a quien simplemente está sin cobertura. */
	.archivo__error--leve {
		color: var(--color-warning);
	}

	.pie {
		display: block;
		margin-top: 0.45rem;
	}

	.pie__etiqueta {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--color-muted);
	}

	.pie__campo {
		width: 100%;
		margin-top: 0.15rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 0.4rem;
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 0.82rem;
	}

	.archivo__acciones {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: 0 0 auto;
		margin-left: auto;
	}
</style>
