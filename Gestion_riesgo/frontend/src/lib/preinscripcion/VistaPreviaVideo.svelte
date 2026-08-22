<script lang="ts">
	// Un video de la solicitud, visible sin tener que pedirlo.
	//
	// Antes había un botón «Ver el video» y, hasta pulsarlo, una fila de texto.
	// Con las fotos al lado dibujándose solas, quien revisa no tenía forma de
	// saber si valía la pena: para decidir una solicitud hay que ver las dos
	// cosas, y una de ellas obligaba a un clic a ciegas por cada video.
	//
	// El fotograma que se muestra NO es el primero. Se busca medio segundo dentro
	// del video a propósito: el primero se graba con la cámara aún ajustando la
	// exposición y sale casi negro, que es justo lo que parecía un fallo cuando
	// se probó el grabador.

	import { Download, LoaderCircle, TriangleAlert, Video } from '@lucide/svelte';

	type Props = {
		nombre: string;
		segundos: number | null;
		tamanoBytes: number;
		extension: string;
		/** URL de objeto del video ya traído, o null mientras no lo esté. */
		url: string | null;
		cargando: boolean;
		error: string;
		alReintentar: () => void;
	};

	let { nombre, segundos, tamanoBytes, extension, url, cargando, error, alReintentar }: Props =
		$props();

	/** Dónde buscar el fotograma de portada, en segundos. */
	const INSTANTE_PORTADA = 0.5;

	let yaBuscado = false;

	function alCargarMetadatos(evento: Event) {
		const video = evento.currentTarget as HTMLVideoElement;

		// Una sola vez: `seeked` vuelve a disparar `loadedmetadata` en algunos
		// navegadores y el video se quedaría saltando al mismo punto sin dejar
		// reproducir.
		if (yaBuscado) return;
		yaBuscado = true;

		if (!Number.isFinite(video.duration) || video.duration <= 0) return;

		video.currentTime = Math.min(INSTANTE_PORTADA, video.duration / 4);
	}

	function peso(bytes: number): string {
		return bytes >= 1048576
			? `${(bytes / 1048576).toFixed(1)} MB`
			: `${Math.round(bytes / 1024)} KB`;
	}
</script>

<li class="video">
	<div class="video__marco">
		{#if url}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="video__reproductor"
				src={url}
				controls
				playsinline
				preload="auto"
				onloadedmetadata={alCargarMetadatos}
			></video>
		{:else if error}
			<div class="video__estado video__estado--error">
				<TriangleAlert size={20} aria-hidden="true" />
				<span>{error}</span>
				<button type="button" class="boton boton--suave" onclick={alReintentar}>
					Reintentar
				</button>
			</div>
		{:else if cargando}
			<div class="video__estado">
				<LoaderCircle size={20} class="girando" aria-hidden="true" />
				<span>Cargando el video…</span>
			</div>
		{:else}
			<!-- En espera de su turno: se traen de uno en uno para que el primero
			     se pueda ver mientras llegan los demás. -->
			<div class="video__estado">
				<Video size={20} aria-hidden="true" />
				<span>En cola</span>
			</div>
		{/if}
	</div>

	<div class="video__pie">
		<span class="video__nombre">{nombre}</span>
		<span class="video__meta">
			{#if segundos}{segundos}s · {/if}{extension.toUpperCase()} · {peso(tamanoBytes)}
		</span>
	</div>

	{#if url}
		<!--
			El archivo ya está en memoria: descargarlo no vuelve a pedirlo al
			servidor. `download` con el nombre puesto evita que salga como
			«blob:1a2b-3c4d» dentro del expediente.
		-->
		<a class="boton boton--suave video__descargar" href={url} download="{nombre}.{extension}">
			<Download size={13} aria-hidden="true" />
			Descargar
		</a>
	{/if}
</li>

<style>
	.video {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface-alt);
	}

	/* Alto fijo por proporción: sin él, la tarjeta salta de tamaño cuando el
	   video termina de llegar y la lista entera se recoloca bajo el cursor. */
	.video__marco {
		position: relative;
		aspect-ratio: 16 / 10;
		border-radius: 9px;
		overflow: hidden;
		background: #0b1526;
	}

	.video__reproductor {
		display: block;
		width: 100%;
		height: 100%;
		/* `contain` y no `cover`: recortar el video de la casa de alguien para que
		   cuadre en la tarjeta puede esconder justo la grieta que se grabó. */
		object-fit: contain;
		background: #0b1526;
	}

	.video__estado {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.8rem;
		text-align: center;
		font-size: 0.8rem;
		color: #9fb3cd;
	}

	.video__estado--error {
		color: var(--color-danger);
	}

	.video__pie {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.video__nombre {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.3;
		word-break: break-word;
	}

	.video__meta {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.video__descargar {
		justify-content: center;
		font-size: 0.78rem;
	}
</style>
