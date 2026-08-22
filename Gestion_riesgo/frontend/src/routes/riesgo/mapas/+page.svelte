<script lang="ts">
	// Dónde se concentra la afectación del sismo.
	//
	// Dos capas sobre el mismo mapa: la mancha de calor, para ver de un vistazo
	// qué zonas concentran más gente afectada, y los predios uno a uno con su
	// color según cómo quedó el inmueble.
	//
	// Lo que más condiciona esta pantalla no es el dibujo sino lo que NO se puede
	// dibujar. Las direcciones del censo vienen desordenadas —la nota de los
	// planos que ya imprimió la Alcaldía lo dice— y una parte no se puede ubicar.
	// Por eso el contador de hogares sin ubicar está siempre a la vista: un mapa
	// que calla lo que ignora es un mapa que engaña, y este se usa para decidir a
	// dónde va la ayuda.

	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { LoaderCircle, MapPin, Flame, TriangleAlert, RefreshCw } from '@lucide/svelte';
	import { fetchLiveDataset } from '$lib/rufe/live';
	import type { Dataset, Hogar } from '$lib/rufe/types';
	import { mapaApi } from '$lib/api/servicios';
	import { ApiError } from '$lib/api/client';
	import {
		CENTRO_JAMUNDI,
		COLOR_ESTADO,
		calorDe,
		colorDe,
		direccionesDe,
		puntosDe,
		puntosDeFichas,
		type FichaMapa,
		type PuntoHogar,
		type Ubicacion
	} from '$lib/mapa/datos';

	let contenedor = $state<HTMLDivElement | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let paso = $state('Leyendo el censo…');

	let datos = $state<Dataset | null>(null);
	let puntos = $state<PuntoHogar[]>([]);
	let sinUbicar = $state<(Hogar | FichaMapa)[]>([]);
	let delSistema = $state(0);
	/** Fuentes que no se pudieron leer, para decirlo en vez de callarlo. */
	let problemas = $state<string[]>([]);

	let verCalor = $state(true);
	let verPredios = $state(true);
	let zona = $state<'todas' | 'Urbana' | 'Rural'>('todas');
	let estado = $state('todos');

	// Leaflet no se puede tipar aquí sin importarlo, y se importa dinámicamente
	// para no cargarlo en las demás pantallas.
	/* eslint-disable @typescript-eslint/no-explicit-any */
	let L: any = null;
	let mapa: any = null;
	let capaCalor: any = null;
	let capaPredios: any = null;
	let observador: ResizeObserver | null = null;

	const visibles = $derived(
		puntos.filter(
			(p) =>
				(zona === 'todas' || p.zona === zona) && (estado === 'todos' || p.estadoBien === estado)
		)
	);

	const personasVisibles = $derived(visibles.reduce((n, p) => n + p.personas, 0));
	const conGps = $derived(visibles.filter((p) => p.ubicadoPor === 'gps').length);
	const porSector = $derived(visibles.filter((p) => p.ubicadoPor === 'sector').length);
	const estados = $derived([...new Set(puntos.map((p) => p.estadoBien))].sort());

	onMount(() => {
		void arrancar();
	});

	onDestroy(() => {
		// Sin desconectar el observador y destruir el mapa, cada visita a esta
		// pantalla dejaría atrás un mapa vivo escuchando eventos.
		observador?.disconnect();
		observador = null;
		mapa?.remove();
		mapa = null;
	});

	async function arrancar() {
		try {
			paso = 'Leyendo el censo y las fichas…';

			// Las dos fuentes van por separado y NINGUNA puede tumbar a la otra.
			// Antes iban en un Promise.all: si la lectura de las hojas de Google
			// fallaba —van por internet, a veces tardan o responden mal— se caía el
			// mapa entero, incluidas las fichas del sistema que sí estaban bien.
			//
			// Y si algo falla se dice cuál: callarlo dejaba un mapa vacío sin
			// ninguna pista de por qué.
			const [resCenso, resFichas] = await Promise.allSettled([
				fetchLiveDataset(),
				mapaApi.fichas()
			]);

			const avisos: string[] = [];

			let hogares: Hogar[] = [];
			if (resCenso.status === 'fulfilled') {
				datos = resCenso.value;
				hogares = resCenso.value.hogares;
			} else {
				avisos.push('No se pudo leer el censo de las hojas de cálculo.');
			}

			let fichas: FichaMapa[] = [];
			if (resFichas.status === 'fulfilled') {
				fichas = resFichas.value.fichas;
			} else {
				avisos.push('No se pudieron leer las fichas registradas en el sistema.');
			}

			problemas = avisos;

			if (hogares.length === 0 && fichas.length === 0 && avisos.length > 0) {
				throw new Error(avisos.join(' '));
			}

			paso = 'Ubicando las direcciones…';
			const direcciones = direccionesDe(hogares, fichas);

			let ubicaciones: Record<string, Ubicacion> = {};
			if (direcciones.length > 0) {
				const respuesta = await mapaApi.ubicaciones(direcciones);
				ubicaciones = respuesta.ubicaciones;
			}

			const delCenso = puntosDe(hogares, ubicaciones);
			const deFichas = puntosDeFichas(fichas, ubicaciones);

			puntos = [...delCenso.puntos, ...deFichas.puntos];
			sinUbicar = [...delCenso.sinUbicar, ...deFichas.sinUbicar];
			delSistema = deFichas.puntos.length;

			paso = 'Dibujando el mapa…';
			await dibujar();
			cargando = false;
		} catch (e) {
			error =
				e instanceof ApiError
					? e.message
					: e instanceof Error
						? e.message
						: 'No se pudo cargar el mapa.';
			cargando = false;
		}
	}

	async function dibujar() {
		if (!browser || !contenedor) return;

		// Guarda contra una segunda inicialización. Leaflet lanza «Map container is
		// already initialized» y deja el contenedor inservible, así que más vale no
		// llegar ahí.
		if (mapa) return;

		const leaflet = await import('leaflet');
		await import('leaflet/dist/leaflet.css');
		await import('leaflet.heat');
		L = leaflet.default ?? leaflet;

		mapa = L.map(contenedor, {
			center: CENTRO_JAMUNDI,
			zoom: 13,
			// El lienzo aguanta mucho mejor cientos de marcadores en un teléfono
			// modesto que el mismo número de elementos del documento.
			preferCanvas: true,
			scrollWheelZoom: false
		});

		// Se acerca con la rueda solo tras hacer clic: si no, desplazarse por la
		// página con el ratón encima del mapa lo hace saltar de escala sin querer.
		mapa.on('click', () => mapa.scrollWheelZoom.enable());
		mapa.on('mouseout', () => mapa.scrollWheelZoom.disable());

		// El fondo va siempre claro, aunque el sistema esté en tema oscuro: sobre
		// negro las calles y los nombres se perdían, y la mancha de calor —naranja
		// y roja— no tenía contra qué contrastar.
		//
		// Se usa «Voyager» y no el «Positron» de antes. Positron está pensado para
		// desaparecer bajo los datos: todo gris, sin jerarquía de vías. Aquí el
		// fondo tiene que hacer trabajo propio, porque quien mira el mapa necesita
		// reconocer por dónde va la vía principal y dónde está el río para saber
		// qué barrio es el de la mancha. Voyager trae esa jerarquía, agua en azul y
		// zonas verdes, como el plano que ya imprimió la Alcaldía. Es del mismo
		// proveedor, así que sigue sin necesitar clave ni cuenta.
		L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
			maxZoom: 20,
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
		}).addTo(mapa);

		// La escala es lo que convierte una mancha en una magnitud: sin ella no se
		// sabe si el foco abarca una manzana o media vereda. El plano impreso la
		// lleva, y quien compare los dos necesita la misma referencia.
		L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);

		refrescarCapas();
		encuadrar();

		// Leaflet calcula la posición de cada teja y de cada marcador a partir del
		// tamaño que tenía el contenedor al crearse. Si ese tamaño cambia después
		// —al cargar la tipografía, al aparecer un aviso encima, al girar el
		// teléfono— todo queda desplazado respecto al fondo: los puntos aparecen
		// corridos de donde deberían estar.
		//
		// `invalidateSize` le hace recalcular. Se llama tras ceder el hilo, cuando
		// el navegador ya asentó la maquetación.
		requestAnimationFrame(() => mapa?.invalidateSize());

		// Y lo mismo cada vez que el contenedor cambie de tamaño mientras se usa.
		observador = new ResizeObserver(() => mapa?.invalidateSize());
		observador.observe(contenedor);
	}

	function refrescarCapas() {
		if (!mapa || !L) return;

		capaCalor?.remove();
		capaPredios?.remove();

		if (verCalor && visibles.length > 0) {
			capaCalor = (L as any).heatLayer(calorDe(visibles), {
				radius: 26,
				blur: 20,
				maxZoom: 16,
				minOpacity: 0.3,
				// El degradado de fábrica arranca en azul, que sobre este fondo se
				// confunde con el río y con las zonas de agua. Se sustituye por uno
				// que solo recorre los cálidos: así la mancha nunca se puede leer
				// como un accidente geográfico.
				gradient: {
					0.2: '#ffd166',
					0.45: '#f7a440',
					0.7: '#ef6c3a',
					1.0: '#c62d1f'
				}
			}).addTo(mapa);
		}

		if (verPredios) {
			capaPredios = L.layerGroup(
				visibles.map((p) =>
					L.circleMarker([p.lat, p.lon], {
						radius: 7,
						// Anillo blanco grueso: separa un predio de otro cuando se
						// amontonan y despega el punto de un fondo que ahora tiene
						// color propio. Es lo mismo que hacen los alfileres del plano
						// impreso.
						color: '#ffffff',
						weight: 2,
						fillColor: colorDe(p.estadoBien),
						fillOpacity: 1
					}).bindPopup(popup(p))
				)
			).addTo(mapa);
		}
	}

	function popup(p: PuntoHogar): string {
		const escapar = (t: string) =>
			t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

		// Cómo se ubicó se dice siempre. No es lo mismo el GPS que tomó el censador
		// delante de la casa que el centro de una vereda: ambos sirven para ver
		// dónde se concentra la afectación, pero solo el primero sirve para ir a
		// buscar el predio, y quien mire el mapa tiene que poder distinguirlo.
		const comoSeUbico = {
			gps: 'ubicación tomada en campo con GPS',
			direccion: 'ubicado por la dirección escrita',
			sector: 'ubicación aproximada del sector, no del predio'
		}[p.ubicadoPor];

		const fuente =
			p.origen === 'sistema'
				? `Ficha ${escapar(p.hogar)} · registrada en el sistema`
				: 'Censo en papel digitalizado';

		return `<strong>${escapar(p.direccion)}</strong><br>
			${escapar(p.barrio)} · ${escapar(p.zona)}<br>
			${p.personas} ${p.personas === 1 ? 'persona' : 'personas'} · ${escapar(p.estadoBien)}<br>
			<span style="opacity:.7">${fuente} · ${comoSeUbico}</span>`;
	}

	function encuadrar() {
		if (!mapa || !L || visibles.length === 0) return;
		mapa.fitBounds(
			L.latLngBounds(visibles.map((p) => [p.lat, p.lon])),
			{ padding: [30, 30], maxZoom: 16 }
		);
	}

	// Al cambiar un filtro se redibuja; el encuadre no se toca para no marear a
	// quien está mirando una zona concreta.
	$effect(() => {
		void visibles;
		void verCalor;
		void verPredios;
		if (mapa) refrescarCapas();
	});
</script>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">Mapa de la afectación</h2>
	<p class="tarjeta__nota">
		Dónde se concentran los hogares afectados por el sismo del 10 de agosto de 2026. Las
		ubicaciones salen de las direcciones del censo y de la ubicación que toma el censador en
		campo.
	</p>

	{#if error}
		<p class="aviso aviso--error" role="alert">
			<TriangleAlert size={15} aria-hidden="true" />
			{error}
		</p>
	{/if}

	{#each problemas as aviso (aviso)}
		<p class="aviso aviso--alerta" role="status">
			<TriangleAlert size={15} aria-hidden="true" />
			{aviso}
		</p>
	{/each}

	{#if cargando}
		<p class="cargando">
			<LoaderCircle size={18} class="girando" aria-hidden="true" />
			{paso}
		</p>
	{:else}
		<div class="controles">
			<!-- Las dos casillas van dentro de un grupo con su propio rótulo. Sueltas
			     no tenían etiqueta encima, así que en una fila alineada por abajo
			     quedaban descolgadas respecto a «Zona» y «Estado del bien». -->
			<fieldset class="capas">
				<legend class="campo__etiqueta">Capas</legend>
				<div class="capas__opciones">
					<label class="interruptor">
						<input type="checkbox" bind:checked={verCalor} />
						<Flame size={15} aria-hidden="true" />
						Zonas de calor
					</label>

					<label class="interruptor">
						<input type="checkbox" bind:checked={verPredios} />
						<MapPin size={15} aria-hidden="true" />
						Predios
					</label>
				</div>
			</fieldset>

			<div class="campo campo--linea">
				<label class="campo__etiqueta" for="mapa-zona">Zona</label>
				<select id="mapa-zona" class="campo__control" bind:value={zona}>
					<option value="todas">Urbano y rural</option>
					<option value="Urbana">Urbana</option>
					<option value="Rural">Rural</option>
				</select>
			</div>

			<div class="campo campo--linea">
				<label class="campo__etiqueta" for="mapa-estado">Estado del bien</label>
				<select id="mapa-estado" class="campo__control" bind:value={estado}>
					<option value="todos">Todos</option>
					{#each estados as e (e)}<option value={e}>{e}</option>{/each}
				</select>
			</div>

			<button type="button" class="boton boton--suave" onclick={encuadrar}>
				<RefreshCw size={14} aria-hidden="true" />
				Encuadrar
			</button>
		</div>
	{/if}

	<div class="lienzo" bind:this={contenedor} role="application" aria-label="Mapa de la afectación"></div>

	{#if !cargando}
		<div class="leyenda">
			{#each Object.entries(COLOR_ESTADO) as [nombre, color] (nombre)}
				<span class="leyenda__item">
					<span class="leyenda__punto" style="background:{color}"></span>
					{nombre}
				</span>
			{/each}
		</div>

		<p class="cobertura">
			<strong>{visibles.length}</strong>
			{visibles.length === 1 ? 'predio ubicado' : 'predios ubicados'} ·
			<strong>{personasVisibles}</strong>
			{personasVisibles === 1 ? 'persona' : 'personas'}
			{#if delSistema > 0}
				· <strong>{delSistema}</strong>
				{delSistema === 1 ? 'del formulario' : 'del formulario'}
			{/if}
			{#if sinUbicar.length > 0}
				· <strong>{sinUbicar.length}</strong> sin ubicar
			{/if}
		</p>

		{#if conGps > 0 || porSector > 0}
			<!-- Decir con qué se ubicó cada grupo evita que el mapa se lea como si
			     todos los puntos tuvieran la misma fiabilidad. -->
			<p class="detalle-ubicacion">
				{#if conGps > 0}
					<strong>{conGps}</strong> con GPS tomado en campo.
				{/if}
				{#if porSector > 0}
					<strong>{porSector}</strong> ubicados solo por su sector: el punto señala la vereda o el
					barrio, no el predio.
				{/if}
			</p>
		{/if}

		{#if sinUbicar.length > 0}
			<!-- Callarlo sería lo cómodo y lo peor: quien mire el mapa creería que
			     está viendo la afectación completa. -->
			<p class="aviso aviso--alerta">
				<TriangleAlert size={15} aria-hidden="true" />
				Hay {sinUbicar.length}
				{sinUbicar.length === 1 ? 'hogar que todavía no se puede ubicar' : 'hogares que todavía no se pueden ubicar'}
				en el mapa, casi siempre porque su dirección está incompleta. No aparecen aquí, pero sí
				cuentan en el tablero. Un administrador puede procesarlas desde Administración → Mapas.
			</p>
		{/if}
	{/if}
</div>

<style>
	.controles {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.55rem 0.8rem;
		margin-bottom: 0.9rem;
	}

	/* El grupo se comporta como un campo más de la fila: rótulo arriba y control
	   abajo, para que todo quede alineado sin cuadrar alturas a mano. */
	.capas {
		border: 0;
		margin: 0;
		padding: 0;
		min-inline-size: auto;
	}

	.capas__opciones {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;

		/* La misma altura que tiene un select con su relleno y su borde, para que
		   las casillas caigan a la altura de los demás controles. */
		min-height: calc(0.55rem * 2 + 1.35rem + 2px);
	}

	.interruptor {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.88rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.interruptor input {
		margin: 0;
		accent-color: var(--color-primary);
		width: 1rem;
		height: 1rem;
	}

	.campo--linea {
		margin-bottom: 0;
		/* Piden lo justo para su opción más larga y no más: el ancho sobrante es
		   del mapa. */
		flex: 0 1 11rem;
		min-width: 8.5rem;
	}

	/* El botón se separa del grupo de filtros y se va al final de la fila cuando
	   hay sitio, que es donde se espera una acción. */
	.controles > :global(.boton) {
		margin-left: auto;
	}

	.lienzo {
		height: clamp(22rem, 62vh, 40rem);
		border: 1px solid var(--color-border);
		border-radius: 10px;

		/*
		 * Encierra a Leaflet en su propio contexto de apilamiento.
		 *
		 * Leaflet numera sus capas internas de 400 a 800 —tejas, marcadores,
		 * globos, controles— contando con ser lo único de la página. En este
		 * sistema el menú lateral está en 60 y su velo en 55, así que el mapa se
		 * dibujaba por encima de ambos: al abrir el menú, las tejas lo tapaban.
		 *
		 * Aislarlo hace que toda esa numeración se resuelva puertas adentro y que
		 * el mapa entero cuente como un solo elemento frente al resto de la
		 * página. Es preferible a rebajarle los números a Leaflet uno por uno,
		 * que habría que rehacer con cada actualización suya.
		 */
		isolation: isolate;
		position: relative;
		z-index: 0;
		/* Un poco de profundidad separa el mapa —que ahora tiene color propio— de
		   la tarjeta que lo contiene. */
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 6%);
		/* Leaflet dibuja sus tejas y controles con posición absoluta; sin recorte
		   se salen de la esquina redondeada. */
		overflow: hidden;
		/* Color fijo, no del tema: es lo que se ve mientras cargan las tejas, y
		   debe ser del tono del mapa que viene detrás, no del de la aplicación. */
		background: #eaedf0;
	}

	.leyenda {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0.7rem 0 0.4rem;
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.leyenda__item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.leyenda__punto {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		/* El mismo anillo blanco que llevan los puntos del mapa, para que la
		   leyenda se lea como una muestra y no como otra cosa. */
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 18%);
		flex: 0 0 auto;
	}

	.detalle-ubicacion {
		margin: -0.3rem 0 0.6rem;
		font-size: 0.82rem;
		color: var(--color-muted);
	}

	.cobertura {
		margin: 0 0 0.6rem;
		font-size: 0.86rem;
		color: var(--color-text);
	}

	/* Los controles de Leaflet vienen con su propio tema claro; se atenúan para
	   que no griten sobre el tema oscuro del sistema. */
	.lienzo :global(.leaflet-control-attribution) {
		font-size: 0.65rem;
	}

	/* Leaflet dibuja sus globos y controles en claro. Con el tema oscuro del
	   sistema heredaban el color de texto y quedaban blanco sobre blanco. */
	.lienzo :global(.leaflet-popup-content),
	.lienzo :global(.leaflet-control-attribution),
	.lienzo :global(.leaflet-control-scale-line),
	.lienzo :global(.leaflet-control-zoom a) {
		color: #1b2430;
	}

	.lienzo :global(.leaflet-popup-content) {
		font-size: 0.83rem;
		line-height: 1.45;
		margin: 0.7rem 0.85rem;
	}

	.lienzo :global(.leaflet-control-scale-line) {
		border-color: #5c6b7a;
		background: rgb(255 255 255 / 78%);
		font-size: 0.68rem;
	}
</style>
