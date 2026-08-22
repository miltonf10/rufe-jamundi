<script lang="ts">
	// Captura del formulario RUFE en campo.
	//
	// Lo diligencia un funcionario (Administrador o Gestor) durante la visita al
	// hogar afectado, no el ciudadano por su cuenta. Exige sesión: la ruta está
	// registrada en $lib/navigation con rol de escritura y la API la exige otra vez
	// por su lado, que es la que de verdad cuenta.
	//
	// Aun así conserva todo lo pensado para campo —autoguardado local, cola de
	// envío sin señal, pasos cortos— porque el teléfono del censador se queda sin
	// cobertura igual que el de cualquiera.

	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		ArrowLeft, ArrowRight, CloudOff, LoaderCircle, MapPin, Send, TriangleAlert, Trash2
	} from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { rufeApi } from '$lib/api/servicios';

	import type { Catalogos, FormularioRufe, RespuestaEnvio } from '$lib/rufe-form/tipos';
	import {
		PASOS, PASOS_CON_PROGRESO, aCuerpoDeApi, etiquetaLugar, formularioVacio,
		limpiarCondicionales, muestraAgropecuario, muestraCorregimiento,
		muestraDireccionAlojamiento, muestraEventoOtro, personaVacia, renglonAgroVacio,
		type IdPaso
	} from '$lib/rufe-form/esquema';
	import {
		haceAnos, hoy as hoyISO, pasoDelError, validarPaso, validarTodo, type Errores
	} from '$lib/rufe-form/validacion';
	import { GestorBorrador, leerBorrador } from '$lib/rufe-form/borrador.svelte';
	import { GestorEvidencias } from '$lib/rufe-form/evidencias.svelte';
	import { GestorEnvio, hayFichasPendientes } from '$lib/rufe-form/envio.svelte';

	import CampoTexto from '$lib/rufe-form/componentes/CampoTexto.svelte';
	import CampoSelect from '$lib/rufe-form/componentes/CampoSelect.svelte';
	import CampoOpciones from '$lib/rufe-form/componentes/CampoOpciones.svelte';
	import IndicadorProgreso from '$lib/rufe-form/componentes/IndicadorProgreso.svelte';
	import ResumenErrores from '$lib/rufe-form/componentes/ResumenErrores.svelte';
	import EstadoAutoguardado from '$lib/rufe-form/componentes/EstadoAutoguardado.svelte';
	import ListaPersonas from '$lib/rufe-form/componentes/ListaPersonas.svelte';
	import ListaAgropecuaria from '$lib/rufe-form/componentes/ListaAgropecuaria.svelte';
	import SubidaEvidencias from '$lib/rufe-form/componentes/SubidaEvidencias.svelte';
	import AvisoDatos from '$lib/rufe-form/componentes/AvisoDatos.svelte';
	import ResumenEnvio from '$lib/rufe-form/componentes/ResumenEnvio.svelte';
	import Confirmacion from '$lib/rufe-form/componentes/Confirmacion.svelte';

	// ── Estado ──────────────────────────────────────────────────────────────

	let catalogos = $state<Catalogos | null>(null);
	let cargando = $state(true);
	let errorCarga = $state<string | null>(null);

	let datos = $state<FormularioRufe>(formularioVacio());
	let indice = $state(0);
	let errores = $state<Errores>({});
	let errorEnvio = $state<string | null>(null);
	let enviado = $state<RespuestaEnvio | null>(null);

	/**
	 * La ficha quedó guardada sin salir todavía.
	 *
	 * Se trata igual que una enviada: el trabajo de esa casa ya está a salvo en el
	 * dispositivo, así que el censador pasa a la confirmación y puede seguir con la
	 * siguiente. Quedarse esperando la señal era lo que lo bloqueaba en la vereda.
	 */
	let guardadaSinEnviar = $state(false);
	let enLinea = $state(true);
	let hayBorradorPrevio = $state(false);
	let ubicando = $state(false);
	let avisoUbicacion = $state<string | null>(null);

	/** Se manda al servidor para detectar envíos automatizados. */
	const iniciadoEn = Date.now();

	let borrador = new GestorBorrador();
	let envio = new GestorEnvio();
	let evidencias = $state<GestorEvidencias | null>(null);

	const enviando = $derived(envio.estado === 'enviando');


	const paso = $derived(PASOS[indice]);
	const esUltimo = $derived(paso.id === 'revision');
	const esPrimero = $derived(indice === 0);

	const indiceProgreso = $derived(
		PASOS_CON_PROGRESO.findIndex((p) => p.id === paso.id) + 1
	);

	// Instantánea de la última sección del formulario que ya se envió, para que la
	// pantalla de confirmación siga teniendo qué mostrar tras vaciar el borrador.
	let resumenFinal = $state({ evento: '', direccion: '', personas: 0 });

	// ── Carga inicial ───────────────────────────────────────────────────────

	onMount(() => {
		enLinea = navigator.onLine;
		const alConectar = () => (enLinea = true);
		const alDesconectar = () => (enLinea = false);
		window.addEventListener('online', alConectar);
		window.addEventListener('offline', alDesconectar);

		const detenerBorrador = borrador.iniciar();
		const detenerEnvio = envio.iniciar();

		// Las fichas que quedaron en cola de una visita anterior salen solas y se
		// muestran en la lista de pendientes del primer paso. NO se salta al último
		// paso: hacerlo dejaba al censador atrapado en el resumen de una ficha que
		// ya estaba guardada, sin poder empezar la siguiente.

		void iniciar();

		return () => {
			window.removeEventListener('online', alConectar);
			window.removeEventListener('offline', alDesconectar);
			detenerBorrador();
			detenerEnvio();
			detenerEvidencias?.();
		};
	});

	let detenerEvidencias: (() => void) | null = null;

	// El envío en cola sale solo cuando vuelve la red; este efecto es lo que lleva
	// al ciudadano a la confirmación sin que tenga que hacer nada.
	$effect(() => {
		if (envio.estado === 'enviado' && envio.respuesta && !enviado) {
			void alQuedarEnviado(envio.respuesta);
		}
	});

	async function iniciar() {
		try {
			catalogos = await rufeApi.catalogos();
		} catch (e) {
			errorCarga =
				e instanceof ApiError && e.status === 0
					? 'No hay conexión con el servidor. Revise su señal e intente de nuevo.'
					: 'No se pudo cargar el formulario. Intente de nuevo en unos minutos.';
			cargando = false;

			return;
		}

		const previo = leerBorrador();
		if (previo) {
			hayBorradorPrevio = true;
			borrador.clave = previo.clave;
		} else {
			// La emergencia que se atiende es una sola: precargarla ahorra dos campos
			// a cada persona. Solo en un formulario nuevo — un borrador recuperado
			// manda sobre esto, porque ahí el ciudadano ya decidió.
			datos.evento = catalogos.predeterminados.evento;
			datos.fecha_evento = catalogos.predeterminados.fecha_evento;
		}

		evidencias = GestorEvidencias.paraRufe(catalogos, borrador.clave);
		detenerEvidencias = evidencias.iniciar();
		cargando = false;
	}

	function continuarBorrador() {
		const previo = leerBorrador();
		if (!previo) return;

		datos = previo.datos;
		afectacionAgro =
			datos.tiene_afectacion_agro === null ? null : datos.tiene_afectacion_agro ? 'si' : 'no';
		indice = Math.max(1, PASOS.findIndex((p) => p.id === previo.paso));
		borrador.marcarRecuperado(previo.actualizado_en);
		hayBorradorPrevio = false;
		void evidencias?.restaurar();
	}

	/**
	 * Deja el formulario listo para la siguiente casa.
	 *
	 * Se conservan el evento y su fecha: una brigada levanta muchas fichas de la
	 * misma emergencia y volver a elegirlas en cada visita sería trabajo repetido
	 * sin ninguna ganancia.
	 */
	async function registrarOtra() {
		const evento = datos.evento;
		const eventoOtro = datos.evento_otro;
		const fecha = datos.fecha_evento;

		await empezarDeNuevo();

		// Borrador y evidencias se estrenan juntos: comparten la clave, y
		// reutilizar la anterior arrastraría las fotos de la casa pasada a la
		// siguiente. Las de la ficha que quedó en cola ya están copiadas allí.
		if (catalogos) {
			detenerEvidencias?.();
			evidencias = GestorEvidencias.paraRufe(catalogos, borrador.clave);
			detenerEvidencias = evidencias.iniciar();
		}

		datos.evento = evento;
		datos.evento_otro = eventoOtro;
		datos.fecha_evento = fecha;

		enviado = null;
		guardadaSinEnviar = false;
		errorEnvio = null;
		envio.descartar();
		indice = PASOS.findIndex((p) => p.id === 'ubicacion');
		subirAlInicio();
	}

	async function empezarDeNuevo() {
		datos = formularioVacio();
		afectacionAgro = null;
		indice = 0;
		errores = {};
		borrador.descartar();
		await evidencias?.limpiar();
		hayBorradorPrevio = false;
	}

	// ── Autoguardado ────────────────────────────────────────────────────────

	function alCambiar() {
		if (!catalogos) return;
		datos = limpiarCondicionales(datos, catalogos);
		borrador.programar(datos, paso.id);
	}

	// Un aviso al cerrar solo cuando de verdad hay algo sin escribir en disco: el
	// debounce es de 800 ms, así que en la práctica casi nunca aparece.
	function alCerrar(evento: BeforeUnloadEvent) {
		if (enviado || guardadaSinEnviar || borrador.estado !== 'guardando') return;
		evento.preventDefault();
	}

	// ── Navegación ──────────────────────────────────────────────────────────

	function siguiente() {
		if (!catalogos) return;

		const fallos = validarPaso(paso.id, datos, catalogos);
		errores = fallos;
		if (Object.keys(fallos).length > 0) return;

		// Avanzar con una foto a medio optimizar dejaría el resumen mintiendo sobre
		// lo que se va a enviar.
		if (paso.id === 'evidencias' && evidencias?.optimizando) {
			errorEnvio = 'Espere a que terminen de optimizarse las fotos.';

			return;
		}
		errorEnvio = null;

		// El paso de personas se salta la creación manual del jefe de hogar: si se
		// llega vacío, se crea la primera tarjeta para no mostrar una lista sola.
		if (paso.id === 'alojamiento' && datos.personas.length === 0) {
			const jefe = personaVacia(catalogos.parentesco_jefe);
			jefe.telefono = datos.contacto_telefono;
			datos.personas.push(jefe);
		}

		indice = Math.min(indice + 1, PASOS.length - 1);
		errores = {};
		borrador.guardarYa(datos, PASOS[indice].id);
		subirAlInicio();
	}

	function anterior() {
		indice = Math.max(indice - 1, 0);
		errores = {};
		borrador.guardarYa(datos, PASOS[indice].id);
		subirAlInicio();
	}

	function irAPaso(id: IdPaso) {
		const destino = PASOS.findIndex((p) => p.id === id);
		if (destino >= 0) {
			indice = destino;
			errores = {};
			subirAlInicio();
		}
	}

	function subirAlInicio() {
		if (browser) window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// ── Ubicación ───────────────────────────────────────────────────────────

	function usarMiUbicacion() {
		if (!browser || !navigator.geolocation) {
			avisoUbicacion = 'Su navegador no permite compartir la ubicación.';

			return;
		}

		ubicando = true;
		avisoUbicacion = null;

		navigator.geolocation.getCurrentPosition(
			(posicion) => {
				datos.latitud = Number(posicion.coords.latitude.toFixed(7));
				datos.longitud = Number(posicion.coords.longitude.toFixed(7));
				datos.precision_m = Math.round(posicion.coords.accuracy);
				ubicando = false;
				avisoUbicacion = 'Ubicación agregada al reporte.';
				alCambiar();
			},
			() => {
				ubicando = false;
				avisoUbicacion =
					'No se pudo obtener la ubicación. Puede continuar: la dirección escrita es suficiente.';
			},
			{ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
		);
	}

	function quitarUbicacion() {
		datos.latitud = null;
		datos.longitud = null;
		datos.precision_m = null;
		avisoUbicacion = 'Ubicación retirada del reporte.';
		alCambiar();
	}

	// ── Envío ───────────────────────────────────────────────────────────────

	async function enviar() {
		if (!catalogos || enviando) return;

		errorEnvio = null;

		const fallos = validarTodo(datos, catalogos);
		if (Object.keys(fallos).length > 0) {
			errores = fallos;
			irAPaso(pasoDelError(Object.keys(fallos)[0]));
			errores = fallos;

			return;
		}

		// No se envía con fotos a medio optimizar: el servidor recibiría la
		// original, que es justo lo que este paso existe para evitar.
		if (evidencias?.optimizando) {
			errorEnvio = 'Espere a que terminen de optimizarse las fotos.';
			irAPaso('evidencias');

			return;
		}

		// Un archivo que el servidor rechazó por su formato no se arregla solo: hay
		// que quitarlo antes de enviar. Los que fallaron por falta de señal no
		// bloquean nada, porque se reintentan solos.
		if (evidencias?.hayFallos) {
			errorEnvio =
				'Algunas fotos no se pudieron subir. Quítelas o reinténtelas antes de enviar el reporte.';
			irAPaso('evidencias');

			return;
		}

		try {
			const respuesta = await envio.enviar(
				aCuerpoDeApi(datos, {
					carga: evidencias?.carga ?? undefined,
					iniciadoEn,
					avisoVersion: catalogos?.formato.aviso_version
				}),
				{
					evento: muestraEventoOtro(datos) ? datos.evento_otro : datos.evento,
					direccion: datos.direccion,
					personas: datos.personas.length
				},
				evidencias?.paraLaCola() ?? []
			);

			// null significa que quedó en cola por falta de red: no es un error, y la
			// pantalla lo dice con sus propias palabras.
			if (respuesta.estado === 'enviado') {
				await alQuedarEnviado(respuesta.respuesta);
			} else {
				await alQuedarGuardada();
			}
		} catch (e) {
			if (e instanceof ApiError) {
				errorEnvio = e.message;

				// El servidor valida de nuevo todo; si encuentra algo que el navegador
				// dejó pasar, se lleva al ciudadano al paso donde puede corregirlo.
				if (Object.keys(e.errors).length > 0) {
					errores = e.errors;
					irAPaso(pasoDelError(Object.keys(e.errors)[0]));
					errores = e.errors;
				}
			} else {
				errorEnvio = 'No se pudo enviar el reporte. Intente de nuevo.';
			}
		}
	}

	/** La ficha quedó en cola: se cierra el formulario igual, sin radicado. */
	async function alQuedarGuardada() {
		resumenFinal = {
			evento: muestraEventoOtro(datos) ? datos.evento_otro : datos.evento,
			direccion: datos.direccion,
			personas: datos.personas.length
		};

		guardadaSinEnviar = true;
		borrador.descartar();

		// Las fotos NO se limpian: siguen en IndexedDB atadas a esta ficha y son
		// lo que el Service Worker subirá. Borrarlas aquí perdería las evidencias.
		evidencias = null;
		subirAlInicio();
	}

	/** Cierre común del envío, venga de pulsar el botón o del reintento automático. */
	async function alQuedarEnviado(respuesta: RespuestaEnvio) {
		resumenFinal = {
			evento: muestraEventoOtro(datos) ? datos.evento_otro : datos.evento,
			direccion: datos.direccion,
			personas: datos.personas.length
		};

		enviado = respuesta;
		borrador.descartar();
		await evidencias?.limpiar();
	}

	// ── Opciones derivadas de los catálogos ─────────────────────────────────

	const opcionesEvento = $derived(
		catalogos
			? [
					...catalogos.eventos_sugeridos.map((e) => ({ valor: e, etiqueta: e })),
					{ valor: 'OTRO', etiqueta: 'Otro (lo describo yo)' }
				]
			: []
	);

	const opcionesCorregimiento = $derived(
		catalogos ? catalogos.corregimientos.map((c) => ({ valor: c, etiqueta: c })) : []
	);

	const opcionesZona = $derived(
		catalogos
			? catalogos.zonas.map((z) => ({
					valor: z.codigo,
					etiqueta: z.etiqueta,
					nota: z.codigo === 'URBANO' ? 'Dentro del casco urbano' : 'Corregimientos y veredas'
				}))
			: []
	);

	const opcionesTenencia = $derived(
		catalogos ? catalogos.formas_tenencia.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta })) : []
	);

	const opcionesEstadoBien = $derived(
		catalogos ? catalogos.estados_bien.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta })) : []
	);

	const opcionesAlojamiento = $derived(
		catalogos ? catalogos.alojamientos.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta })) : []
	);

	const tiposBienComunes = $derived(
		catalogos
			? catalogos.tipos_bien.filter((t) => t.grupo === 'COMUNES').map((t) => ({ valor: t.codigo, etiqueta: t.etiqueta }))
			: []
	);

	const tiposBienInstitucionales = $derived(
		catalogos
			? catalogos.tipos_bien
					.filter((t) => t.grupo === 'INSTITUCIONAL')
					.map((t) => ({ valor: t.codigo, etiqueta: t.etiqueta }))
			: []
	);

	let verMasTipos = $state(false);

	/** Puente entre la cadena del control de opciones y el booleano del formulario. */
	let afectacionAgro = $state<string | number | null>(null);

	function alElegirAfectacion() {
		datos.tiene_afectacion_agro = afectacionAgro === null ? null : afectacionAgro === 'si';

		// Al decir "sí" por primera vez se abre un renglón vacío: dejar la lista
		// vacía obligaría a un clic más para hacer lo único que se puede hacer ahí.
		if (datos.tiene_afectacion_agro === true && datos.agropecuario.length === 0) {
			datos.agropecuario.push(renglonAgroVacio());
		}

		alCambiar();
	}

	// Los topes del control de fecha salen del mismo cálculo que la validación:
	// si uno usara UTC y el otro la hora local, el navegador dejaría elegir una
	// fecha que después el formulario rechazaría.
	const hoy = hoyISO();
	const fechaMinima = $derived(
		catalogos ? haceAnos(catalogos.limites.anos_atras_evento) : ''
	);
</script>

<svelte:head>
	<title>Reportar una emergencia · Alcaldía de Jamundí</title>
	<meta
		name="description"
		content="Registro Unifamiliar de Emergencias de la Alcaldía Municipal de Jamundí."
	/>
</svelte:head>

<svelte:window onbeforeunload={alCerrar} />

<div class="contenedor">
		{#if cargando}
			<p class="cargando">
				<LoaderCircle size={20} class="girando" aria-hidden="true" />
				Cargando el formulario…
			</p>
		{:else if errorCarga}
			<div class="aviso aviso--error" role="alert">
				<TriangleAlert size={16} aria-hidden="true" />
				{errorCarga}
			</div>
			<button type="button" class="boton" onclick={() => location.reload()}>Reintentar</button>
		{:else if enviado || guardadaSinEnviar}
			<Confirmacion
				enCola={guardadaSinEnviar}
				pendientes={envio.pendientes}
				enSegundoPlano={envio.enSegundoPlano}
				radicado={enviado?.radicado ?? ''}
				recibidoEn={enviado?.recibido_en ?? new Date().toISOString()}
				evento={resumenFinal.evento}
				direccion={resumenFinal.direccion}
				personas={resumenFinal.personas}
				onOtra={registrarOtra}
			/>

			{#if guardadaSinEnviar && envio.pendientes > 0}
				<div class="pendientes-confirmacion">
					<a class="aviso aviso--info aviso-pendientes" href="/riesgo/pendientes">
						<CloudOff size={16} aria-hidden="true" />
						<span>
							{envio.pendientes === 1
								? 'Hay 1 ficha esperando salir.'
								: `Hay ${envio.pendientes} fichas esperando salir.`}
							<strong>Ver pendientes</strong>
						</span>
					</a>
				</div>
			{/if}
		{:else if catalogos}
			{#if borrador.otraPestana}
				<div class="aviso aviso--error" role="alert">
					Está editando este mismo reporte en otra pestaña. Para evitar perder información, siga
					allí o cierre esta pestaña.
				</div>
			{/if}

			<IndicadorProgreso
				indice={indiceProgreso}
				total={PASOS_CON_PROGRESO.length}
				titulo={paso.titulo}
			/>

			<EstadoAutoguardado
				estado={borrador.estado}
				guardadoEn={borrador.guardadoEn}
				{enLinea}
			/>

			<p class="ayuda-paso">{paso.ayuda}</p>

			<ResumenErrores {errores} />

			<!-- ── Paso 0: orientación ─────────────────────────────────── -->
			{#if paso.id === 'inicio'}
				<!-- Un aviso, no la lista: vigilar la cola es trabajo de «Pendientes».
				     Pero callarlo del todo sería peor — el censador tiene que saber que
				     hay trabajo sin salir antes de empezar otra casa. -->
				{#if envio.pendientes > 0}
					<a class="aviso aviso--info aviso-pendientes" href="/riesgo/pendientes">
						<CloudOff size={16} aria-hidden="true" />
						<span>
							{envio.pendientes === 1
								? 'Hay 1 ficha guardada sin enviar.'
								: `Hay ${envio.pendientes} fichas guardadas sin enviar.`}
							<strong>Ver pendientes</strong>
						</span>
					</a>
				{/if}

				<div class="intro">
					<h1 class="intro__titulo">Registrar un RUFE</h1>

					<p>
						<strong>Registro Unifamiliar de Emergencias.</strong> Una ficha por hogar afectado.
						Diligéncielo durante la visita, con la información que le dé el jefe de hogar o un
						integrante del hogar.
					</p>

					<h2 class="intro__sub">Antes de empezar, pida</h2>
					<ul class="intro__lista">
						<li>Los documentos de identidad de quienes viven en el inmueble.</li>
						<li>La dirección exacta del inmueble afectado.</li>
						<li>Autorización verbal para registrar los datos del hogar.</li>
					</ul>

					<p class="intro__tiempo">
						Toma unos <strong>10 minutos</strong>. Todo se guarda en este dispositivo a medida que
						escribe: puede quedarse sin señal, cerrar la aplicación o cambiar de casa y continuar
						después. El envío también espera a que haya cobertura.
					</p>

					<AvisoDatos />

					{#if hayBorradorPrevio}
						<div class="recuperar">
							<p class="recuperar__texto">
								Hay una ficha sin terminar guardada en este dispositivo.
							</p>
							<div class="recuperar__acciones">
								<button type="button" class="boton" onclick={continuarBorrador}>
									Continuar esa ficha
								</button>
								<button type="button" class="boton boton--suave" onclick={empezarDeNuevo}>
									<Trash2 size={15} aria-hidden="true" />
									Empezar de nuevo
								</button>
							</div>
						</div>
					{/if}
				</div>

				<!-- ── Paso 1: el evento ───────────────────────────────── -->
			{:else if paso.id === 'evento'}
				<CampoSelect
					id="evento"
					etiqueta="¿Qué ocurrió?"
					requerido
					opciones={opcionesEvento}
					bind:valor={datos.evento}
					error={errores.evento ?? ''}
					{alCambiar}
				/>

				{#if muestraEventoOtro(datos)}
					<CampoTexto
						id="evento_otro"
						etiqueta="Describa el evento"
						requerido
						maximo={120}
						marcador="Por ejemplo: se hundió la vía frente a la casa"
						bind:valor={datos.evento_otro}
						error={errores.evento_otro ?? ''}
						{alCambiar}
					/>
				{/if}

				<CampoTexto
					id="fecha_evento"
					etiqueta="¿Qué día ocurrió?"
					requerido
					tipo="date"
					min={fechaMinima}
					max={hoy}
					bind:valor={datos.fecha_evento}
					error={errores.fecha_evento ?? ''}
					{alCambiar}
				/>

				<!-- ── Paso 2: ubicación ───────────────────────────────── -->
			{:else if paso.id === 'ubicacion'}
				<CampoOpciones
					id="zona"
					etiqueta="¿Dónde queda el inmueble?"
					requerido
					opciones={opcionesZona}
					bind:valor={datos.zona}
					error={errores.zona ?? ''}
					{alCambiar}
				/>

				{#if muestraCorregimiento(datos)}
					<CampoSelect
						id="corregimiento"
						etiqueta="Corregimiento"
						requerido
						vacio="Seleccione el corregimiento…"
						opciones={opcionesCorregimiento}
						bind:valor={datos.corregimiento}
						error={errores.corregimiento ?? ''}
						{alCambiar}
					/>
				{/if}

				<CampoTexto
					id="vereda_sector_barrio"
					etiqueta={etiquetaLugar(datos)}
					requerido
					maximo={160}
					bind:valor={datos.vereda_sector_barrio}
					error={errores.vereda_sector_barrio ?? ''}
					{alCambiar}
				/>

				<CampoTexto
					id="direccion"
					etiqueta="Dirección"
					requerido
					maximo={200}
					ayuda="Escríbala como se la daría a alguien que va a buscarla."
					marcador="Calle 10 # 5-32, casa de dos pisos"
					bind:valor={datos.direccion}
					error={errores.direccion ?? ''}
					{alCambiar}
				/>

				<div class="ubicacion">
					<p class="ubicacion__titulo">Ubicación en el mapa (opcional)</p>
					<p class="ubicacion__ayuda">
						Tómela estando frente al inmueble. Ayuda a que los equipos de atención lo encuentren
						después. Puede continuar sin ella.
					</p>

					{#if datos.latitud !== null}
						<p class="ubicacion__valor">
							<MapPin size={15} aria-hidden="true" />
							Ubicación compartida
							{#if datos.precision_m}(precisión de unos {datos.precision_m} m){/if}
						</p>
						<button type="button" class="boton boton--suave" onclick={quitarUbicacion}>
							Quitar la ubicación
						</button>
					{:else}
						<button
							type="button"
							class="boton boton--suave"
							onclick={usarMiUbicacion}
							disabled={ubicando}
						>
							{#if ubicando}
								<LoaderCircle size={15} class="girando" aria-hidden="true" />
								Obteniendo…
							{:else}
								<MapPin size={15} aria-hidden="true" />
								Tomar la ubicación aquí
							{/if}
						</button>
					{/if}

					<p class="ubicacion__estado" role="status" aria-live="polite">
						{avisoUbicacion ?? ''}
					</p>
				</div>

				<!-- ── Paso 3: el inmueble ─────────────────────────────── -->
			{:else if paso.id === 'inmueble'}
				<CampoOpciones
					id="tipo_bien"
					etiqueta="¿Qué tipo de inmueble es?"
					requerido
					columnas
					opciones={verMasTipos ? [...tiposBienComunes, ...tiposBienInstitucionales] : tiposBienComunes}
					bind:valor={datos.tipo_bien}
					error={errores.tipo_bien ?? ''}
					{alCambiar}
				/>

				{#if !verMasTipos}
					<button
						type="button"
						class="boton boton--suave ver-mas"
						onclick={() => (verMasTipos = true)}
					>
						Ver más opciones (hospital, escuela, iglesia…)
					</button>
				{/if}

				<CampoOpciones
					id="forma_tenencia"
					etiqueta="¿Qué relación tiene el hogar con el inmueble?"
					requerido
					columnas
					opciones={opcionesTenencia}
					bind:valor={datos.forma_tenencia}
					error={errores.forma_tenencia ?? ''}
					{alCambiar}
				/>

				<CampoOpciones
					id="estado_bien"
					etiqueta="¿Cómo quedó el inmueble?"
					requerido
					columnas
					opciones={opcionesEstadoBien}
					bind:valor={datos.estado_bien}
					error={errores.estado_bien ?? ''}
					{alCambiar}
				/>

				<!-- ── Paso 4: alojamiento ─────────────────────────────── -->
			{:else if paso.id === 'alojamiento'}
				<CampoOpciones
					id="alojamiento"
					etiqueta="¿Dónde está durmiendo el hogar ahora?"
					requerido
					opciones={opcionesAlojamiento}
					bind:valor={datos.alojamiento}
					error={errores.alojamiento ?? ''}
					{alCambiar}
				/>

				{#if muestraDireccionAlojamiento(datos)}
					<CampoTexto
						id="alojamiento_direccion"
						etiqueta="¿Dónde se está alojando?"
						requerido
						maximo={200}
						ayuda="Casa de un familiar, albergue, hotel… Necesitamos poder ubicarlo."
						bind:valor={datos.alojamiento_direccion}
						error={errores.alojamiento_direccion ?? ''}
						{alCambiar}
					/>
				{/if}

				<!-- ── Paso 5: personas ────────────────────────────────── -->
			{:else if paso.id === 'personas'}
				<ListaPersonas
					bind:personas={datos.personas}
					{catalogos}
					{errores}
					telefonoContacto={datos.contacto_telefono}
					{alCambiar}
				/>

				<!-- ── Paso 6: agropecuario ────────────────────────────── -->
			{:else if paso.id === 'agropecuario'}
				<!-- El componente de opciones trabaja con cadenas y el resto del
				     formulario con un booleano de tres estados (sí / no / sin
				     responder), así que la conversión ocurre aquí, en un solo sitio. -->
				<CampoOpciones
					id="tiene_afectacion_agro"
					etiqueta="¿El hogar perdió cultivos o animales por el evento?"
					requerido
					columnas
					opciones={[
						{ valor: 'no', etiqueta: 'No' },
						{ valor: 'si', etiqueta: 'Sí' }
					]}
					bind:valor={afectacionAgro}
					error={errores.tiene_afectacion_agro ?? ''}
					alCambiar={alElegirAfectacion}
				/>

				{#if muestraAgropecuario(datos)}
					<ListaAgropecuaria
						bind:renglones={datos.agropecuario}
						{catalogos}
						{errores}
						{alCambiar}
					/>
				{/if}

				<!-- ── Paso 7: evidencias y contacto ───────────────────── -->
			{:else if paso.id === 'evidencias'}
				{#if evidencias}
					<SubidaEvidencias
						gestor={evidencias}
						tipo="DOCUMENTO"
						titulo="Foto del documento de identidad"
						ayuda="Foto de la cédula del jefe de hogar, por el lado de los datos. Respalda la identificación del hogar."
						textoCamara="Tomar foto de la cédula"
					/>

					<SubidaEvidencias
						gestor={evidencias}
						tipo="DANO"
						titulo="Fotos del daño"
						ayuda="Cómo quedó el inmueble. Ayudan a valorar el daño, pero no son obligatorias."
						textoCamara="Tomar foto"
					/>
				{/if}

				<h2 class="seccion">Observaciones</h2>
				<CampoTexto
					id="observaciones"
					etiqueta="Observaciones de la visita"
					multilinea
					maximo={2000}
					ayuda="Opcional. Por ejemplo, si hay personas enfermas, en silla de ruedas o con alguna necesidad especial."
					bind:valor={datos.observaciones}
					error={errores.observaciones ?? ''}
					{alCambiar}
				/>

				<h2 class="seccion">Contacto del hogar</h2>
				<CampoTexto
					id="contacto_telefono"
					etiqueta="Teléfono de contacto"
					requerido
					tipo="tel"
					modoTeclado="tel"
					maximo={30}
					autocompletar="tel"
					ayuda="Número al que la Secretaría llamará para el seguimiento."
					bind:valor={datos.contacto_telefono}
					error={errores.contacto_telefono ?? ''}
					{alCambiar}
				/>

				<CampoTexto
					id="contacto_correo"
					etiqueta="Correo electrónico"
					tipo="email"
					modoTeclado="email"
					maximo={180}
					autocompletar="email"
					ayuda="Opcional."
					bind:valor={datos.contacto_correo}
					error={errores.contacto_correo ?? ''}
					{alCambiar}
				/>

				<!-- ── Paso 8: revisión y envío ────────────────────────── -->
			{:else if paso.id === 'revision'}
				<ResumenEnvio
					{datos}
					{catalogos}
					archivos={evidencias?.archivos.length ?? 0}
					{irAPaso}
				/>

				<div class="autorizaciones">
					<h2 class="seccion">Declaraciones y autorizaciones</h2>

					<p class="autorizaciones__nota">
						Lea el aviso al informante y marque cada casilla solo si lo confirmó de viva voz. Su
						usuario queda registrado como responsable de esta ficha.
					</p>

					<AvisoDatos compacto />

					<!--
						Una sola casilla, pero su texto tiene que decirlo todo. La Ley 1581
						exige que la autorización sea informada, y para los datos sensibles
						—identidad de género y pertenencia étnica— exige además advertir que
						responder es voluntario. Menos casillas no puede significar menos
						información: por eso este párrafo es largo y por eso el aviso subió de
						versión, que es lo que queda guardado con cada ficha.
					-->
					<label class="opcion opcion--consentimiento" class:opcion--activa={datos.autoriza_tratamiento}>
						<input
							type="checkbox"
							bind:checked={datos.autoriza_tratamiento}
							onchange={alCambiar}
						/>
						<span class="opcion__texto">
							Confirmo que la información fue suministrada por el jefe(a) de hogar o un
							integrante del hogar, que declaró ser jefe(a) de hogar o contar con autorización
							de las personas registradas, y que <strong>autorizó de manera libre, previa,
							expresa e informada</strong> el tratamiento de los datos personales de esta ficha
							para la atención de la emergencia, incluidos los de
							<strong>identidad de género</strong> y <strong>pertenencia étnica</strong>, que la
							ley considera sensibles y cuya entrega es voluntaria.
						</span>
					</label>
					{#if errores.autoriza_tratamiento}
						<span class="campo__error">{errores.autoriza_tratamiento}</span>
					{/if}
				</div>

				{#if errorEnvio}
					<div class="aviso aviso--error" role="alert">
						<TriangleAlert size={16} aria-hidden="true" />
						{errorEnvio}
					</div>
				{/if}

				{#if envio.sesionRequerida}
					<div class="aviso aviso--error" role="alert">
						<TriangleAlert size={16} aria-hidden="true" />
						Su sesión venció. Vuelva a iniciar sesión: las fichas que ya guardó se enviarán
						solas y no se ha perdido ninguna.
					</div>
				{/if}

				{#if !enLinea}
					<div class="aviso aviso--info" role="status">
						Sin conexión. Puede pulsar «Guardar» igualmente: la ficha queda en este dispositivo
						y se envía sola cuando vuelva la señal.
					</div>
				{/if}
			{/if}

			<!-- ── Navegación ──────────────────────────────────────────── -->
			<nav class="navegacion" aria-label="Navegación del formulario">
				{#if !esPrimero}
					<button type="button" class="boton boton--suave" onclick={anterior} disabled={enviando}>
						<ArrowLeft size={16} aria-hidden="true" />
						Atrás
					</button>
				{/if}

				{#if esUltimo}
					<button
						type="button"
						class="boton boton--enviar"
						onclick={enviar}
						disabled={enviando || borrador.otraPestana}
					>
						{#if enviando}
							<LoaderCircle size={16} class="girando" aria-hidden="true" />
							Enviando…
						{:else}
							<Send size={16} aria-hidden="true" />
							{enLinea ? 'Enviar la ficha' : 'Guardar y enviar cuando haya señal'}
						{/if}
					</button>
				{:else}
					<button
						type="button"
						class="boton"
						onclick={siguiente}
						disabled={borrador.otraPestana}
					>
						{paso.id === 'inicio' ? 'Comenzar' : 'Siguiente'}
						<ArrowRight size={16} aria-hidden="true" />
					</button>
				{/if}
			</nav>

			<!-- Trampa para robots: invisible para una persona, presente en el DOM.
			     No se usa type="hidden" porque los robots lo saltan. -->
			<div class="trampa" aria-hidden="true">
				<label for="sitio_web">No llene este campo</label>
				<input id="sitio_web" name="sitio_web" type="text" tabindex="-1" autocomplete="off" />
			</div>
		{/if}

	<p class="pie">
		Formato {catalogos?.formato.codigo ?? 'FR-1703-SMD-69'} · versión
		{catalogos?.formato.version ?? '01'} — Unidad Nacional para la Gestión del Riesgo de Desastres
	</p>
</div>

<style>
	/* El menú, la barra superior y el fondo los pone el armazón del sistema; aquí
	   solo se limita el ancho para que las líneas no queden ilegibles en un
	   monitor de escritorio. */
	.contenedor {
		width: 100%;
		max-width: 44rem;
		margin: 0 auto;
	}

	.pendientes-confirmacion {
		max-width: 34rem;
		margin: 1.5rem auto 0;
	}

	.aviso-pendientes {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: var(--aviso-info-texto);
	}

	.aviso-pendientes strong {
		text-decoration: underline;
		white-space: nowrap;
	}

	.ayuda-paso {
		margin: 0 0 1.1rem;
		font-size: 0.86rem;
		color: var(--color-muted);
	}

	.seccion {
		margin: 1.4rem 0 0.7rem;
		font-size: 0.95rem;
		font-weight: 700;
	}

	.seccion:first-child {
		margin-top: 0;
	}

	.intro__titulo {
		margin: 0 0 0.8rem;
		font-size: 1.3rem;
		font-weight: 700;
	}

	.intro p {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		line-height: 1.55;
	}

	.intro__sub {
		margin: 1.2rem 0 0.5rem;
		font-size: 0.95rem;
		font-weight: 700;
	}

	.intro__lista {
		margin: 0 0 1rem;
		padding-left: 1.2rem;
		font-size: 0.88rem;
		line-height: 1.6;
	}

	.intro__tiempo {
		padding: 0.7rem 0.9rem;
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.recuperar {
		margin-top: 1.2rem;
		padding: 0.9rem;
		border: 2px solid var(--color-primary);
		border-radius: 12px;
		background: var(--color-info-bg);
	}

	.recuperar__texto {
		margin: 0 0 0.7rem;
		font-size: 0.88rem;
		font-weight: 600;
	}

	.recuperar__acciones {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.ver-mas {
		margin-bottom: 1rem;
	}

	.autorizaciones__nota {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-muted);
		line-height: 1.45;
	}

	/* El consentimiento es un párrafo, no una frase: la casilla se alinea arriba
	   para que no quede flotando a media altura del texto. */
	.opcion--consentimiento {
		align-items: flex-start;
	}

	.opcion--consentimiento .opcion__texto {
		line-height: 1.5;
	}

	.autorizaciones {
		margin-top: 1.5rem;
		display: grid;
		gap: 0.6rem;
	}

	.navegacion {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.8rem;
		padding-top: 1.2rem;
		border-top: 1px solid var(--color-border);
	}

	.navegacion .boton {
		flex: 1;
		justify-content: center;
		min-height: 48px;
		font-size: 0.95rem;
	}

	.boton--enviar {
		background: var(--color-success);
	}

	.boton--enviar:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-success) 82%, black);
	}

	/* Fuera de la vista pero presente para quien automatiza: no se usa
	   display:none ni hidden porque los robots que rellenan formularios saltan
	   justamente esos. */
	.trampa {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}

	.pie {
		margin: 2rem 0 0;
		padding-top: 1rem;
		text-align: center;
		font-size: 0.72rem;
		color: var(--color-muted);
		border-top: 1px solid var(--color-border);
	}
</style>
