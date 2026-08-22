<script lang="ts">
	// Formato de Inspección de Viviendas Afectadas (NGRD), paso a paso.
	//
	// El censo RUFE dice quién quedó afectado; esto evalúa la vivienda y
	// determina qué materiales le corresponden. Lo llena un profesional de pie en
	// la puerta de una casa, así que manda el teléfono: un paso por pantalla,
	// botones grandes y todo lo que se pueda deducir, deducido.
	//
	// La diferencia con el formulario del RUFE es que aquí hay una bifurcación de
	// verdad. El numeral 4 decide si se hace la inspección o si se levanta un
	// acta y se termina; no es un campo que se oculta, es media ficha que no se
	// llena. El formato lo ordena: «si la respuesta es negativa, no se continúa
	// con la inspección de la vivienda, pasar al numeral 8».

	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		ArrowLeft,
		ArrowRight,
		CheckCircle2,
		LoaderCircle,
		MapPin,
		Send,
		TriangleAlert
	} from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { ApiError } from '$lib/api/client';
	import { sesion } from '$lib/stores/sesion.svelte';
	import { ROLES } from '$lib/navigation';
	import { inspeccionApi, preinscripcionApi } from '$lib/api/servicios';
	import CampoTexto from '$lib/rufe-form/componentes/CampoTexto.svelte';
	import CampoSelect from '$lib/rufe-form/componentes/CampoSelect.svelte';
	import CampoOpciones from '$lib/rufe-form/componentes/CampoOpciones.svelte';
	import TablaEvaluacion from '$lib/inspeccion-form/componentes/TablaEvaluacion.svelte';
	import ResultadoCombo from '$lib/inspeccion-form/componentes/ResultadoCombo.svelte';
	import IndicadorProgreso from '$lib/rufe-form/componentes/IndicadorProgreso.svelte';
	import EstadoAutoguardado from '$lib/rufe-form/componentes/EstadoAutoguardado.svelte';
	import {
		conValoresIniciales,
		cumpleRequisitos,
		elementosDe,
		formularioVacio,
		kitSugerido,
		kitsCubiertaDe,
		limpiarCondicionales,
		muestraEventoOtro,
		muestraProfesionOtra,
		muestraTablaDanos,
		nivelesPorElemento,
		pasosConProgreso,
		pasosVigentes,
		requisitosIncumplidos,
		type IdPaso
	} from '$lib/inspeccion-form/esquema';
	import { determinarCombo, motivoDelCombo } from '$lib/inspeccion-form/combo';
	import { explicarCombo } from '$lib/inspeccion-form/explicacion';
	import { materialesDe } from '$lib/inspeccion-form/materiales';
	import { pasoDelError, validarPaso, validarTodo, hoy } from '$lib/inspeccion-form/validacion';
	import {
		GestorBorrador,
		describirEstado,
		descartarBorrador,
		leerBorrador
	} from '$lib/inspeccion-form/borrador.svelte';
	import type { Catalogos, FormularioInspeccion } from '$lib/inspeccion-form/tipos';
	import type { ListaMateriales } from '$lib/inspeccion-form/detalle';
	import { GestorEnvio } from '$lib/rufe-form/envio.svelte';
	import { GestorEvidencias } from '$lib/rufe-form/evidencias.svelte';
	import SubidaEvidencias from '$lib/rufe-form/componentes/SubidaEvidencias.svelte';

	let catalogos = $state<Catalogos | null>(null);
	let datos = $state<FormularioInspeccion>(formularioVacio());
	let indice = $state(0);
	let errores = $state<Record<string, string>>({});
	let cargando = $state(true);
	let ubicando = $state(false);
	let avisoUbicacion = $state<string | null>(null);
	let errorCarga = $state('');
	let enviando = $state(false);
	let errorEnvio = $state('');
	let enviado = $state<{ numero: string; combo: string | null; motivo: string | null } | null>(null);
	let hayBorradorPrevio = $state(false);
	let avisoDuplicado = $state<string>('');

	/**
	 * La solicitud ciudadana de la que nace esta inspección, si viene de una.
	 *
	 * Se guarda para mandarla al enviar: el servidor marca la solicitud como
	 * atendida DENTRO de la misma transacción que crea la ficha. Si se marcara
	 * desde aquí con otra llamada, una solicitud podría quedar cerrada como
	 * «convertida» sin que la inspección existiera.
	 */
	let preinscripcionId = $state<number | null>(null);
	let avisoPreinscripcion = $state('');
	let enLinea = $state(true);

	const borrador = new GestorBorrador();

	// La misma cola del censo, con su discriminador. Sin esto, enviar en una
	// vereda solo mostraba un error: el trabajo quedaba en el borrador, pero
	// nadie garantizaba que saliera al volver la señal.
	const envio = new GestorEnvio();
	let detenerEnvio: (() => void) | null = null;

	// El registro fotográfico del numeral 11. La misma maquinaria del censo:
	// comprime en el teléfono —la original nunca sale de ahí—, sube de a una con
	// barra de progreso y guarda en IndexedDB lo que no pudo salir por falta de
	// señal.
	let evidencias = $state<GestorEvidencias | null>(null);
	let detenerEvidencias: (() => void) | null = null;
	let enCola = $state(false);

	const pasos = $derived(catalogos ? pasosVigentes(datos, catalogos) : []);
	const paso = $derived(pasos[Math.min(indice, pasos.length - 1)]);
	const conProgreso = $derived(catalogos ? pasosConProgreso(datos, catalogos) : []);
	const avance = $derived(
		paso ? conProgreso.findIndex((p) => p.id === paso.id) + 1 : 0
	);
	const cumple = $derived(catalogos ? cumpleRequisitos(datos, catalogos) : null);
	const incumplidos = $derived(catalogos ? requisitosIncumplidos(datos, catalogos) : []);

	// El combo se recalcula solo, en cada cambio de la tabla. Verlo moverse
	// mientras se evalúa es lo que convierte esto en una herramienta y no en un
	// papel en pantalla.
	const resultado = $derived(
		catalogos
			? determinarCombo(catalogos, datos.sistema_constructivo, nivelesPorElemento(datos), datos.colapso_total)
			: { combo: null, etiqueta: null, nivel: null, elemento: null }
	);

	const motivo = $derived(
		catalogos
			? motivoDelCombo(
					resultado,
					(c) => elementosDe(datos, catalogos!).find((e) => e.codigo === c)?.etiqueta ?? c,
					(c) =>
						elementosDe(datos, catalogos!)
							.flatMap((e) => e.niveles)
							.find((n) => n.codigo === c)?.etiqueta ?? c
				)
			: ''
	);

	/**
	 * El numeral 1, precargado con los datos de quien tiene la sesión.
	 *
	 * Solo para el rol de inspección de vivienda. Antes no se precargaba nada, y
	 * con razón: quien tenía la aplicación abierta —un administrador, o quien
	 * prestó el teléfono— no era necesariamente el profesional que firma, y un
	 * nombre ya escrito se acepta sin leerlo. Ahora el rol lo dice: si quien
	 * entró ES el inspector, sus datos son los que van en el formato.
	 *
	 * Se puede corregir todo en la visita: un dato mal cargado no puede dejar al
	 * profesional atascado delante de una casa.
	 */
	function precargarProfesional() {
		const u = sesion.usuario;
		if (!u || u.rol !== ROLES.INSPECTOR) return;

		datos.profesional_nombre = u.nombre;
		datos.profesional_profesion = u.profesion ?? '';
		datos.profesional_tarjeta = u.tarjeta_profesional ?? '';
		datos.profesional_documento = u.documento ?? '';
		datos.profesional_documento_de = u.documento_de ?? '';
		datos.profesional_telefono = u.telefono ?? '';
		datos.profesional_direccion = u.direccion ?? '';
	}

	/**
	 * Trae lo que el ciudadano ya escribió en su pre-inscripción.
	 *
	 * Es el objetivo de todo el módulo público: que el profesional llegue a la
	 * casa con medio formato lleno y sabiendo a dónde va. Todo queda editable —lo
	 * escribió alguien sin formación técnica y desde su celular—, así que se
	 * trata como un punto de partida, no como un dato verificado.
	 */
	async function precargarDesdeSolicitud() {
		const parametro = Number(page.url.searchParams.get('preinscripcion'));
		if (!Number.isInteger(parametro) || parametro <= 0) return;

		try {
			const { preinscripcion: s } = await preinscripcionApi.ver(parametro);

			preinscripcionId = parametro;
			datos.propietario_nombres = String(s.nombre_completo ?? '');
			datos.propietario_documento = String(s.documento ?? '');
			datos.propietario_telefono = String(s.telefono ?? '');
			datos.direccion_cabecera = String(s.direccion ?? '');
			datos.corregimiento = s.corregimiento ? String(s.corregimiento) : '';
			datos.vereda = s.vereda ? String(s.vereda) : '';

			if (s.latitud !== null && s.longitud !== null) {
				datos.latitud = Number(s.latitud);
				datos.longitud = Number(s.longitud);
				datos.precision_m = s.precision_m === null ? null : Number(s.precision_m);
			}

			avisoPreinscripcion = `Datos tomados de la solicitud ${s.radicado}. Verifíquelos en la visita: los escribió la propia familia.`;
		} catch {
			// Que no se pueda traer la solicitud no puede impedir levantar la
			// inspección: el profesional ya está en la puerta de la casa.
			avisoPreinscripcion =
				'No se pudieron traer los datos de la solicitud. Puede continuar y llenarlos a mano.';
		}
	}

	// ── Ubicación ───────────────────────────────────────────────────────────
	//
	// Las mismas que el censo, y por la misma razón: la dirección escrita de una
	// vivienda rural no lleva a nadie hasta la puerta dos semanas después, cuando
	// hay que ir a entregar los materiales que esta inspección decide.
	//
	// Nunca bloquea: si el GPS no engancha —bajo un techo de zinc, entre
	// montañas— se avisa y la visita continúa.

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
				avisoUbicacion = 'Ubicación agregada a la inspección.';
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
		avisoUbicacion = 'Ubicación retirada de la inspección.';
		alCambiar();
	}

	// De dónde sale el combo, para el desplegable de auditoría. No recalcula
	// nada: toma `resultado` como un hecho y lo reordena para enseñarlo.
	const explicacion = $derived(
		catalogos
			? explicarCombo(
					catalogos,
					datos.sistema_constructivo,
					elementosDe(datos, catalogos),
					nivelesPorElemento(datos),
					resultado,
					datos.colapso_total
				)
			: { regla: '', colapsoTotal: false, filas: [], escala: [], mapa: [] }
	);

	// Los materiales salen del Anexo 2 que vino en los catálogos, así que la
	// lista se ve en campo y sin señal. La que queda en el expediente la resuelve
	// el servidor; es la misma porque sale de los mismos datos.
	const materiales = $derived<ListaMateriales | null>(
		catalogos
			? materialesDe(
					catalogos.anexo2,
					datos.sistema_constructivo,
					resultado.nivel,
					datos.kit_cubierta || null
				)
			: null
	);

	const opcionesProfesion = $derived(
		(catalogos?.profesiones ?? []).map((p) => ({ valor: p.codigo, etiqueta: p.etiqueta }))
	);
	const opcionesEvento = $derived(
		(catalogos?.eventos ?? []).map((e) => ({ valor: e.codigo, etiqueta: e.etiqueta }))
	);
	const opcionesSistema = $derived(
		(catalogos?.sistemas ?? []).map((s) => ({ valor: s.codigo, etiqueta: s.etiqueta }))
	);
	const opcionesCorregimiento = $derived(
		(catalogos?.corregimientos ?? []).map((c) => ({ valor: c, etiqueta: c }))
	);
	const opcionesParentesco = $derived(
		(catalogos?.parentescos ?? []).map((p) => ({ valor: Number(p.codigo), etiqueta: p.etiqueta }))
	);
	const SI_NO = [
		{ valor: true, etiqueta: 'Sí' },
		{ valor: false, etiqueta: 'No' }
	];

	onMount(() => {
		detenerEnvio = envio.iniciar();
		void iniciar();

		enLinea = navigator.onLine;
		const conectar = () => (enLinea = true);
		const desconectar = () => (enLinea = false);
		window.addEventListener('online', conectar);
		window.addEventListener('offline', desconectar);

		return () => {
			window.removeEventListener('online', conectar);
			window.removeEventListener('offline', desconectar);
		};
	});

	onDestroy(() => {
		borrador.detener();
		detenerEnvio?.();
		detenerEvidencias?.();
	});

	async function iniciar() {
		try {
			catalogos = await inspeccionApi.catalogos();
		} catch (e) {
			errorCarga =
				e instanceof ApiError && e.status === 0
					? 'No hay conexión con el servidor. Abra esta pantalla una vez con señal para descargar el formato.'
					: 'No se pudo cargar el formato. Intente de nuevo en unos minutos.';
			cargando = false;

			return;
		}

		// Los mapas de requisitos e infraestructura se llenan en cuanto hay
		// catálogos: sus claves salen de ahí y el formulario vacío no las conoce.
		datos = conValoresIniciales(datos, catalogos);

		evidencias = new GestorEvidencias({ INSPECCION: catalogos.limites.fotos }, borrador.clave);
		detenerEvidencias = evidencias.iniciar();

		const previo = leerBorrador();

		if (previo) {
			hayBorradorPrevio = true;
			borrador.clave = previo.clave;
		} else {
			datos.fecha_evaluacion = hoy();
			precargarProfesional();
			await precargarDesdeSolicitud();
		}

		cargando = false;
	}

	function continuarBorrador() {
		const previo = leerBorrador();
		if (!previo || !catalogos) return;

		// Un borrador guardado con una versión anterior puede no traer todas las
		// claves, y un catálogo que crezca traería claves nuevas a uno viejo.
		datos = conValoresIniciales(previo.datos, catalogos);
		const pos = pasosVigentes(datos, catalogos).findIndex((p) => p.id === previo.paso);
		indice = Math.max(1, pos);
		borrador.marcarRecuperado(previo.actualizado_en);
		hayBorradorPrevio = false;

		// Las fotos viven atadas a la clave del borrador, así que el gestor se
		// rehace con la clave recuperada antes de repoblar la lista.
		detenerEvidencias?.();
		evidencias = new GestorEvidencias({ INSPECCION: catalogos.limites.fotos }, borrador.clave);
		detenerEvidencias = evidencias.iniciar();
		void evidencias.restaurar();
	}

	function empezarDeNuevo() {
		void evidencias?.limpiar();
		descartarBorrador();
		enCola = false;
		enviado = null;
		datos = formularioVacio();
		datos.fecha_evaluacion = hoy();
		if (catalogos) datos = conValoresIniciales(datos, catalogos);
		precargarProfesional();
		indice = 0;
		hayBorradorPrevio = false;
		errores = {};
	}

	function alCambiar() {
		if (!catalogos || !paso) return;

		datos = limpiarCondicionales(datos, catalogos);
		borrador.programar(datos, paso.id);
	}

	/** Al elegir sistema constructivo, sugerir el kit que canta el material. */
	function alElegirCubierta() {
		alCambiar();
		if (!catalogos) return;

		const sugerido = kitSugerido(datos, catalogos);
		if (sugerido && datos.kit_cubierta === '') datos.kit_cubierta = sugerido;
	}

	/** ¿Ya se inspeccionó esta vivienda? Se avisa, no se impide. */
	async function revisarDuplicado() {
		avisoDuplicado = '';
		const doc = datos.propietario_documento.replace(/\D+/g, '');
		if (doc.length < 5) return;

		try {
			const { inspecciones } = await inspeccionApi.duplicados(doc);
			if (inspecciones.length > 0) {
				const ultima = inspecciones[0];
				avisoDuplicado = `Ya existe una inspección de este propietario (${ultima.numero}, del ${ultima.fecha_evaluacion}). Puede continuar si es una visita nueva.`;
			}
		} catch {
			// Sin señal no se puede comprobar. No es motivo para detener la visita.
		}
	}

	function siguiente() {
		if (!catalogos || !paso) return;

		const fallos = validarPaso(paso.id, datos, catalogos);
		errores = fallos;

		if (Object.keys(fallos).length > 0) {
			document.querySelector<HTMLElement>('[data-error]')?.scrollIntoView({ block: 'center' });

			return;
		}

		if (indice < pasos.length - 1) indice++;
		borrador.guardar(datos, pasos[indice].id);
	}

	function anterior() {
		if (indice > 0) indice--;
		errores = {};
	}

	function irAPaso(id: IdPaso) {
		const pos = pasos.findIndex((p) => p.id === id);
		if (pos >= 0) indice = pos;
	}

	async function enviar() {
		if (!catalogos || enviando) return;

		const fallos = validarTodo(datos, catalogos);
		errores = fallos;

		if (Object.keys(fallos).length > 0) {
			errorEnvio = 'Faltan datos por completar. Revise los pasos marcados.';
			irAPaso(pasoDelError(Object.keys(fallos)[0], datos, catalogos));

			return;
		}

		enviando = true;
		errorEnvio = '';

		try {
			const resumen = {
				evento: 'Inspección de vivienda',
				direccion:
					[datos.direccion_cabecera, datos.vereda, datos.corregimiento]
						.filter(Boolean)
						.join(' · ') || datos.propietario_nombres,
				personas: 0
			};

			const r = await envio.enviar(
				{
					...$state.snapshot(datos),
					envio_id: borrador.clave,
					...(preinscripcionId ? { preinscripcion_id: preinscripcionId } : {})
				},
				resumen,
				evidencias?.paraLaCola() ?? [],
				'INSPECCION'
			);

			if (r.estado === 'en-cola') {
				// No es un error ni un final: la inspección está a salvo en el
				// teléfono y saldrá sola. Quien está en la puerta de una casa puede
				// seguir con la siguiente sin esperar a que vuelva la señal.
				enCola = true;
				enviado = { numero: '', combo: null, motivo: null };
				descartarBorrador();

				return;
			}

			const respuesta = r.respuesta as unknown as {
				numero: string;
				combo: string | null;
				combo_motivo: string | null;
			};

			enviado = {
				numero: respuesta.numero,
				combo: respuesta.combo,
				motivo: respuesta.combo_motivo
			};
			descartarBorrador();
		} catch (e) {
			if (e instanceof ApiError) {
				errorEnvio = e.message;
				errores = e.errors;

				const primera = Object.keys(e.errors)[0];
				if (primera) irAPaso(pasoDelError(primera, datos, catalogos));
			} else {
				errorEnvio = 'No se pudo enviar la inspección. Intente de nuevo.';
			}
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head><title>Inspección de vivienda · SGR Jamundí</title></svelte:head>

<div class="contenedor">
	{#if cargando}
		<p class="cargando">
			<LoaderCircle size={20} class="girando" aria-hidden="true" />
			Cargando el formato…
		</p>
	{:else if errorCarga}
		<p class="aviso aviso--error" role="alert">
			<TriangleAlert size={16} aria-hidden="true" />
			{errorCarga}
		</p>
	{:else if enviado}
		<div class="tarjeta cierre">
			<CheckCircle2 size={40} aria-hidden="true" />
			{#if enCola}
				<h2>Inspección guardada</h2>
				<p class="cierre__motivo">
					No hay señal. Quedó guardada en este teléfono y se enviará sola en cuanto vuelva la
					conexión. Puede verla en <a href="/riesgo/pendientes">Pendientes</a>.
				</p>
			{:else}
				<h2>Inspección registrada</h2>
				<p class="cierre__numero">{enviado.numero}</p>
			{/if}

			{#if enviado.combo && !enCola}
				<p class="cierre__combo">
					Corresponde <strong>{enviado.combo.replace('_', ' ').toLowerCase()}</strong>.
				</p>
				<p class="cierre__motivo">{enviado.motivo}</p>
			{:else if !enCola}
				<p class="cierre__motivo">{enviado.motivo}</p>
			{/if}

			<div class="cierre__acciones">
				<button type="button" class="boton boton--principal" onclick={empezarDeNuevo}>
					Inspeccionar otra vivienda
				</button>
				<a class="boton boton--suave" href="/riesgo/inspecciones">Ver las inspecciones</a>
			</div>
		</div>
	{:else if catalogos && paso}
		{#if hayBorradorPrevio}
			<div class="tarjeta">
				<h2 class="tarjeta__titulo">Hay una inspección sin terminar</h2>
				<p class="tarjeta__nota">
					Se guardó en este teléfono y todavía no se ha enviado. Puede continuarla o empezar de nuevo.
				</p>
				<div class="acciones">
					<button type="button" class="boton boton--principal" onclick={continuarBorrador}>
						Continuar
					</button>
					<button type="button" class="boton boton--suave" onclick={empezarDeNuevo}>
						Empezar de nuevo
					</button>
				</div>
			</div>
		{:else}
			<div class="tarjeta">
				<IndicadorProgreso indice={avance} total={conProgreso.length} titulo={paso.titulo} />

				<EstadoAutoguardado
					estado={borrador.estado}
					guardadoEn={borrador.guardadoEn}
					{enLinea}
					texto={describirEstado(borrador.estado, borrador.guardadoEn)}
					sinConexion="Sin conexión. Su inspección está guardada en este dispositivo."
				/>

				<p class="tarjeta__nota">{paso.ayuda}</p>

				{#if paso.id === 'inicio'}
					{#if avisoPreinscripcion}
						<p class="aviso aviso--info" role="status">
							<CheckCircle2 size={15} aria-hidden="true" />
							{avisoPreinscripcion}
						</p>
					{/if}
					<div class="intro">
						<p>
							Este formato evalúa la vivienda para determinar qué le corresponde del <strong
								>banco de materiales</strong
							>. Lo diligencia el profesional responsable de la inspección.
						</p>
						<ul>
							<li>Se guarda solo en este teléfono mientras lo llena.</li>
							<li>
								Los criterios del <strong>Anexo 1</strong> aparecen al elegir cada nivel de daño: no
								hace falta la hoja impresa.
							</li>
							<li>El combo de materiales lo calcula el sistema a partir de su evaluación.</li>
						</ul>
					</div>
				{:else if paso.id === 'profesional'}
					<CampoTexto
						id="fecha_evaluacion"
						etiqueta="Fecha de la evaluación"
						tipo="date"
						bind:valor={datos.fecha_evaluacion}
						error={errores.fecha_evaluacion}
						requerido
						max={hoy()}
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="profesional_nombre"
						etiqueta="Nombre del profesional responsable"
						marcador="Ej.: Ana María Ruiz Cadavid"
						bind:valor={datos.profesional_nombre}
						error={errores.profesional_nombre}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoSelect
						id="profesional_profesion"
						etiqueta="Profesión"
						bind:valor={datos.profesional_profesion}
						opciones={opcionesProfesion}
						error={errores.profesional_profesion}
						requerido
						ayuda="Debe ser una profesión con tarjeta profesional que habilite para evaluar daño estructural."
						alCambiar={alCambiar}
					/>
					{#if muestraProfesionOtra(datos)}
						<CampoTexto
							id="profesional_profesion_otra"
							etiqueta="¿Cuál?"
							bind:valor={datos.profesional_profesion_otra}
							error={errores.profesional_profesion_otra}
							requerido
							maximo={120}
							marcador="Ej.: Ingeniera sanitaria"
							alCambiar={alCambiar}
						/>
					{/if}
					<CampoTexto
						id="profesional_tarjeta"
						etiqueta="Tarjeta profesional"
						marcador="Ej.: 76202-123456 VLL"
						bind:valor={datos.profesional_tarjeta}
						error={errores.profesional_tarjeta}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="profesional_documento"
						etiqueta="Cédula"
						modoTeclado="numeric"
						bind:valor={datos.profesional_documento}
						error={errores.profesional_documento}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="profesional_documento_de"
						etiqueta="Expedida en"
						marcador="Ej.: Cali"
						bind:valor={datos.profesional_documento_de}
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="profesional_telefono"
						etiqueta="Teléfono"
						tipo="tel"
						modoTeclado="tel"
						bind:valor={datos.profesional_telefono}
						error={errores.profesional_telefono}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="profesional_direccion"
						etiqueta="Dirección"
						marcador="Ej.: Calle 10 # 4-55"
						bind:valor={datos.profesional_direccion}
						alCambiar={alCambiar}
					/>
				{:else if paso.id === 'propietario'}
					<CampoTexto
						id="propietario_nombres"
						etiqueta="Nombres y apellidos"
						marcador="Ej.: Pedro Antonio Pérez Gómez"
						bind:valor={datos.propietario_nombres}
						error={errores.propietario_nombres}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="propietario_documento"
						etiqueta="Cédula"
						modoTeclado="numeric"
						bind:valor={datos.propietario_documento}
						error={errores.propietario_documento}
						requerido
						alCambiar={() => {
							alCambiar();
							void revisarDuplicado();
						}}
					/>

					{#if avisoDuplicado}
						<p class="aviso aviso--alerta" role="status">
							<TriangleAlert size={15} aria-hidden="true" />
							{avisoDuplicado}
						</p>
					{/if}

					<CampoTexto
						id="propietario_documento_de"
						etiqueta="Expedida en"
						marcador="Ej.: Jamundí"
						bind:valor={datos.propietario_documento_de}
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="propietario_telefono"
						etiqueta="Teléfono"
						tipo="tel"
						modoTeclado="tel"
						bind:valor={datos.propietario_telefono}
						error={errores.propietario_telefono}
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="propietario_direccion"
						etiqueta="Dirección"
						marcador="Ej.: Carrera 11 # 8-26"
						bind:valor={datos.propietario_direccion}
						alCambiar={alCambiar}
					/>
				{:else if paso.id === 'localizacion'}
					<p class="fijos">
						{catalogos.fijos.departamento} · {catalogos.fijos.municipio}
					</p>
					<CampoTexto
						id="direccion_cabecera"
						etiqueta="Dirección de la vivienda en cabecera municipal"
						marcador="Ej.: Carrera 11 # 8-26"
						bind:valor={datos.direccion_cabecera}
						error={errores.direccion_cabecera}
						ayuda="Si la vivienda es rural, deje esto vacío y llene corregimiento y vereda."
						alCambiar={alCambiar}
					/>
					<CampoSelect
						id="corregimiento"
						etiqueta="Corregimiento"
						bind:valor={datos.corregimiento}
						opciones={opcionesCorregimiento}
						error={errores.corregimiento}
						vacio="Ninguno (zona urbana)"
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="vereda"
						etiqueta="Vereda"
						marcador="Ej.: La Ventura"
						bind:valor={datos.vereda}
						alCambiar={alCambiar}
					/>

					<div class="ubicacion">
						<p class="ubicacion__titulo">Ubicación en el mapa (opcional)</p>
						<p class="ubicacion__ayuda">
							Tómela estando frente a la vivienda. Es lo que permite volver a encontrarla para
							entregar los materiales. Puede continuar sin ella.
						</p>

						{#if datos.latitud !== null}
							<p class="ubicacion__valor">
								<MapPin size={15} aria-hidden="true" />
								Ubicación tomada
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
				{:else if paso.id === 'requisitos'}
					<p class="tarjeta__nota">
						Los tres requisitos del numeral 3. De ellos depende que continúe la inspección.
					</p>

					{#each catalogos.requisitos as requisito (requisito.codigo)}
						<CampoOpciones
							id={`req-${requisito.codigo}`}
							etiqueta={requisito.etiqueta}
							bind:valor={datos.requisitos[requisito.codigo]}
							opciones={SI_NO}
							error={errores[`requisitos.${requisito.codigo}`]}
							requerido
							alCambiar={alCambiar}
						/>
					{/each}

					{#if cumple === false}
						<div class="aviso aviso--alerta" role="status">
							<TriangleAlert size={15} aria-hidden="true" />
							<span>
								<strong>No cumple los requisitos</strong> por:
								{incumplidos.join(' · ')}.
								<br />
								Según el formato, no se continúa con la inspección: se levanta el acta del numeral 8.
							</span>
						</div>
					{:else if cumple === true}
						<p class="aviso aviso--ok" role="status">
							<CheckCircle2 size={15} aria-hidden="true" />
							Cumple los requisitos. Continúa la inspección de la vivienda.
						</p>
					{/if}
				{:else if paso.id === 'evento'}
					<CampoOpciones
						id="evento"
						etiqueta="Tipo de evento que afectó la vivienda"
						bind:valor={datos.evento}
						opciones={opcionesEvento}
						error={errores.evento}
						requerido
						columnas
						alCambiar={alCambiar}
					/>
					{#if muestraEventoOtro(datos)}
						<CampoTexto
							id="evento_otro"
							etiqueta="¿Cuál?"
							bind:valor={datos.evento_otro}
							error={errores.evento_otro}
							requerido
							maximo={120}
							alCambiar={alCambiar}
						/>
					{/if}
				{:else if paso.id === 'sistema'}
					<CampoOpciones
						id="sistema_constructivo"
						etiqueta="Sistema constructivo de la vivienda"
						bind:valor={datos.sistema_constructivo}
						opciones={opcionesSistema}
						error={errores.sistema_constructivo}
						requerido
						ayuda="Decide qué elementos se evalúan y qué combos de materiales aplican."
						alCambiar={alCambiar}
					/>

					<p class="seccion">Infraestructura actual (numeral 5.3)</p>

					{#each Object.entries(catalogos.convenciones) as [categoria, conv] (categoria)}
						<CampoSelect
							id={`infra-${categoria}`}
							etiqueta={conv.etiqueta}
							bind:valor={datos.infraestructura[categoria]}
							opciones={Object.entries(conv.opciones).map(([codigo, etiqueta]) => ({
								valor: codigo,
								etiqueta: `(${codigo}) ${etiqueta}`
							}))}
							error={errores[`infraestructura.${categoria}`]}
							requerido
							alCambiar={() => {
								if (categoria === 'CUBIERTA') alElegirCubierta();
								else alCambiar();
							}}
						/>
					{/each}
				{:else if paso.id === 'evaluacion'}
					<CampoOpciones
						id="colapso_total"
						etiqueta="¿La vivienda sufrió colapso estructural total?"
						bind:valor={datos.colapso_total}
						opciones={SI_NO}
						ayuda="Si es así, no se llena la tabla por elementos: el formato dice marcar solo esta casilla."
						alCambiar={alCambiar}
					/>

					{#if muestraTablaDanos(datos)}
						<p class="seccion">Evaluación por elemento (numeral 5.4)</p>
						<TablaEvaluacion
							elementos={elementosDe(datos, catalogos)}
							bind:danos={datos.danos}
							{errores}
							alCambiar={alCambiar}
						/>
					{/if}

					<CampoOpciones
						id="requiere_evacuacion"
						etiqueta="¿Requiere evacuación la vivienda?"
						bind:valor={datos.requiere_evacuacion}
						opciones={SI_NO}
						error={errores.requiere_evacuacion}
						requerido
						alCambiar={alCambiar}
					/>
				{:else if paso.id === 'materiales'}
					<ResultadoCombo
						{resultado}
						{motivo}
						{explicacion}
						{materiales}
						kits={kitsCubiertaDe(datos, catalogos)}
						bind:kitCubierta={datos.kit_cubierta}
						sugerido={kitSugerido(datos, catalogos)}
						error={errores.kit_cubierta}
						alCambiar={alCambiar}
					/>
				{:else if paso.id === 'informante'}
					<p class="tarjeta__nota">
						Si el propietario no estaba en la vivienda, quien informa debe ser un familiar mayor de
						edad.
					</p>
					<CampoTexto
						id="informante_nombre"
						etiqueta="Nombre"
						marcador="Ej.: María Elena Pérez"
						bind:valor={datos.informante_nombre}
						error={errores.informante_nombre}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="informante_documento"
						etiqueta="Cédula"
						modoTeclado="numeric"
						bind:valor={datos.informante_documento}
						error={errores.informante_documento}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoSelect
						id="informante_parentesco"
						etiqueta="Parentesco con el propietario"
						bind:valor={datos.informante_parentesco}
						opciones={opcionesParentesco}
						error={errores.informante_parentesco}
						requerido
						numerico
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="informante_telefono"
						etiqueta="Teléfono"
						tipo="tel"
						modoTeclado="tel"
						bind:valor={datos.informante_telefono}
						error={errores.informante_telefono}
						alCambiar={alCambiar}
					/>
				{:else if paso.id === 'fotos'}
					{#if evidencias}
						<SubidaEvidencias
							gestor={evidencias}
							tipo="INSPECCION"
							titulo="Registro fotográfico"
							ayuda="Las diez casillas del numeral 11. Se guardan en el teléfono y salen solas cuando haya señal."
							textoCamara="Tomar foto"
							pieDeFoto={{
								etiqueta: 'Fotografía de',
								marcador: 'Ej.: fisura en muro de carga, fachada norte',
								maximo: catalogos.limites.descripcion_foto
							}}
						/>
					{/if}
				{:else if paso.id === 'acta'}
					<div class="aviso aviso--alerta" role="status">
						<TriangleAlert size={15} aria-hidden="true" />
						<span>
							No se cumplen los requisitos ({incumplidos.join(' · ')}), así que no puede accederse al
							apoyo en banco de materiales. Queda constancia con estos datos.
						</span>
					</div>

					<CampoOpciones
						id="acta_modalidad"
						etiqueta="El apoyo solicitado era para"
						bind:valor={datos.acta_modalidad}
						opciones={[
							{ valor: 'REHABILITACION', etiqueta: 'Rehabilitación de vivienda' },
							{ valor: 'CONSTRUCCION', etiqueta: 'Construcción de vivienda' }
						]}
						error={errores.acta_modalidad}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="acta_nombre"
						etiqueta="Nombre de quien queda enterado"
						marcador="Ej.: Pedro Antonio Pérez Gómez"
						bind:valor={datos.acta_nombre}
						error={errores.acta_nombre}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="acta_documento"
						etiqueta="Cédula"
						modoTeclado="numeric"
						bind:valor={datos.acta_documento}
						error={errores.acta_documento}
						requerido
						alCambiar={alCambiar}
					/>
					<CampoTexto
						id="acta_telefono"
						etiqueta="Teléfono"
						tipo="tel"
						modoTeclado="tel"
						bind:valor={datos.acta_telefono}
						error={errores.acta_telefono}
						alCambiar={alCambiar}
					/>
				{:else if paso.id === 'revision'}
					<dl class="resumen">
						<div><dt>Propietario</dt><dd>{datos.propietario_nombres}</dd></div>
						<div><dt>Cédula</dt><dd>{datos.propietario_documento}</dd></div>
						<div>
							<dt>Vivienda</dt>
							<dd>
								{[datos.direccion_cabecera, datos.vereda, datos.corregimiento]
									.filter(Boolean)
									.join(' · ') || '—'}
							</dd>
						</div>
						<div><dt>Fecha</dt><dd>{datos.fecha_evaluacion}</dd></div>
						{#if cumple === false}
							<div><dt>Resultado</dt><dd>No cumple requisitos — acta del numeral 8</dd></div>
						{:else}
							<div><dt>Sistema</dt><dd>{datos.sistema_constructivo || '—'}</dd></div>
							<div>
								<dt>Combo</dt>
								<dd>{resultado.etiqueta ?? 'No corresponde'}<br /><small>{motivo}</small></dd>
							</div>
						{/if}
					</dl>

					{#if errorEnvio}
						<p class="aviso aviso--error" role="alert" data-error>
							<TriangleAlert size={15} aria-hidden="true" />
							{errorEnvio}
						</p>
					{/if}
				{/if}

				<div class="navegacion">
					{#if indice > 0}
						<button type="button" class="boton boton--suave" onclick={anterior} disabled={enviando}>
							<ArrowLeft size={15} aria-hidden="true" />
							Atrás
						</button>
					{/if}

					{#if paso.id === 'revision'}
						<button type="button" class="boton boton--principal" onclick={enviar} disabled={enviando}>
							{#if enviando}
								<LoaderCircle size={15} class="girando" aria-hidden="true" />
								Enviando…
							{:else}
								<Send size={15} aria-hidden="true" />
								Enviar la inspección
							{/if}
						</button>
					{:else}
						<button type="button" class="boton boton--principal" onclick={siguiente}>
							{paso.id === 'inicio' ? 'Comenzar' : 'Siguiente'}
							<ArrowRight size={15} aria-hidden="true" />
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* El menú, la barra superior y el fondo los pone el armazón del sistema; aquí
	   solo se limita el ancho, igual que en el formulario del RUFE, para que las
	   dos pantallas de campo se vean iguales y las líneas no queden ilegibles en
	   un monitor de escritorio. */
	.contenedor {
		width: 100%;
		max-width: 44rem;
		margin: 0 auto;
	}

	.seccion {
		margin: 1.2rem 0 0.6rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted);
	}

	.fijos {
		margin: 0 0 0.8rem;
		font-size: 0.85rem;
		color: var(--color-muted);
	}

	.intro ul {
		margin: 0.6rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.88rem;
		line-height: 1.55;
	}

	.intro li + li {
		margin-top: 0.35rem;
	}

	.navegacion {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.4rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.navegacion .boton {
		flex: 1;
		justify-content: center;
		min-height: 2.9rem;
	}

	.resumen {
		margin: 0;
		display: grid;
		gap: 0.7rem;
	}

	.resumen div {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.6rem;
		font-size: 0.88rem;
	}

	.resumen dt {
		color: var(--color-muted);
	}

	.resumen dd {
		margin: 0;
	}

	.cierre {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--aviso-ok-texto);
	}

	.cierre h2 {
		margin: 0.6rem 0 0.3rem;
		font-size: 1.15rem;
	}

	.cierre__numero {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.cierre__combo,
	.cierre__motivo {
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.cierre__motivo {
		color: var(--color-muted);
		font-size: 0.83rem;
	}

	.cierre__acciones {
		display: flex;
		gap: 0.6rem;
		justify-content: center;
		flex-wrap: wrap;
		margin-top: 1.4rem;
	}

	@media (max-width: 480px) {
		.resumen div {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}
	}
</style>
