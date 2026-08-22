<script lang="ts">
	// Pre-inscripción ciudadana para la inspección de viviendas afectadas.
	//
	// La abre una persona que perdió parte de su casa, desde su celular, sola y
	// probablemente alterada. No tiene cuenta ni va a tenerla. Eso manda sobre
	// todas las decisiones de esta pantalla:
	//
	//  • Se pide lo mínimo para llegar a la casa y poder llamar. Cada campo de
	//    más es un motivo para abandonar el formulario a la mitad.
	//  • Nada de datos sensibles. Género, pertenencia étnica y composición del
	//    hogar los levanta el funcionario en la visita, explicando el aviso de
	//    viva voz, como manda la Ley 1581.
	//  • Por PASOS, como el censo. La versión anterior era una sola página con
	//    siete secciones, y el argumento escrito entonces era que así se veía de
	//    un vistazo todo lo que se iba a preguntar. En un celular ese vistazo no
	//    existe: es un rollo largo donde no se sabe cuánto falta y donde un error
	//    de validación al final obliga a subir a buscarlo. El censo lleva meses
	//    en producción con pasos y es el patrón que la gente de aquí reconoce.
	//
	// Y lo que esto NO es: una inspección. Es una solicitud de turno. La
	// evaluación del daño y el combo de materiales siguen siendo del profesional
	// con tarjeta. Por eso el paso 2 pregunta QUÉ VE la persona y no en qué nivel
	// del Anexo 1 clasificaría su casa.

	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, MapPin, Send, TriangleAlert
	} from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { preinscripcionApi } from '$lib/api/servicios';
	import logo from '$lib/assets/logo-jamundi.svg';
	import IndicadorProgreso from '$lib/rufe-form/componentes/IndicadorProgreso.svelte';
	import SubidaEvidencias from '$lib/rufe-form/componentes/SubidaEvidencias.svelte';
	import { GestorEvidencias, RUTAS_PUBLICAS_CARGA } from '$lib/rufe-form/evidencias.svelte';
	import GrabadorVideo from '$lib/preinscripcion/GrabadorVideo.svelte';
	import SelectorSenales from '$lib/preinscripcion/SelectorSenales.svelte';
	import AutorizacionDatos from '$lib/preinscripcion/AutorizacionDatos.svelte';
	import {
		bloqueoDeAvance,
		datosVacios,
		paraEnviar,
		pasosVigentes,
		validarPaso
	} from '$lib/preinscripcion/pasos';

	type Catalogos = Awaited<ReturnType<typeof preinscripcionApi.catalogos>>;

	let catalogos = $state<Catalogos | null>(null);
	let cargando = $state(true);
	let errorCarga = $state('');

	let enviando = $state(false);
	let errorEnvio = $state('');
	let errores = $state<Record<string, string>>({});
	let resultado = $state<{
		radicado: string;
		duplicada?: boolean;
		archivosAgregados?: number;
	} | null>(null);

	// Las fotos comparten toda la maquinaria del censo —compresión en el
	// teléfono, cola, reintento— apuntando a las rutas públicas. La original
	// nunca sale del aparato: lo que sube es siempre la versión optimizada.
	let evidencias = $state<GestorEvidencias | null>(null);
	let detenerEvidencias: (() => void) | null = null;

	/**
	 * Qué categorías ya tienen su video.
	 *
	 * No bloquea el envío ni siquiera para las obligatorias: quien tiene un
	 * celular viejo o una conexión mala no puede quedarse sin turno por eso. Lo
	 * que falta se marca en la bandeja, para que quien revisa lo sepa.
	 */
	let videosListos = $state<number[]>([]);

	/**
	 * Qué videos están subiendo en este momento.
	 *
	 * Enviar el formulario con uno a medias lo PIERDE: llega incompleto al
	 * servidor y allí se descarta, así que la persona vería «Solicitud
	 * registrada» y su video no existiría en ningún sitio. Es el mismo cuidado
	 * que ya se tenía con las fotos a medio optimizar.
	 */
	let videosSubiendo = $state<number[]>([]);

	function marcarSubiendo(categoriaId: number, subiendo: boolean) {
		videosSubiendo = subiendo
			? [...videosSubiendo.filter((c) => c !== categoriaId), categoriaId]
			: videosSubiendo.filter((c) => c !== categoriaId);
	}

	let ubicando = $state(false);
	let avisoUbicacion = $state<string | null>(null);

	// Identificador estable de este envío: si la solicitud entra pero la
	// respuesta se pierde por mala señal, reintentar devuelve el mismo radicado
	// en vez de inscribir dos veces a la misma familia.
	const envioId = crypto.randomUUID();

	let datos = $state(datosVacios());

	let indice = $state(0);

	const hayVideos = $derived((catalogos?.categorias_video ?? []).length > 0);
	const pasos = $derived(pasosVigentes(hayVideos));
	const paso = $derived(pasos[Math.min(indice, pasos.length - 1)]);
	const esPrimero = $derived(indice === 0);
	const esUltimo = $derived(indice === pasos.length - 1);

	onMount(() => {
		void (async () => {
			try {
				catalogos = await preinscripcionApi.catalogos();

				evidencias = new GestorEvidencias(
					{
						PRE_CEDULA: catalogos.limites.fotos_cedula,
						PRE_DANO: catalogos.limites.fotos_dano
					},
					// La clave del borrador es este envío: las fotos viven atadas a
					// él y no se mezclan con las de otra solicitud del mismo aparato.
					`preinscripcion-${envioId}`,
					RUTAS_PUBLICAS_CARGA
				);
				detenerEvidencias = evidencias.iniciar();

				// Los videos van en la MISMA carga que las fotos, y la carga se abre
				// sola al subir la primera foto. Si alguien solo graba videos, esa
				// carga no existiría y se perderían: se abre aquí.
				if ((catalogos.categorias_video ?? []).length > 0) {
					try {
						evidencias.carga = (await preinscripcionApi.abrirCarga()).carga;
					} catch {
						// Sin señal no hay carga y no habrá videos. La solicitud sigue
						// pudiendo enviarse, que es lo que importa.
					}
				}
			} catch {
				errorCarga = 'No se pudo cargar el formulario. Revise su conexión e intente de nuevo.';
			} finally {
				cargando = false;
			}
		})();

		return () => detenerEvidencias?.();
	});

	// ── Navegación ──────────────────────────────────────────────────────────

	function siguiente() {
		const fallos = validarPaso(paso.id, datos);
		errores = fallos;
		if (Object.keys(fallos).length > 0) {
			subirAlInicio();

			return;
		}

		// Avanzar con una foto a medio optimizar o un video a medio subir dejaría
		// a la persona creyendo que ya los mandó. La regla vive en `pasos.ts`.
		const bloqueo = bloqueoDeAvance({
			optimizandoFotos: evidencias?.optimizando ?? false,
			videosSubiendo: videosSubiendo.length
		});

		if (bloqueo) {
			errorEnvio = bloqueo;

			return;
		}

		errorEnvio = '';
		indice = Math.min(indice + 1, pasos.length - 1);
		subirAlInicio();
	}

	function anterior() {
		errores = {};
		errorEnvio = '';
		indice = Math.max(indice - 1, 0);
		subirAlInicio();
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
				avisoUbicacion = 'Ubicación agregada. Así podremos encontrar su vivienda.';
			},
			() => {
				ubicando = false;
				avisoUbicacion =
					'No se pudo obtener la ubicación. Puede continuar: con la dirección escrita es suficiente.';
			},
			{ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
		);
	}

	function quitarUbicacion() {
		datos.latitud = null;
		datos.longitud = null;
		datos.precision_m = null;
		avisoUbicacion = 'Ubicación retirada.';
	}

	// ── Envío ───────────────────────────────────────────────────────────────

	/** Los campos que se corrigen en el paso 1, para saber a dónde devolver. */
	const CAMPOS_PASO_1 = [
		'nombre_completo',
		'documento',
		'telefono',
		'correo',
		'direccion',
		'zona',
		'corregimiento'
	];

	async function enviar() {
		if (!catalogos || enviando) return;

		const fallos = validarPaso('envio', datos);
		errores = fallos;
		if (Object.keys(fallos).length > 0) return;

		// La última barrera, y la que de verdad importa: el paso de video queda
		// atrás y nada impide llegar hasta aquí con una subida todavía en curso.
		const bloqueo = bloqueoDeAvance({
			optimizandoFotos: evidencias?.optimizando ?? false,
			videosSubiendo: videosSubiendo.length
		});

		if (bloqueo) {
			errorEnvio = bloqueo;
			subirAlInicio();

			return;
		}

		enviando = true;
		errorEnvio = '';

		try {
			const r = await preinscripcionApi.enviar({
				...paraEnviar(datos),
				envio_id: envioId,
				aviso_version: catalogos.aviso_version,
				// El servidor adopta las fotos de esta carga al recibir la
				// solicitud; sin el token quedarían huérfanas hasta caducar.
				...(evidencias?.carga ? { carga: evidencias.carga } : {})
			});

			resultado = {
				radicado: r.radicado,
				duplicada: r.duplicada,
				archivosAgregados: r.archivos_agregados
			};
			subirAlInicio();
		} catch (e) {
			if (e instanceof ApiError) {
				errorEnvio = e.message;
				errores = e.errors;

				// Un error en un campo del paso 1 no se puede corregir desde el
				// paso 4. Se devuelve a la persona a donde está el campo, en vez
				// de dejarla mirando un mensaje sobre algo que no tiene delante.
				if (Object.keys(e.errors).some((c) => CAMPOS_PASO_1.includes(c))) {
					indice = 0;
				}
			} else {
				errorEnvio = 'No se pudo enviar su solicitud. Intente de nuevo en unos minutos.';
			}

			subirAlInicio();
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head>
	<title>Pre-inscripción · Inspección de viviendas afectadas · Jamundí</title>
	<meta
		name="description"
		content="Registre su vivienda afectada para que la Alcaldía de Jamundí programe una inspección."
	/>
</svelte:head>

<div class="pagina">
	<header class="marca">
		<img src={logo} alt="" aria-hidden="true" />
		<div>
			<p class="marca__entidad">Alcaldía de Jamundí</p>
			<h1 class="marca__titulo">Pre-inscripción para inspección de vivienda</h1>
		</div>
	</header>

	{#if cargando}
		<p class="cargando"><LoaderCircle size={18} class="girando" aria-hidden="true" /> Cargando…</p>
	{:else if errorCarga}
		<p class="aviso aviso--error" role="alert">{errorCarga}</p>
	{:else if resultado}
		<!-- El radicado es lo único que la familia se lleva. Se muestra grande y
		     se pide anotarlo: no hay consulta en línea por radicado, a propósito. -->
		<div class="tarjeta cierre">
			<CheckCircle2 size={40} aria-hidden="true" />
			<h2>
				{resultado.duplicada ? 'Su vivienda ya estaba registrada' : 'Solicitud registrada'}
			</h2>
			<p class="cierre__radicado">{resultado.radicado}</p>
			<p>
				{#if resultado.duplicada}
					Ya teníamos una solicitud para esta vivienda y esta cédula, así que conserva el mismo
					número. No hace falta volver a registrarse.
					{#if resultado.archivosAgregados}
						<!-- Decirlo importa: quien vuelve a inscribirse suele hacerlo justamente
						     porque esta vez sí pudo tomar las fotos o grabar el video, y si solo
						     lee «ya estaba registrada» se queda creyendo que no sirvió de nada. -->
						<strong>
							{resultado.archivosAgregados === 1
								? 'El archivo que acaba de enviar se agregó a su solicitud.'
								: `Los ${resultado.archivosAgregados} archivos que acaba de enviar se agregaron a su solicitud.`}
						</strong>
					{/if}
				{:else}
					Anote este número. Es el que debe dar si llama a preguntar por su solicitud.
				{/if}
			</p>
			<p class="cierre__nota">
				Un profesional de la Alcaldía revisará su caso y lo contactará al teléfono que registró para
				programar la visita. <strong>Registrarse no garantiza por sí solo la entrega de
				materiales</strong>: eso lo decide la inspección técnica de la vivienda.
			</p>
		</div>
	{:else if catalogos}
		<IndicadorProgreso indice={indice + 1} total={pasos.length} titulo={paso.titulo} />

		<p class="ayuda-paso">{paso.ayuda}</p>

		{#if errorEnvio}
			<p class="aviso aviso--error" role="alert">
				<TriangleAlert size={15} aria-hidden="true" />
				{errorEnvio}
			</p>
		{/if}

		<!-- ── Paso 1: sus datos ───────────────────────────────────────── -->
		{#if paso.id === 'datos'}
			<section class="tarjeta">
				<h2 class="tarjeta__titulo">Quién es</h2>

				<label class="campo">
					<span class="campo__etiqueta">Nombre y apellidos *</span>
					<input class="campo__control" bind:value={datos.nombre_completo} autocomplete="name" />
					{#if errores.nombre_completo}
						<span class="campo__error">{errores.nombre_completo}</span>
					{/if}
				</label>

				<label class="campo">
					<span class="campo__etiqueta">Cédula *</span>
					<input
						class="campo__control"
						inputmode="numeric"
						bind:value={datos.documento}
						placeholder="Sin puntos ni espacios"
					/>
					{#if errores.documento}<span class="campo__error">{errores.documento}</span>{/if}
				</label>

				<label class="campo">
					<span class="campo__etiqueta">Teléfono *</span>
					<input
						class="campo__control"
						type="tel"
						inputmode="tel"
						bind:value={datos.telefono}
						autocomplete="tel"
					/>
					<span class="campo__ayuda">A este número lo llamaremos para coordinar la visita.</span>
					{#if errores.telefono}<span class="campo__error">{errores.telefono}</span>{/if}
				</label>

				<label class="campo">
					<span class="campo__etiqueta">Correo electrónico</span>
					<input class="campo__control" type="email" bind:value={datos.correo} autocomplete="email" />
					<span class="campo__ayuda">
						Opcional. Déjelo en blanco si no tiene o no lo recuerda: no hace falta para su
						solicitud.
					</span>
					{#if errores.correo}<span class="campo__error">{errores.correo}</span>{/if}
				</label>
			</section>

			<section class="tarjeta">
				<h2 class="tarjeta__titulo">Dónde queda la vivienda</h2>

				<!--
					La zona se PREGUNTA, no se deduce del corregimiento. Antes se
					deducía y la deducción era falsa: quien vive en el campo y no sabe
					a qué corregimiento pertenece su vereda entraba como urbano, y la
					visita salía a buscarlo al pueblo.
				-->
				<fieldset class="campo grupo" role="radiogroup" aria-required="true">
					<legend class="campo__etiqueta">¿La vivienda está en zona urbana o rural? *</legend>

					<div class="opciones opciones--dos">
						<label class="opcion" class:opcion--activa={datos.zona === 'URBANA'}>
							<input
								type="radio"
								name="zona"
								value="URBANA"
								checked={datos.zona === 'URBANA'}
								onchange={() => (datos.zona = 'URBANA')}
							/>
							<span class="opcion__texto">
								Urbana
								<span class="opcion__nota">En la cabecera del municipio</span>
							</span>
						</label>

						<label class="opcion" class:opcion--activa={datos.zona === 'RURAL'}>
							<input
								type="radio"
								name="zona"
								value="RURAL"
								checked={datos.zona === 'RURAL'}
								onchange={() => (datos.zona = 'RURAL')}
							/>
							<span class="opcion__texto">
								Rural
								<span class="opcion__nota">En un corregimiento o vereda</span>
							</span>
						</label>
					</div>

					{#if errores.zona}<span class="campo__error">{errores.zona}</span>{/if}
				</fieldset>

				<label class="campo">
					<span class="campo__etiqueta">Dirección o cómo llegar *</span>
					<textarea
						class="campo__control"
						rows="2"
						maxlength="200"
						bind:value={datos.direccion}
						placeholder="Carrera 11 # 8-26 — o bien: la casa azul pasando el puente, al lado de la tienda"
					></textarea>
					<span class="campo__ayuda">
						Escríbala como se la explicaría a alguien que va a buscarla. Si no tiene nomenclatura,
						sirven las referencias.
					</span>
					{#if errores.direccion}<span class="campo__error">{errores.direccion}</span>{/if}
				</label>

				{#if datos.zona === 'RURAL'}
					<label class="campo">
						<span class="campo__etiqueta">Corregimiento</span>
						<select class="campo__control" bind:value={datos.corregimiento}>
							<option value="">No lo sé</option>
							{#each catalogos.corregimientos as c (c)}
								<option value={c}>{c}</option>
							{/each}
						</select>
						<span class="campo__ayuda">Si no sabe cuál es, déjelo así y siga.</span>
						{#if errores.corregimiento}
							<span class="campo__error">{errores.corregimiento}</span>
						{/if}
					</label>
				{/if}

				<label class="campo">
					<span class="campo__etiqueta">{datos.zona === 'RURAL' ? 'Vereda' : 'Barrio'}</span>
					<input class="campo__control" bind:value={datos.vereda} />
				</label>

				<div class="ubicacion">
					<p class="ubicacion__titulo">Ubicación en el mapa (opcional)</p>
					<p class="ubicacion__ayuda">
						Si está en la vivienda ahora, tomar la ubicación nos ayuda mucho a encontrarla. Puede
						continuar sin ella.
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

					<p class="ubicacion__estado" role="status" aria-live="polite">{avisoUbicacion ?? ''}</p>
				</div>
			</section>

			{#if evidencias}
				<!-- La cédula va aquí y no al final: es un dato de identidad, y este
				     es el momento en que la persona la tiene a mano. -->
				<section class="tarjeta">
					<SubidaEvidencias
						gestor={evidencias}
						tipo="PRE_CEDULA"
						titulo="Foto de su cédula"
						ayuda="Del lado de los datos, sobre una superficie plana y sin reflejos. Nos sirve para confirmar que la solicitud es suya. La foto se reduce en su celular antes de enviarse."
						textoCamara="Tomar foto de la cédula"
					/>
				</section>
			{/if}

		<!-- ── Paso 2: cómo quedó la vivienda ──────────────────────────── -->
		{:else if paso.id === 'vivienda'}
			<section class="tarjeta">
				<SelectorSenales
					senales={catalogos.senales}
					bind:marcadas={datos.senales}
					error={errores.senales ?? ''}
				/>
			</section>

			<section class="tarjeta">
				<h2 class="tarjeta__titulo">¿Quiere contarnos algo más?</h2>

				<label class="campo">
					<span class="campo__etiqueta">Con sus palabras</span>
					<textarea
						class="campo__control"
						rows="4"
						maxlength="1000"
						bind:value={datos.descripcion_dano}
						placeholder="Ej.: se agrietaron los muros de la sala y se cayó parte del techo de la cocina."
					></textarea>
					<span class="campo__ayuda">
						Opcional. No hace falta que sea técnico: es para entender mejor su caso.
					</span>
					{#if errores.descripcion_dano}
						<span class="campo__error">{errores.descripcion_dano}</span>
					{/if}
				</label>
			</section>

			{#if evidencias}
				<section class="tarjeta">
					<SubidaEvidencias
						gestor={evidencias}
						tipo="PRE_DANO"
						titulo="Fotos del daño"
						ayuda="Cómo quedó la vivienda. No son obligatorias, pero ayudan a priorizar la visita. Se reducen en su celular antes de enviarse, así que gastan pocos datos."
						textoCamara="Tomar foto del daño"
					/>
				</section>
			{/if}

		<!-- ── Paso 3: los videos ──────────────────────────────────────── -->
		{:else if paso.id === 'video'}
			<section class="tarjeta">
				<p class="tarjeta__nota">
					Grabe cada uno siguiendo la indicación. Se cortan solos al llegar al máximo y puede
					repetirlos antes de enviarlos. <strong>Si no puede grabar alguno, continúe igual</strong>:
					no perderá su turno por eso.
				</p>

				{#each catalogos.categorias_video as c (c.id)}
					<GrabadorVideo
						categoria={c}
						carga={evidencias?.carga ?? null}
						alSubir={(id) => (videosListos = [...videosListos, id])}
						alSubiendo={marcarSubiendo}
					/>
				{/each}
			</section>

		<!-- ── Paso 4: autorización y envío ────────────────────────────── -->
		{:else if paso.id === 'envio'}
			<section class="tarjeta">
				<h2 class="tarjeta__titulo">Lo que va a enviar</h2>

				<dl class="resumen">
					<div><dt>Nombre</dt><dd>{datos.nombre_completo || '—'}</dd></div>
					<div><dt>Cédula</dt><dd>{datos.documento || '—'}</dd></div>
					<div><dt>Teléfono</dt><dd>{datos.telefono || '—'}</dd></div>
					<div>
						<dt>Vivienda</dt>
						<dd>
							{datos.direccion || '—'}
							{#if datos.vereda}· {datos.vereda}{/if}
							{#if datos.zona === 'RURAL' && datos.corregimiento}· {datos.corregimiento}{/if}
							{#if datos.zona}({datos.zona === 'RURAL' ? 'zona rural' : 'zona urbana'}){/if}
						</dd>
					</div>
					<div>
						<dt>Daños marcados</dt>
						<dd>
							{#if datos.senales.length === 0}
								Ninguno
							{:else}
								{catalogos.senales
									.filter((s) => datos.senales.includes(s.codigo))
									.map((s) => s.etiqueta)
									.join(', ')}
							{/if}
						</dd>
					</div>
				</dl>

				<button type="button" class="volver" onclick={() => (indice = 0)}>
					Corregir mis datos
				</button>
			</section>

			<section class="tarjeta">
				<h2 class="tarjeta__titulo">Autorización de datos</h2>
				<AutorizacionDatos
					bind:aceptado={datos.autoriza_datos}
					error={errores.autoriza_datos ?? ''}
				/>
			</section>
		{/if}

		<!-- Trampa antirrobot. Oculta y fuera del orden de tabulación. -->
		<div class="trampa" aria-hidden="true">
			<label for="sitio_web">No llene este campo</label>
			<input
				id="sitio_web"
				name="sitio_web"
				tabindex="-1"
				autocomplete="off"
				bind:value={datos.sitio_web}
			/>
		</div>

		<nav class="navegacion" aria-label="Navegación del formulario">
			{#if !esPrimero}
				<button type="button" class="boton boton--suave" onclick={anterior} disabled={enviando}>
					<ArrowLeft size={16} aria-hidden="true" />
					Atrás
				</button>
			{/if}

			{#if esUltimo}
				<button type="button" class="boton boton--enviar" onclick={enviar} disabled={enviando}>
					{#if enviando}
						<LoaderCircle size={16} class="girando" aria-hidden="true" />
						Enviando…
					{:else}
						<Send size={16} aria-hidden="true" />
						Enviar mi solicitud
					{/if}
				</button>
			{:else}
				<button type="button" class="boton" onclick={siguiente}>
					Siguiente
					<ArrowRight size={16} aria-hidden="true" />
				</button>
			{/if}
		</nav>
	{/if}
</div>

<style>
	.pagina {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1.2rem 1rem 3rem;
	}

	.marca {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-bottom: 1.2rem;
	}

	.marca img {
		width: 44px;
		height: 44px;
		flex: none;
	}

	.marca__entidad {
		margin: 0;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
	}

	.marca__titulo {
		margin: 0.1rem 0 0;
		font-size: 1.15rem;
		line-height: 1.25;
	}

	.ayuda-paso {
		margin: 0.6rem 0 1rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.cargando {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-muted);
	}

	section.tarjeta {
		margin-bottom: 1rem;
	}

	.grupo {
		border: 0;
		padding: 0;
		margin: 0 0 0.9rem;
		min-width: 0;
	}

	.grupo legend {
		padding: 0;
	}

	/* Dos columnas solo cuando hay sitio, como en el censo. */
	@media (min-width: 560px) {
		.opciones--dos {
			grid-template-columns: 1fr 1fr;
		}
	}

	.resumen {
		display: grid;
		gap: 0.55rem;
		margin: 0;
		font-size: 0.87rem;
	}

	.resumen div {
		display: grid;
		grid-template-columns: 8.5rem 1fr;
		gap: 0.5rem;
	}

	.resumen dt {
		color: var(--color-muted);
	}

	.resumen dd {
		margin: 0;
		line-height: 1.4;
	}

	.volver {
		margin-top: 0.9rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.83rem;
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.navegacion {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.6rem;
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

	.cierre {
		text-align: center;
		padding: 2rem 1.2rem;
		color: var(--color-success);
	}

	.cierre h2 {
		margin: 0.6rem 0 0.2rem;
		color: var(--color-text);
	}

	.cierre p {
		color: var(--color-text);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.cierre__radicado {
		margin: 0.8rem 0;
		font-family: ui-monospace, 'SFMono-Regular', monospace;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--color-text) !important;
	}

	.cierre__nota {
		margin-top: 1rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.83rem !important;
		color: var(--color-muted) !important;
	}

	/* Fuera de la pantalla, no `display:none`: algunos robots ignoran lo que no
	   se dibuja, y así el campo sigue existiendo para ellos. */
	.trampa {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
</style>
