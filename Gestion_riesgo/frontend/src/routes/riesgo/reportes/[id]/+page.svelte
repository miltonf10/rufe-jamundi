<script lang="ts">
	// Detalle de una ficha RUFE y su validación.
	//
	// Aquí es donde el "Vo.Bo. CMGRD/CDGRD" del formato de papel se convierte en
	// un acto trazable: quién validó, cuándo y con qué nota. Los botones de
	// decisión se ocultan a quien no tiene el rol, pero eso es solo cortesía: el
	// permiso de verdad lo aplica el router de PHP, y una llamada directa a la API
	// desde la consola devuelve 403 igual.

	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		ArrowLeft, Check, LoaderCircle, MapPin, ShieldOff, TriangleAlert
	} from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { rufeApi } from '$lib/api/servicios';
	import { sesion } from '$lib/stores/sesion.svelte';
	import VisorEvidencias from '$lib/components/VisorEvidencias.svelte';
	import { ESCRITURA, SOLO_ADMIN } from '$lib/navigation';
	import type { DetalleCompleto, EstadoReporte } from '$lib/rufe-form/tipos';
	import { fechaHora, soloFecha } from '$lib/formato';
	import BotonFichaPdf from '$lib/components/BotonFichaPdf.svelte';

	let detalle = $state<DetalleCompleto | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let exito = $state<string | null>(null);

	let nuevoEstado = $state<EstadoReporte | ''>('');
	let nota = $state('');
	let guardando = $state(false);
	let erroresCampo = $state<Record<string, string>>({});
	let confirmandoAnonimizar = $state(false);

	const id = $derived(Number(page.params.id));

	const puedeDecidir = $derived(!!sesion.rol && ESCRITURA.includes(sesion.rol));
	const puedeAnonimizar = $derived(!!sesion.rol && SOLO_ADMIN.includes(sesion.rol));

	const ESTADOS: { codigo: EstadoReporte; etiqueta: string; nota: string }[] = [
		{ codigo: 'EN_VALIDACION', etiqueta: 'En validación', nota: 'Se está verificando en campo.' },
		{ codigo: 'VALIDADO', etiqueta: 'Validado', nota: 'Da el Vo.Bo. y lo vuelve oficial.' },
		{ codigo: 'RECHAZADO', etiqueta: 'Rechazado', nota: 'Requiere explicar el motivo.' },
		{ codigo: 'ARCHIVADO', etiqueta: 'Archivado', nota: 'Se cierra sin más trámite.' }
	];

	onMount(cargar);

	async function cargar() {
		cargando = true;
		error = null;

		try {
			detalle = await rufeApi.ver(id);
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo cargar el reporte.';
		} finally {
			cargando = false;
		}
	}

	async function cambiarEstado() {
		if (!nuevoEstado || guardando) return;

		guardando = true;
		error = null;
		exito = null;
		erroresCampo = {};

		try {
			await rufeApi.cambiarEstado(id, nuevoEstado, nota);
			exito = 'El estado del reporte se actualizó.';
			nuevoEstado = '';
			nota = '';
			await cargar();
		} catch (e) {
			if (e instanceof ApiError) {
				error = e.message;
				erroresCampo = e.errors;
			} else {
				error = 'No se pudo actualizar el estado.';
			}
		} finally {
			guardando = false;
		}
	}

	async function anonimizar() {
		guardando = true;
		error = null;

		try {
			const r = await rufeApi.anonimizar(id);
			exito = r.mensaje;
			confirmandoAnonimizar = false;
			await cargar();
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo anonimizar el reporte.';
		} finally {
			guardando = false;
		}
	}

	function documentoDe(p: DetalleCompleto['personas'][number]): string {
		const tipo = p.documento_otro ? `${p.tipo_documento_etiqueta} (${p.documento_otro})` : p.tipo_documento_etiqueta;

		return p.numero_documento ? `${tipo} · ${p.numero_documento}` : tipo;
	}
</script>

<a class="volver" href="/riesgo/reportes">
	<ArrowLeft size={15} aria-hidden="true" />
	Volver a la bandeja
</a>

{#if cargando}
	<p class="cargando">
		<LoaderCircle size={18} class="girando" aria-hidden="true" />
		Cargando el reporte…
	</p>
{:else if error && !detalle}
	<p class="aviso aviso--error" role="alert">{error}</p>
{:else if detalle}
	{@const r = detalle.reporte}

	{#if exito}
		<p class="aviso aviso--ok" role="status">{exito}</p>
	{/if}
	{#if error}
		<p class="aviso aviso--error" role="alert">{error}</p>
	{/if}

	{#if r.anonimizado}
		<p class="aviso aviso--info" role="note">
			<ShieldOff size={15} aria-hidden="true" />
			Los datos personales de este reporte fueron eliminados. Solo se conserva la información
			estadística.
		</p>
	{/if}

	<div class="tarjeta">
		<header class="encabezado">
			<div>
				<p class="radicado">{r.radicado}</p>
				<h2 class="tarjeta__titulo">{r.evento}</h2>
				<p class="tarjeta__nota">
					Ocurrió el {soloFecha(r.fecha_evento)} · Recibido el {fechaHora(r.creado_en)} ·
					Formato {r.formato_version === '01' ? 'FR-1703-SMD-69 v01' : r.formato_version}
				</p>
			</div>
			<div class="encabezado__acciones">
				<BotonFichaPdf id={r.id} radicado={r.radicado} />
				<span class="pastilla pastilla--{r.estado.toLowerCase()}">{r.estado_etiqueta}</span>
			</div>
		</header>

		{#if r.revision_prioritaria}
			<p class="aviso aviso--info" role="note">
				<TriangleAlert size={15} aria-hidden="true" />
				Marcado para revisión prioritaria: el formulario se completó en muy poco tiempo, lo que
				puede indicar un envío automatizado. Verifíquelo antes de validarlo.
			</p>
		{/if}

		<dl class="datos">
			<div><dt>Municipio</dt><dd>{r.municipio}, {r.departamento}</dd></div>
			<div><dt>Zona</dt><dd>{r.zona_etiqueta}</dd></div>
			{#if r.corregimiento}
				<div><dt>Corregimiento</dt><dd>{r.corregimiento}</dd></div>
			{/if}
			<div>
				<dt>{r.zona === 'RURAL' ? 'Vereda o sector' : 'Barrio'}</dt>
				<dd>{r.vereda_sector_barrio}</dd>
			</div>
			<div><dt>Dirección</dt><dd>{r.direccion}</dd></div>
			{#if r.latitud !== null && r.longitud !== null}
				<div>
					<dt>Coordenadas</dt>
					<dd>
						<a
							href="https://www.openstreetmap.org/?mlat={r.latitud}&mlon={r.longitud}#map=18/{r.latitud}/{r.longitud}"
							target="_blank"
							rel="noopener noreferrer"
						>
							<MapPin size={13} aria-hidden="true" />
							{r.latitud}, {r.longitud}
							{#if r.precision_m}(±{r.precision_m} m){/if}
						</a>
					</dd>
				</div>
			{/if}
			<div><dt>Tipo de bien</dt><dd>{r.tipo_bien_etiqueta}</dd></div>
			<div><dt>Forma de tenencia</dt><dd>{r.forma_tenencia_etiqueta}</dd></div>
			<div><dt>Estado del bien</dt><dd>{r.estado_bien_etiqueta}</dd></div>
			<div><dt>Alojamiento actual</dt><dd>{r.alojamiento_etiqueta}</dd></div>
			{#if r.alojamiento_direccion}
				<div><dt>Dirección del alojamiento</dt><dd>{r.alojamiento_direccion}</dd></div>
			{/if}
			<div><dt>Teléfono de contacto</dt><dd>{r.contacto_telefono || '—'}</dd></div>
			{#if r.contacto_correo}
				<div><dt>Correo</dt><dd>{r.contacto_correo}</dd></div>
			{/if}
			{#if r.observaciones}
				<div><dt>Observaciones</dt><dd>{r.observaciones}</dd></div>
			{/if}
			<div>
				<dt>Autorización de datos</dt>
				<dd>
					{r.autoriza_datos ? 'Otorgada' : 'No otorgada'}
					{#if r.autorizacion_en}· {fechaHora(r.autorizacion_en)}{/if}
					{#if r.autorizacion_texto}· aviso {r.autorizacion_texto}{/if}
				</dd>
			</div>
			{#if r.vobo_en}
				<div><dt>Vo.Bo. otorgado</dt><dd>{fechaHora(r.vobo_en)}</dd></div>
			{/if}
		</dl>
	</div>

	<div class="tarjeta">
		<h2 class="tarjeta__titulo">Información demográfica ({detalle.personas.length})</h2>

		<div class="tabla-envoltura">
			<table class="tabla">
				<thead>
					<tr>
						<th scope="col">#</th>
						<th scope="col">Nombre</th>
						<th scope="col">Documento</th>
						<th scope="col">Parentesco</th>
						<th scope="col">Género</th>
						<th scope="col">Nacimiento</th>
						<th scope="col">Pertenencia étnica</th>
						<th scope="col">Teléfono</th>
					</tr>
				</thead>
				<tbody>
					{#each detalle.personas as p (p.orden)}
						<tr>
							<td>{p.orden}</td>
							<td>{p.nombres} {p.apellidos}</td>
							<td>{documentoDe(p)}</td>
							<td>{p.parentesco_etiqueta}</td>
							<td>{p.genero_etiqueta}</td>
							<td>{p.fecha_nacimiento ? soloFecha(p.fecha_nacimiento) : 'No informa'}</td>
							<td>{p.pertenencia_etnica_etiqueta}</td>
							<td>{p.telefono ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	{#if detalle.agropecuario.length > 0}
		<div class="tarjeta">
			<h2 class="tarjeta__titulo">Sector agropecuario</h2>
			<div class="tabla-envoltura">
				<table class="tabla">
					<thead>
						<tr>
							<th scope="col">#</th>
							<th scope="col">Cultivo</th>
							<th scope="col">Área</th>
							<th scope="col">Especie</th>
							<th scope="col">Cantidad</th>
						</tr>
					</thead>
					<tbody>
						{#each detalle.agropecuario as a (a.orden)}
							<tr>
								<td>{a.orden}</td>
								<td>{a.tipo_cultivo ?? '—'}</td>
								<td>
									{a.area_cantidad !== null
										? `${a.area_cantidad} ${a.unidad_medida_etiqueta ?? ''}`
										: '—'}
								</td>
								<td>{a.especie_pecuaria ?? '—'}</td>
								<td>{a.cantidad_unidades ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	{#if detalle.evidencias.length > 0}
		<div class="tarjeta">
			<h2 class="tarjeta__titulo">Evidencias ({detalle.evidencias.length})</h2>
			<p class="tarjeta__nota">
				Los archivos se guardan fuera del servidor web. Abrir o descargar cualquiera queda
				registrado en la auditoría con su usuario y la fecha.
			</p>

			<VisorEvidencias reporteId={r.id} evidencias={detalle.evidencias} />
		</div>
	{/if}

	{#if puedeDecidir && !r.anonimizado}
		<div class="tarjeta">
			<h2 class="tarjeta__titulo">Decisión sobre el reporte</h2>

			<fieldset class="campo decision">
				<legend class="campo__etiqueta">Nuevo estado</legend>
				<div class="opciones">
					{#each ESTADOS.filter((e) => e.codigo !== r.estado) as e (e.codigo)}
						<label class="opcion" class:opcion--activa={nuevoEstado === e.codigo}>
							<input
								type="radio"
								name="nuevo-estado"
								value={e.codigo}
								bind:group={nuevoEstado}
							/>
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
					Nota {nuevoEstado === 'RECHAZADO' ? '(obligatoria)' : '(opcional)'}
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
				{/if}
			</div>

			<button type="button" class="boton" onclick={cambiarEstado} disabled={!nuevoEstado || guardando}>
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
		<ol class="historial">
			{#each detalle.historial as h, i (i)}
				<li>
					<span class="historial__estado">
						{h.estado_anterior ? `${h.estado_anterior} → ` : ''}{h.estado_etiqueta}
					</span>
					<span class="historial__meta">
						{fechaHora(h.creado_en)}{h.usuario_email ? ` · ${h.usuario_email}` : ''}
					</span>
					{#if h.nota}<span class="historial__nota">{h.nota}</span>{/if}
				</li>
			{/each}
		</ol>
	</div>

	{#if puedeAnonimizar && !r.anonimizado}
		<div class="tarjeta zona-peligro">
			<h2 class="tarjeta__titulo">Eliminar los datos personales</h2>
			<p class="tarjeta__nota">
				Borra nombres, documentos, teléfonos, dirección, coordenadas y evidencias, y conserva la
				información estadística para los indicadores del municipio. <strong>No se puede
				deshacer.</strong>
			</p>

			{#if confirmandoAnonimizar}
				<div class="confirmar">
					<p>¿Confirma que desea eliminar los datos personales de {r.radicado}?</p>
					<div class="confirmar__acciones">
						<button type="button" class="boton boton--peligro" onclick={anonimizar} disabled={guardando}>
							Sí, eliminarlos
						</button>
						<button
							type="button"
							class="boton boton--suave"
							onclick={() => (confirmandoAnonimizar = false)}
						>
							Cancelar
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="boton boton--peligro"
					onclick={() => (confirmandoAnonimizar = true)}
				>
					<ShieldOff size={15} aria-hidden="true" />
					Anonimizar el reporte
				</button>
			{/if}
		</div>
	{/if}
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

	.encabezado {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.encabezado__acciones {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.radicado {
		margin: 0 0 0.2rem;
		font-family: ui-monospace, 'SFMono-Regular', monospace;
		font-size: 0.8rem;
		color: var(--color-muted);
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

	.zona-peligro {
		border: 1px solid var(--aviso-error-borde);
	}

	.confirmar p {
		margin: 0 0 0.7rem;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.confirmar__acciones {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.pastilla {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid transparent;
	}

	.pastilla--recibido {
		background: var(--color-info-bg);
		color: var(--color-primary-dark);
		border-color: var(--aviso-info-borde);
	}

	.pastilla--en_validacion {
		background: var(--aviso-alerta-fondo);
		color: var(--aviso-alerta-texto);
		border-color: var(--aviso-alerta-borde);
	}

	.pastilla--validado {
		background: var(--color-success-bg);
		color: var(--aviso-ok-texto);
		border-color: var(--aviso-ok-borde);
	}

	.pastilla--rechazado {
		background: var(--color-danger-bg);
		color: var(--aviso-error-texto);
		border-color: var(--aviso-error-borde);
	}

	.pastilla--archivado {
		background: var(--color-surface-alt);
		color: var(--color-muted);
		border-color: var(--color-border);
	}

	@media (max-width: 480px) {
		.datos > div {
			grid-template-columns: 1fr;
			gap: 0.05rem;
		}
	}
</style>
