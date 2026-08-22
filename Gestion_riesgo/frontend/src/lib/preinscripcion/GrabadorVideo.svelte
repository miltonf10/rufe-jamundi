<script lang="ts">
	// Grabar un video de una categoría, verlo y subirlo.
	//
	// Lo usa alguien de pie en el patio de su casa, con una mano en el teléfono.
	// Eso manda sobre todo lo demás:
	//
	//  • La cámara se abre a pantalla completa ANTES de grabar, para que pueda
	//    encuadrar con calma. Un recuadro de cinco centímetros no sirve para
	//    apuntar a una grieta.
	//  • Cuenta regresiva de 3 antes de empezar: da tiempo a levantar el brazo y
	//    evita los primeros segundos apuntando al suelo.
	//  • Dos botones claros —iniciar y terminar—, no un interruptor que hay que
	//    adivinar.
	//  • La grabación se corta SOLA al llegar al máximo. Esperar a que la persona
	//    se acuerde de parar produce videos de dos minutos que nunca suben.
	//  • Si el navegador no sabe grabar, se dice y se sigue: quedarse sin turno
	//    por un teléfono viejo sería lo contrario de lo que esto busca.

	import { onDestroy, tick } from 'svelte';
	import {
		CheckCircle2, LoaderCircle, RotateCcw, Square, TriangleAlert, Video, X
	} from '@lucide/svelte';
	import { ErrorDeVideo, RESTRICCIONES, formatoSoportado, mimeBase, subirVideo } from './video';

	type Categoria = {
		id: number;
		nombre: string;
		instruccion: string | null;
		obligatoria: boolean;
		segundos_min: number;
		segundos_max: number;
	};

	type Props = {
		categoria: Categoria;
		carga: string | null;
		/** Se avisa al terminar para que el formulario sepa qué falta. */
		alSubir?: (categoriaId: number) => void;
		/**
		 * Se avisa mientras este video está subiendo.
		 *
		 * El formulario lo necesita para no dejar enviar a medias: un video que
		 * no terminó de subir llega al servidor incompleto, y ahí se BORRA. La
		 * persona vería «Solicitud registrada» y su video no existiría en ningún
		 * sitio, sin que nadie se lo dijera.
		 */
		alSubiendo?: (categoriaId: number, subiendo: boolean) => void;
	};

	let { categoria, carga, alSubir, alSubiendo }: Props = $props();

	type Fase = 'listo' | 'camara' | 'cuenta' | 'grabando' | 'revisando' | 'subiendo' | 'subido';

	let fase = $state<Fase>('listo');
	let error = $state('');
	let segundos = $state(0);
	let cuenta = $state(3);
	let progreso = $state(0);
	let vistaPrevia = $state<string | null>(null);
	let grabado = $state<Blob | null>(null);

	let video = $state<HTMLVideoElement | null>(null);
	let flujo: MediaStream | null = null;
	let grabadora: MediaRecorder | null = null;
	let trozos: Blob[] = [];
	let mime = '';
	let reloj: ReturnType<typeof setInterval> | null = null;

	const soportado = formatoSoportado() !== null;

	/** Mientras no llegue al mínimo, terminar dejaría un video inservible. */
	const faltanSegundos = $derived(Math.max(0, categoria.segundos_min - segundos));

	/** La cámara está abierta y ocupando la pantalla. */
	const enPantallaCompleta = $derived(
		fase === 'camara' || fase === 'cuenta' || fase === 'grabando'
	);

	onDestroy(() => cerrarTodo());

	function pararReloj() {
		if (reloj) clearInterval(reloj);
		reloj = null;
	}

	function soltarCamara() {
		flujo?.getTracks().forEach((t) => t.stop());
		flujo = null;
	}

	function cerrarTodo() {
		pararReloj();
		soltarCamara();
		if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
	}

	/** Paso 1: abrir la cámara y enseñarla, sin grabar todavía. */
	async function abrirCamara() {
		error = '';

		if (!formatoSoportado()) {
			error = 'Este teléfono no permite grabar desde el navegador. Puede continuar sin el video.';

			return;
		}

		try {
			flujo = await navigator.mediaDevices.getUserMedia(RESTRICCIONES);
		} catch {
			error =
				'No se pudo abrir la cámara. Revise que le haya dado permiso al navegador y vuelva a intentarlo.';

			return;
		}

		fase = 'camara';

		// `tick()` no es opcional: el elemento <video> solo existe en el DOM
		// cuando la fase ya cambió, y Svelte lo dibuja DESPUÉS de esta línea.
		// Asignar `srcObject` antes dejaba la pantalla en negro — ese era el
		// fallo: la cámara estaba encendida y no se veía nada.
		await tick();
		mostrarFlujo();
	}

	function mostrarFlujo() {
		if (!video || !flujo) return;

		video.srcObject = flujo;
		// `muted` evita el acople del micrófono con el altavoz, y `playsInline`
		// es lo que impide que iOS abra el video en su reproductor a pantalla
		// completa y se lleve al usuario fuera del formulario.
		video.muted = true;
		void video.play().catch(() => {
			error = 'No se pudo mostrar la cámara. Intente cerrarla y abrirla otra vez.';
		});
	}

	function cerrarCamara() {
		pararReloj();
		soltarCamara();
		segundos = 0;
		fase = 'listo';
	}

	/** Paso 2: 3, 2, 1 y a grabar. */
	function contarYGrabar() {
		if (!flujo) return;

		fase = 'cuenta';
		cuenta = 3;

		reloj = setInterval(() => {
			cuenta -= 1;

			if (cuenta <= 0) {
				pararReloj();
				empezarAGrabar();
			}
		}, 1000);
	}

	function empezarAGrabar() {
		const formato = formatoSoportado();
		if (!flujo || !formato) return;

		mime = mimeBase(formato);
		trozos = [];
		segundos = 0;

		grabadora = new MediaRecorder(flujo, { mimeType: formato, videoBitsPerSecond: 800_000 });

		grabadora.ondataavailable = (e) => {
			if (e.data.size > 0) trozos.push(e.data);
		};

		grabadora.onstop = () => {
			grabado = new Blob(trozos, { type: mime });
			if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
			vistaPrevia = URL.createObjectURL(grabado);
			pararReloj();
			soltarCamara();
			fase = 'revisando';
		};

		grabadora.start(1000);
		fase = 'grabando';

		reloj = setInterval(() => {
			segundos += 1;

			// El corte automático es lo que mantiene el archivo dentro de lo que
			// una conexión rural puede subir.
			if (segundos >= categoria.segundos_max) terminar();
		}, 1000);
	}

	function terminar() {
		if (grabadora?.state === 'recording') grabadora.stop();
		pararReloj();
	}

	function repetir() {
		grabado = null;
		if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
		vistaPrevia = null;
		segundos = 0;
		fase = 'listo';
	}

	async function subir() {
		if (!grabado || !carga) return;

		fase = 'subiendo';
		progreso = 0;
		error = '';
		alSubiendo?.(categoria.id, true);

		try {
			await subirVideo(carga, categoria.id, grabado, mime, segundos, (e) => {
				progreso = Math.round((e.subidos / e.total) * 100);
			});

			fase = 'subido';
			alSubir?.(categoria.id);
		} catch (e) {
			error =
				e instanceof ErrorDeVideo
					? e.message
					: 'No se pudo subir el video. Puede intentarlo otra vez o continuar sin él.';
			fase = 'revisando';
		} finally {
			// En `finally` y no solo en el camino bueno: si la subida falla y esto
			// no se ejecutara, el formulario se quedaría bloqueado para siempre
			// esperando un video que ya no está subiendo.
			alSubiendo?.(categoria.id, false);
		}
	}
</script>

<div class="grabador" class:grabador--listo={fase === 'subido'}>
	<div class="grabador__cabecera">
		<p class="grabador__nombre">
			{categoria.nombre}
			{#if categoria.obligatoria}<span class="marca">recomendado</span>{/if}
		</p>
		{#if fase === 'subido'}
			<span class="grabador__ok"><CheckCircle2 size={16} aria-hidden="true" /> Enviado</span>
		{/if}
	</div>

	{#if categoria.instruccion}
		<p class="grabador__instruccion">{categoria.instruccion}</p>
	{/if}

	{#if error}
		<p class="grabador__aviso" role="alert">
			<TriangleAlert size={14} aria-hidden="true" />
			{error}
		</p>
	{/if}

	{#if !soportado}
		<p class="grabador__aviso">
			<TriangleAlert size={14} aria-hidden="true" />
			Este teléfono no permite grabar desde el navegador. Puede continuar sin este video.
		</p>
	{:else if fase === 'listo'}
		<button type="button" class="boton boton--suave grabador__accion" onclick={abrirCamara}>
			<Video size={16} aria-hidden="true" />
			Abrir la cámara
		</button>
		<p class="grabador__meta">Entre {categoria.segundos_min} y {categoria.segundos_max} segundos.</p>
	{:else if fase === 'revisando'}
		{#if vistaPrevia}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video class="grabador__revision" src={vistaPrevia} controls playsinline></video>
		{/if}
		<p class="grabador__meta">
			{segundos} segundos · {grabado ? Math.round(grabado.size / 1024) : 0} KB
		</p>
		<div class="grabador__botones">
			<button type="button" class="boton boton--suave" onclick={repetir}>
				<RotateCcw size={15} aria-hidden="true" />
				Repetir
			</button>
			<button type="button" class="boton" onclick={subir} disabled={!carga}>Enviar este video</button>
		</div>
	{:else if fase === 'subiendo'}
		<div class="grabador__contador" role="status" aria-live="polite">
			<LoaderCircle size={15} class="girando" aria-hidden="true" />
			Enviando… {progreso}%
		</div>
		<div
			class="grabador__barra"
			role="progressbar"
			aria-valuenow={progreso}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<span style="width: {progreso}%"></span>
		</div>
	{:else if fase === 'subido'}
		<div class="grabador__botones">
			<button type="button" class="boton boton--suave" onclick={repetir}>
				<RotateCcw size={15} aria-hidden="true" />
				Grabar otro
			</button>
		</div>
	{/if}
</div>

<!--
	La cámara ocupa la pantalla entera. Encuadrar una grieta o un techo hundido en
	un recuadro pequeño no funciona, y el video que sale de ahí tampoco.
-->
{#if enPantallaCompleta}
	<div class="camara" role="dialog" aria-modal="true" aria-label="Grabar {categoria.nombre}">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video class="camara__vista" bind:this={video} muted playsinline autoplay></video>

		<div class="camara__arriba">
			<p class="camara__titulo">{categoria.nombre}</p>
			{#if fase === 'camara'}
				<button type="button" class="camara__cerrar" onclick={cerrarCamara} aria-label="Cerrar la cámara">
					<X size={20} aria-hidden="true" />
				</button>
			{/if}
		</div>

		{#if categoria.instruccion && fase === 'camara'}
			<p class="camara__instruccion">{categoria.instruccion}</p>
		{/if}

		{#if fase === 'cuenta'}
			<!-- La cuenta regresiva da tiempo a levantar el brazo y apuntar. Sin
			     ella, los primeros segundos son siempre el suelo. -->
			<div class="camara__cuenta" role="status" aria-live="assertive">{cuenta}</div>
		{/if}

		{#if fase === 'grabando'}
			<div class="camara__estado" role="status" aria-live="polite">
				<span class="camara__punto" aria-hidden="true"></span>
				{segundos}s de {categoria.segundos_max}s
				{#if faltanSegundos > 0}· faltan {faltanSegundos}s{/if}
			</div>
		{/if}

		<div class="camara__abajo">
			{#if fase === 'camara'}
				<p class="camara__ayuda">Encuadre lo que quiere mostrar y luego inicie la grabación.</p>
				<button type="button" class="boton camara__accion" onclick={contarYGrabar}>
					<Video size={18} aria-hidden="true" />
					Iniciar grabación
				</button>
			{:else if fase === 'cuenta'}
				<p class="camara__ayuda">Prepárese…</p>
			{:else}
				<button
					type="button"
					class="boton camara__accion camara__accion--detener"
					onclick={terminar}
					disabled={faltanSegundos > 0}
				>
					<Square size={17} aria-hidden="true" />
					{faltanSegundos > 0 ? `Espere ${faltanSegundos}s…` : 'Terminar grabación'}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.grabador {
		padding: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		background: var(--color-surface);
	}

	.grabador + :global(.grabador) {
		margin-top: 0.7rem;
	}

	.grabador--listo {
		border-color: var(--color-success);
	}

	.grabador__cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.grabador__nombre {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
	}

	.marca {
		padding: 0.05rem 0.4rem;
		border: 1px solid var(--color-primary);
		border-radius: 999px;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-primary-dark);
	}

	.grabador__ok {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-success);
	}

	.grabador__instruccion {
		margin: 0.3rem 0 0.6rem;
		font-size: 0.83rem;
		line-height: 1.45;
		color: var(--color-muted);
	}

	.grabador__aviso {
		display: flex;
		align-items: flex-start;
		gap: 0.35rem;
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		line-height: 1.4;
		color: var(--aviso-alerta-texto);
	}

	.grabador__accion {
		width: 100%;
		justify-content: center;
		min-height: 2.8rem;
	}

	.grabador__revision {
		width: 100%;
		max-height: 60vh;
		border-radius: 0.5rem;
		background: #000;
	}

	.grabador__contador {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.5rem 0;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.grabador__meta {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: var(--color-muted);
	}

	.grabador__botones {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.grabador__botones .boton {
		flex: 1;
		justify-content: center;
	}

	.grabador__barra {
		height: 0.4rem;
		border-radius: 999px;
		background: var(--color-border);
		overflow: hidden;
	}

	.grabador__barra span {
		display: block;
		height: 100%;
		background: var(--color-primary);
	}

	/* ── La cámara a pantalla completa ────────────────────────────────────── */

	.camara {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: #000;
		display: flex;
		flex-direction: column;
	}

	.camara__vista {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* `cover` para que no queden franjas negras: la cámara del teléfono y la
		   pantalla casi nunca tienen la misma proporción. */
		object-fit: cover;
	}

	.camara__arriba {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: max(0.8rem, env(safe-area-inset-top)) 0.9rem 0.8rem;
		background: linear-gradient(to bottom, rgb(0 0 0 / 65%), transparent);
		color: #fff;
	}

	.camara__titulo {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
	}

	.camara__cerrar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 18%);
		color: #fff;
		cursor: pointer;
	}

	.camara__instruccion {
		position: relative;
		margin: 0 0.9rem;
		padding: 0.6rem 0.75rem;
		border-radius: 0.5rem;
		background: rgb(0 0 0 / 55%);
		color: #fff;
		font-size: 0.85rem;
		line-height: 1.45;
	}

	.camara__cuenta {
		position: relative;
		margin: auto;
		font-size: 6rem;
		font-weight: 700;
		color: #fff;
		text-shadow: 0 2px 20px rgb(0 0 0 / 80%);
		font-variant-numeric: tabular-nums;
	}

	.camara__estado {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		margin: 0.6rem auto 0;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 60%);
		color: #fff;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}

	.camara__punto {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		background: #ef4444;
		animation: latido 1s ease-in-out infinite;
	}

	@keyframes latido {
		50% {
			opacity: 0.2;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.camara__punto {
			animation: none;
		}
	}

	.camara__abajo {
		position: relative;
		margin-top: auto;
		padding: 1rem 0.9rem max(1.2rem, env(safe-area-inset-bottom));
		background: linear-gradient(to top, rgb(0 0 0 / 75%), transparent);
		text-align: center;
	}

	.camara__ayuda {
		margin: 0 0 0.7rem;
		font-size: 0.85rem;
		color: #fff;
		text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
	}

	.camara__accion {
		width: 100%;
		justify-content: center;
		min-height: 3.2rem;
		font-size: 1rem;
	}

	.camara__accion--detener {
		background: #ef4444;
		border-color: #ef4444;
	}

	.camara__accion--detener:disabled {
		background: rgb(255 255 255 / 25%);
		border-color: transparent;
		color: #fff;
	}
</style>
