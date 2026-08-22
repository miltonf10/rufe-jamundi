<script lang="ts">
	// Las fichas levantadas que todavía no llegaron a la Alcaldía.
	//
	// Vive aparte del formulario a propósito. Mezcladas, la pantalla de captura
	// tenía que hacer dos trabajos —levantar una ficha nueva y vigilar las que no
	// salieron— y acababa bloqueando lo primero por culpa de lo segundo.
	//
	// Es la única pantalla del sistema que funciona sin conexión: lee de la base
	// del propio navegador, no de la API. Ahí está su razón de ser — el censador
	// necesita poder comprobar en plena vereda que no perdió el trabajo del día.

	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		CheckCircle2, CloudOff, LoaderCircle, RefreshCw, Trash2, TriangleAlert, DownloadCloud, Smartphone
	} from '@lucide/svelte';
	import { sesion } from '$lib/stores/sesion.svelte';
	import {
		borrarFicha,
		espacioDisponible,
		fichasPendientes,
		fotosDe,
		DESTINO,
		tipoDe,
		type FichaEnCola
	} from '$lib/rufe-form/cola';
	import { GestorEnvio } from '$lib/rufe-form/envio.svelte';
	import { tamanoLegible } from '$lib/rufe-form/imagen';
	import { preparacion } from '$lib/offline/estado.svelte';
	import { estaInstalada } from '$lib/offline/preparar';

	let fichas = $state<FichaEnCola[]>([]);
	let fotosPorFicha = $state<Record<string, number>>({});
	let cargando = $state(true);
	let enLinea = $state(true);
	let espacio = $state<{ usado: number; total: number } | null>(null);
	let confirmandoBorrado = $state<string | null>(null);
	let instalada = $state(true);

	const envio = new GestorEnvio();
	let detener: (() => void) | null = null;

	onMount(() => {
		enLinea = navigator.onLine;
		instalada = estaInstalada();

		// Se comprueba al entrar, no solo cuando alguien pulsa un botón: esta es la
		// pantalla que se mira antes de salir a campo, y la pregunta que trae quien
		// la abre es «¿puedo irme ya?».
		void preparacion.ejecutar();

		const conectar = () => {
			enLinea = true;
			void refrescar();
		};
		const desconectar = () => (enLinea = false);
		window.addEventListener('online', conectar);
		window.addEventListener('offline', desconectar);

		detener = envio.iniciar();
		void refrescar();

		// La cola la mueve el Service Worker por su cuenta; sin releer cada tanto,
		// la pantalla mostraría fichas que ya salieron.
		const latido = setInterval(refrescar, 5000);

		return () => {
			window.removeEventListener('online', conectar);
			window.removeEventListener('offline', desconectar);
			clearInterval(latido);
		};
	});

	onDestroy(() => detener?.());

	async function refrescar() {
		if (!browser) return;

		fichas = await fichasPendientes();

		const cuenta: Record<string, number> = {};
		for (const f of fichas) cuenta[f.envioId] = (await fotosDe(f.envioId)).length;
		fotosPorFicha = cuenta;

		espacio = await espacioDisponible();
		cargando = false;
	}

	async function intentarAhora() {
		await envio.reintentarTodo();
		await refrescar();
	}

	async function descartar(envioId: string) {
		await borrarFicha(envioId);
		confirmandoBorrado = null;
		await refrescar();
	}

	/**
	 * Convierte la clave que devuelve el servidor en algo legible.
	 *
	 * Llegan como `personas.2.numero_documento`. No se traduce contra un
	 * diccionario de etiquetas a propósito: se duplicaría el esquema y se
	 * desincronizaría en silencio. El mensaje del servidor ya es una frase
	 * completa; esto solo dice a qué parte de la ficha corresponde.
	 */
	function dondeEsta(clave: string): string {
		const partes = clave.split('.');
		const trozos: string[] = [];

		for (let i = 0; i < partes.length; i++) {
			const parte = partes[i];

			if (/^\d+$/.test(parte)) continue;

			const siguiente = partes[i + 1];
			const numero = siguiente && /^\d+$/.test(siguiente) ? ` ${Number(siguiente) + 1}` : '';
			trozos.push(parte.replace(/_/g, ' ') + numero);
		}

		const texto = trozos.join(' · ');

		return texto.charAt(0).toUpperCase() + texto.slice(1);
	}

	function cuando(ms: number): string {
		return new Date(ms).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">Fichas pendientes de enviar</h2>
	<p class="tarjeta__nota">
		Fichas levantadas en este teléfono que todavía no llegaron a la Alcaldía. Se envían solas en
		cuanto haya señal; esta pantalla funciona sin conexión.
	</p>

	{#if !enLinea}
		<p class="aviso aviso--info" role="status">
			<CloudOff size={15} aria-hidden="true" />
			Sin conexión. Las fichas están guardadas y saldrán cuando vuelva la señal.
		</p>
	{/if}

	{#if envio.sesionRequerida}
		<p class="aviso aviso--error" role="alert">
			<TriangleAlert size={15} aria-hidden="true" />
			Su sesión venció. Vuelva a iniciar sesión y las fichas se enviarán solas. No se ha perdido
			ninguna.
		</p>
	{/if}

	{#if cargando}
		<p class="cargando">
			<LoaderCircle size={18} class="girando" aria-hidden="true" />
			Leyendo lo guardado en este dispositivo…
		</p>
	{:else if fichas.length === 0}
		<p class="vacio">
			<CheckCircle2 size={26} aria-hidden="true" />
			<span>No hay nada pendiente. Todas las fichas levantadas en este teléfono ya se enviaron.</span>
		</p>
	{:else}
		<div class="acciones">
			<button type="button" class="boton" onclick={intentarAhora} disabled={!enLinea || envio.estado === 'enviando'}>
				{#if envio.estado === 'enviando'}
					<LoaderCircle size={15} class="girando" aria-hidden="true" />
					Enviando…
				{:else}
					<RefreshCw size={15} aria-hidden="true" />
					Intentar enviar ahora
				{/if}
			</button>

			{#if !envio.enSegundoPlano}
				<span class="acciones__nota">
					Este navegador no permite enviar en segundo plano: deje la aplicación abierta.
				</span>
			{/if}
		</div>

		<ul class="lista">
			{#each fichas as ficha (ficha.envioId)}
				<li class="ficha">
					<div class="ficha__cuerpo">
						<p class="ficha__direccion">{ficha.resumen.direccion}</p>
						<!-- De qué formato es. Con dos conviviendo en la misma cola, no
						     decirlo obligaría a adivinar por la dirección. -->
						<p class="ficha__tipo">{DESTINO[tipoDe(ficha)].etiqueta}</p>
						<p class="ficha__meta">
							{ficha.resumen.evento}{#if ficha.resumen.personas > 0} · {ficha.resumen.personas}
								{ficha.resumen.personas === 1 ? 'persona' : 'personas'}{/if}
							{#if fotosPorFicha[ficha.envioId] > 0}
								· {fotosPorFicha[ficha.envioId]}
								{fotosPorFicha[ficha.envioId] === 1 ? 'foto' : 'fotos'}
							{/if}
						</p>
						<p class="ficha__fecha">Levantada el {cuando(ficha.creadoEn)}</p>

						{#if ficha.error}
							<p class="ficha__error">
								<TriangleAlert size={13} aria-hidden="true" />
								{ficha.error}
							</p>

							{#if ficha.errores}
								<ul class="ficha__campos">
									{#each Object.entries(ficha.errores) as [campo, mensaje] (campo)}
										<li><strong>{dondeEsta(campo)}:</strong> {mensaje}</li>
									{/each}
								</ul>
							{/if}
						{:else if ficha.intentos > 0}
							<p class="ficha__fecha">
								{ficha.intentos === 1 ? '1 intento de envío' : `${ficha.intentos} intentos de envío`}
							</p>
						{/if}
					</div>

					<div class="ficha__acciones">
						{#if ficha.estado === 'enviando'}
							<LoaderCircle size={16} class="girando" aria-hidden="true" />
						{/if}

						{#if confirmandoBorrado === ficha.envioId}
							<button type="button" class="boton boton--peligro" onclick={() => descartar(ficha.envioId)}>
								Sí, descartar
							</button>
							<button type="button" class="boton boton--suave" onclick={() => (confirmandoBorrado = null)}>
								Cancelar
							</button>
						{:else}
							<button
								type="button"
								class="boton boton--suave"
								onclick={() => (confirmandoBorrado = ficha.envioId)}
								aria-label="Descartar la ficha de {ficha.resumen.direccion}"
							>
								<Trash2 size={14} aria-hidden="true" />
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<!-- Descartar es irreversible y no queda registro en ninguna parte: la ficha
		     nunca llegó al servidor. Por eso se pide confirmación y se dice esto. -->
		<p class="advertencia">
			Descartar una ficha borra definitivamente los datos de ese hogar. No hay forma de
			recuperarla, porque nunca llegó a la Alcaldía.
		</p>
	{/if}
</div>

<!-- Preparación para trabajar sin internet.
     Va antes de «Cómo funciona» porque no es teoría: es la respuesta a si se
     puede salir ya a la vereda o todavía falta descargar algo. -->
<div class="tarjeta">
	<h2 class="tarjeta__titulo">Trabajar sin internet</h2>

	{#if preparacion.trabajando}
		<p class="cargando">
			<LoaderCircle size={18} class="girando" aria-hidden="true" />
			Descargando lo necesario para trabajar sin señal…
		</p>
	{:else if preparacion.parte?.listo}
		<p class="aviso aviso--ok" role="status">
			<CheckCircle2 size={15} aria-hidden="true" />
			Listo para trabajar sin internet. El formulario está guardado en este teléfono.
		</p>
	{:else if preparacion.parte}
		<p class="aviso aviso--error" role="status">
			<TriangleAlert size={15} aria-hidden="true" />
			Todavía falta descargar {preparacion.parte.faltantes.join(', ')}. Con señal, pulse «Preparar
			este teléfono».
		</p>
	{:else if !enLinea}
		<p class="aviso aviso--info" role="status">
			<CloudOff size={15} aria-hidden="true" />
			Sin señal no se puede comprobar la preparación. Vuelva a abrir esta pantalla con conexión.
		</p>
	{/if}

	<ul class="explicacion">
		<li>
			El formulario, sus listas de opciones y la aplicación quedan guardados en el teléfono.
		</li>
		<li>
			Las fichas y sus fotos se guardan aquí y se envían solas al recuperar la señal.
		</li>
		<li>
			<strong>Las consultas no funcionan sin señal:</strong> el tablero, Reportes RUFE y el mapa
			leen del servidor.
		</li>
	</ul>

	{#if !instalada}
		<p class="aviso aviso--info" role="status">
			<Smartphone size={15} aria-hidden="true" />
			Instale la aplicación desde el menú lateral. Sin instalar, el teléfono puede borrar lo
			guardado —fichas incluidas— cuando le falte espacio.
		</p>
	{/if}

	<div class="acciones">
		<button
			type="button"
			class="boton"
			onclick={() => preparacion.ejecutar()}
			disabled={!enLinea || preparacion.trabajando}
		>
			<DownloadCloud size={15} aria-hidden="true" />
			Preparar este teléfono
		</button>

		{#if !enLinea}
			<span class="acciones__nota">Necesita conexión para descargar lo que falte.</span>
		{/if}
	</div>
</div>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">Cómo funciona</h2>
	<ul class="explicacion">
		<li>
			Las fichas se guardan en este teléfono en cuanto pulsa «Guardar», aunque no haya señal.
		</li>
		<li>
			Se envían solas cuando vuelve la conexión.
			{#if envio.enSegundoPlano}
				Este navegador puede hacerlo <strong>aunque cierre la aplicación</strong>.
			{/if}
		</li>
		<li>
			El número de radicado se genera cuando la ficha llega a la Alcaldía. Después aparece en
			<a href="/riesgo/reportes">Reportes RUFE</a>.
		</li>
		<li>
			<strong>No borre los datos del navegador</strong> mientras haya fichas aquí: se perderían.
		</li>
	</ul>

	{#if espacio && espacio.total > 0}
		<p class="espacio">
			Espacio usado en este dispositivo: {tamanoLegible(espacio.usado)} de
			{tamanoLegible(espacio.total)} disponibles.
		</p>
	{/if}

	{#if sesion.rol}
		<p class="espacio">Sesión activa: {sesion.usuario?.email}</p>
	{/if}
</div>

<style>
	.acciones {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.acciones__nota {
		font-size: 0.78rem;
		color: var(--color-muted);
	}

	.lista {
		list-style: none;
		margin: 0 0 0.9rem;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}

	.ficha {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
	}

	.ficha__cuerpo {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.ficha__tipo {
		display: inline-block;
		margin: 0 0 0.2rem;
		padding: 0.08rem 0.4rem;
		border-radius: 999px;
		background: var(--color-surface-alt);
		color: var(--color-muted);
		font-size: 0.7rem;
		font-weight: 600;
	}

	.ficha__direccion {
		margin: 0 0 0.15rem;
		font-size: 0.9rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.ficha__meta {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.ficha__fecha {
		margin: 0.1rem 0 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.ficha__error {
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
		flex-wrap: wrap;
		margin: 0.3rem 0 0;
		font-size: 0.75rem;
		color: var(--aviso-alerta-texto);
		overflow-wrap: anywhere;
	}

	.ficha__campos {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0.45rem 0.55rem;
		display: grid;
		gap: 0.3rem;
		border-radius: 8px;
		background: var(--color-bg);
		font-size: 0.75rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.ficha__acciones {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: 0 0 auto;
		margin-left: auto;
		flex-wrap: wrap;
	}

	.advertencia {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-muted);
	}

	.vacio {
		display: grid;
		justify-items: center;
		gap: 0.5rem;
		color: var(--color-success);
	}

	.vacio span {
		color: var(--color-muted);
		font-size: 0.9rem;
	}

	.explicacion {
		margin: 0 0 0.8rem;
		padding-left: 1.15rem;
		display: grid;
		gap: 0.4rem;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.espacio {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		color: var(--color-muted);
	}
</style>
