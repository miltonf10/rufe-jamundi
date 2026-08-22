<script lang="ts">
	// Detalle de una inspección y su aprobación.
	//
	// Es la pantalla que faltaba. Sin ella el numeral 11 no se podía consultar,
	// la ubicación tomada en campo no se veía en ninguna parte y —lo más grave—
	// la aprobación se firmaba dentro del propio formulario: quien levantaba la
	// ficha la aprobaba en el mismo acto, de pie en la puerta de una casa, y de
	// esa ficha depende una entrega de materiales públicos.
	//
	// Ahora la decisión ocurre aquí, después, como el Vo.Bo. del censo: quién,
	// cuándo y con qué nota, todo en el historial. Los botones se ocultan a quien
	// no tiene el rol, pero eso es cortesía: el permiso de verdad lo aplica el
	// router de PHP y una llamada directa devuelve 403 igual.

	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ArrowLeft, Check, LoaderCircle, MapPin, TriangleAlert } from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { inspeccionApi } from '$lib/api/servicios';
	import { sesion } from '$lib/stores/sesion.svelte';
	import { ESCRITURA } from '$lib/navigation';
	import VisorEvidencias from '$lib/components/VisorEvidencias.svelte';
	import { fechaHora, soloFecha } from '$lib/formato';
	import type { DetalleInspeccion } from '$lib/inspeccion-form/detalle';

	let detalle = $state<DetalleInspeccion | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let exito = $state<string | null>(null);

	let nuevoEstado = $state('');
	let nota = $state('');
	let guardando = $state(false);
	let erroresCampo = $state<Record<string, string>>({});

	const id = $derived(Number(page.params.id));
	const puedeDecidir = $derived(!!sesion.rol && ESCRITURA.includes(sesion.rol));

	const ESTADOS = [
		{ codigo: 'EN_VALIDACION', etiqueta: 'En validación', nota: 'Se está revisando la inspección.' },
		{ codigo: 'APROBADA', etiqueta: 'Aprobada', nota: 'Autoriza la entrega del combo de materiales.' },
		{ codigo: 'RECHAZADA', etiqueta: 'Rechazada', nota: 'Requiere explicar el motivo.' },
		{ codigo: 'ARCHIVADA', etiqueta: 'Archivada', nota: 'Se cierra sin más trámite.' }
	];

	const ETIQUETA_ESTADO: Record<string, string> = {
		RECIBIDA: 'Recibida',
		EN_VALIDACION: 'En validación',
		APROBADA: 'Aprobada',
		RECHAZADA: 'Rechazada',
		ARCHIVADA: 'Archivada'
	};

	// Rechazar sin decir por qué deja al profesional sin saber qué corregir y
	// obliga a una llamada que se podía haber ahorrado. El servidor lo exige
	// igual; esto solo evita el viaje.
	const faltaMotivo = $derived(nuevoEstado === 'RECHAZADA' && nota.trim() === '');

	const i = $derived(detalle?.inspeccion ?? null);

	const lugar = $derived(
		i ? [i.direccion_cabecera, i.vereda, i.corregimiento].filter(Boolean).join(' · ') || '—' : '—'
	);

	onMount(cargar);

	async function cargar() {
		cargando = true;
		error = null;

		try {
			detalle = await inspeccionApi.ver(id);
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo cargar la inspección.';
		} finally {
			cargando = false;
		}
	}

	async function decidir() {
		if (!nuevoEstado || guardando || faltaMotivo) return;

		guardando = true;
		error = null;
		exito = null;
		erroresCampo = {};

		try {
			await inspeccionApi.cambiarEstado(id, nuevoEstado, nota);
			exito = 'El estado de la inspección se actualizó.';
			nuevoEstado = '';
			nota = '';
			await cargar();
		} catch (e) {
			if (e instanceof ApiError) {
				error = e.message;
				erroresCampo = e.errors;
			} else {
				error = 'No se pudo aplicar la decisión.';
			}
		} finally {
			guardando = false;
		}
	}
</script>

<svelte:head><title>Inspección · SGR Jamundí</title></svelte:head>

<a class="volver" href="/riesgo/inspecciones">
	<ArrowLeft size={15} aria-hidden="true" />
	Volver a las inspecciones
</a>

{#if cargando}
	<p class="cargando"><LoaderCircle size={18} class="girando" aria-hidden="true" /> Cargando…</p>
{:else if error && !detalle}
	<p class="aviso aviso--error" role="alert">{error}</p>
{:else if detalle && i}
	{#if error}<p class="aviso aviso--error" role="alert">{error}</p>{/if}
	{#if exito}<p class="aviso aviso--exito" role="status">{exito}</p>{/if}

	<div class="tarjeta">
		<header class="encabezado">
			<div>
				<p class="numero">{i.numero}</p>
				<h1 class="tarjeta__titulo">{i.propietario_nombres}</h1>
				<p class="fecha">Evaluada el {soloFecha(i.fecha_evaluacion)}</p>
			</div>
			<span class="pastilla">{ETIQUETA_ESTADO[i.estado] ?? i.estado}</span>
		</header>

		{#if !i.cumple_requisitos}
			<p class="aviso aviso--alerta" role="note">
				<TriangleAlert size={15} aria-hidden="true" />
				No cumple los requisitos del numeral 3, así que no accede al banco de materiales. La ficha
				es el acta del numeral 8.
			</p>
		{/if}

		<dl class="datos">
			<div><dt>Profesional</dt><dd>{i.profesional_nombre} · {i.profesional_profesion}</dd></div>
			<div><dt>Tarjeta profesional</dt><dd>{i.profesional_tarjeta}</dd></div>
			<div><dt>Cédula del propietario</dt><dd>{i.propietario_documento}</dd></div>
			<div><dt>Teléfono</dt><dd>{i.propietario_telefono || '—'}</dd></div>
			<div><dt>Municipio</dt><dd>{i.municipio}, {i.departamento}</dd></div>
			<div><dt>Vivienda</dt><dd>{lugar}</dd></div>

			{#if i.latitud !== null && i.longitud !== null}
				<div>
					<dt>Coordenadas</dt>
					<dd>
						<!-- El punto que se tomó frente a la casa. Es lo que permite volver
						     a encontrarla para entregar los materiales. -->
						<a
							href="https://www.openstreetmap.org/?mlat={i.latitud}&mlon={i.longitud}#map=18/{i.latitud}/{i.longitud}"
							target="_blank"
							rel="noopener noreferrer"
						>
							<MapPin size={13} aria-hidden="true" />
							{i.latitud}, {i.longitud}
							{#if i.precision_m}(±{i.precision_m} m){/if}
						</a>
					</dd>
				</div>
			{/if}

			{#if i.evento}
				<div><dt>Evento</dt><dd>{i.evento_otro || i.evento}</dd></div>
			{/if}
			{#if i.sistema_constructivo}
				<div><dt>Sistema constructivo</dt><dd>{i.sistema_constructivo}</dd></div>
			{/if}
			{#if i.requiere_evacuacion !== null}
				<div>
					<dt>¿Requiere evacuación?</dt>
					<dd>{i.requiere_evacuacion ? 'Sí' : 'No'}</dd>
				</div>
			{/if}
			{#if i.informante_nombre}
				<div>
					<dt>Informó</dt>
					<dd>
						{i.informante_nombre}
						{#if detalle.parentesco}· {detalle.parentesco}{/if}
					</dd>
				</div>
			{/if}
			<div><dt>Recibida</dt><dd>{fechaHora(i.creado_en)}</dd></div>
		</dl>
	</div>

	{#if detalle.danos.length > 0}
		<div class="tarjeta">
			<h2 class="tarjeta__titulo">Evaluación técnica (numeral 5.4)</h2>
			<div class="tabla-envoltura">
				<table class="tabla">
					<thead>
						<tr>
							<th scope="col">Elemento</th>
							<th scope="col">¿Afectado?</th>
							<th scope="col">Nivel</th>
						</tr>
					</thead>
					<tbody>
						{#each detalle.danos as d (d.elemento)}
							<tr>
								<td>{d.etiqueta}</td>
								<td>{d.afectado ? 'Sí' : 'No'}</td>
								<td>{d.etiqueta_nivel ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<div class="tarjeta">
		<h2 class="tarjeta__titulo">Banco de materiales (numeral 6)</h2>

		{#if i.combo}
			<p class="combo">{i.combo}</p>
			{#if i.combo_motivo}<p class="combo__motivo">{i.combo_motivo}</p>{/if}
			{#if i.kit_cubierta}<p class="combo__kit">Kit de cubierta: {i.kit_cubierta}</p>{/if}
		{:else}
			<p class="tarjeta__nota">No corresponde combo de materiales.</p>
		{/if}

		<!--
			La lista GUARDADA, no una recalculada. Si la norma cambió desde que se
			hizo la inspección, el expediente tiene que seguir diciendo qué se
			entregó entonces y por qué.
		-->
		{#if detalle.materiales && !detalle.materiales.sin_lista}
			{#each detalle.materiales.kits as kit (kit.kit)}
				<div class="kit">
					<p class="kit__nombre">{kit.kit}</p>
					<div class="tabla-envoltura">
						<table class="tabla">
							<thead>
								<tr>
									<th scope="col">Descripción</th>
									<th scope="col">Und</th>
									<th scope="col" class="num">Cantidad</th>
								</tr>
							</thead>
							<tbody>
								{#each kit.items as item (item.descripcion)}
									<tr>
										<td>{item.descripcion}</td>
										<td>{item.unidad}</td>
										<td class="num">{item.cantidad}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		{:else if detalle.materiales?.sin_lista}
			<p class="aviso aviso--alerta" role="note">
				<TriangleAlert size={15} aria-hidden="true" />
				{detalle.materiales.nota || 'Este combo no tiene lista de materiales en el Anexo 2.'}
			</p>
		{/if}
	</div>

	<div class="tarjeta">
		<h2 class="tarjeta__titulo">Registro fotográfico (numeral 11)</h2>

		{#if detalle.fotos.length > 0}
			<VisorEvidencias reporteId={i.id} evidencias={detalle.fotos} origen="inspeccion" conPie />
		{:else}
			<p class="tarjeta__nota">Esta inspección no trae fotos.</p>
		{/if}
	</div>

	{#if puedeDecidir}
		<div class="tarjeta">
			<h2 class="tarjeta__titulo">Decisión sobre la inspección</h2>
			<p class="tarjeta__nota">
				De esta decisión depende la entrega del combo de materiales. Queda registrada con su nombre
				y la fecha.
			</p>

			<fieldset class="campo decision">
				<legend class="campo__etiqueta">Nuevo estado</legend>
				<div class="opciones">
					{#each ESTADOS.filter((e) => e.codigo !== i.estado) as e (e.codigo)}
						<label class="opcion" class:opcion--activa={nuevoEstado === e.codigo}>
							<input type="radio" name="nuevo-estado" value={e.codigo} bind:group={nuevoEstado} />
							<span class="opcion__texto">
								{e.etiqueta}
								<span class="opcion__nota">{e.nota}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="campo" class:campo--invalido={!!erroresCampo.nota}>
				<label class="campo__etiqueta" for="nota">
					Nota {nuevoEstado === 'RECHAZADA' ? '(obligatoria)' : '(opcional)'}
				</label>
				<textarea
					id="nota"
					class="campo__control"
					rows="3"
					maxlength="500"
					aria-invalid={erroresCampo.nota ? 'true' : undefined}
					aria-describedby={erroresCampo.nota ? 'nota-error' : undefined}
					bind:value={nota}
				></textarea>
				{#if erroresCampo.nota}
					<span class="campo__error" id="nota-error">{erroresCampo.nota}</span>
				{:else if faltaMotivo}
					<span class="campo__ayuda">
						Explique por qué se rechaza: sin el motivo, el profesional no sabe qué corregir.
					</span>
				{/if}
			</div>

			<button
				type="button"
				class="boton"
				onclick={decidir}
				disabled={!nuevoEstado || guardando || faltaMotivo}
			>
				{#if guardando}
					<LoaderCircle size={15} class="girando" aria-hidden="true" />
					Guardando…
				{:else}
					<Check size={15} aria-hidden="true" />
					Aplicar la decisión
				{/if}
			</button>
		</div>
	{/if}

	<div class="tarjeta">
		<h2 class="tarjeta__titulo">Historial</h2>
		{#if detalle.historial.length > 0}
			<ol class="historial">
				{#each detalle.historial as h, n (n)}
					<li>
						<span class="historial__estado">{ETIQUETA_ESTADO[h.estado] ?? h.estado}</span>
						<span class="historial__meta">
							{fechaHora(h.creado_en)}{h.usuario_email ? ` · ${h.usuario_email}` : ''}
						</span>
						{#if h.nota}<span class="historial__nota">{h.nota}</span>{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="tarjeta__nota">Todavía no se ha tomado ninguna decisión.</p>
		{/if}
	</div>
{/if}

<style>
	.volver {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-bottom: 0.9rem;
		font-size: 0.84rem;
		color: var(--color-primary-dark);
	}

	.cargando {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-muted);
	}

	.encabezado {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.numero {
		margin: 0 0 0.2rem;
		font-family: ui-monospace, 'SFMono-Regular', monospace;
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.fecha {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.pastilla {
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 999px;
		font-size: 0.76rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.datos {
		margin: 0;
		display: grid;
		gap: 0.45rem;
	}

	.datos > div {
		display: grid;
		grid-template-columns: minmax(11rem, 30%) 1fr;
		gap: 0.6rem;
		font-size: 0.85rem;
	}

	.datos dt {
		color: var(--color-muted);
	}

	.datos dd {
		margin: 0;
		word-break: break-word;
	}

	.combo {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.combo__motivo,
	.combo__kit {
		margin: 0.15rem 0 0;
		font-size: 0.83rem;
		color: var(--color-muted);
	}

	.kit {
		margin-top: 0.9rem;
	}

	.kit__nombre {
		margin: 0 0 0.35rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.decision {
		border: 0;
		padding: 0;
		min-width: 0;
	}

	.historial {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}

	.historial li {
		padding-left: 0.8rem;
		border-left: 3px solid var(--color-border-strong);
	}

	.historial__estado {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.historial__meta {
		display: block;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.historial__nota {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.82rem;
	}
</style>
