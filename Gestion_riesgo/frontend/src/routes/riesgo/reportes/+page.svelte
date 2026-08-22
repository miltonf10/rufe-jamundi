<script lang="ts">
	// Bandeja de fichas RUFE pendientes de validar.
	//
	// La lista no trae nombres ni documentos: para decidir qué revisar bastan el
	// evento, el lugar y la fecha. Los datos identificatorios solo aparecen al
	// abrir un reporte, que es la acción que queda registrada en auditoría.

	import { onMount } from 'svelte';
	import { Download, FileWarning, Flag, LoaderCircle, Search, X } from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { rufeApi, type FiltrosReportes } from '$lib/api/servicios';
	import type { Paginacion, ReporteResumen } from '$lib/rufe-form/tipos';
	import { fechaHora, soloFecha } from '$lib/formato';
	import BotonFichaPdf from '$lib/components/BotonFichaPdf.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let reportes = $state<ReporteResumen[]>([]);
	let paginacion = $state<Paginacion | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	let filtros = $state<FiltrosReportes>({ estado: '', zona: '', q: '', pagina: 1 });

	// ── Descarga masiva ─────────────────────────────────────────────────────
	//
	// La selección es de la página que se está viendo, no de todo el resultado
	// del filtro: descargar «las 1.300 del municipio» de una vez pediría 1.300
	// detalles al servidor y generaría 400 MB en el navegador. Con 25 por página
	// el lote es manejable y el avance se ve.

	let marcadas = $state(new SvelteSet<number>());
	let descargando = $state(false);
	let detener = false;
	let avance = $state({ hechas: 0, total: 0, fallidas: 0 });
	let resultadoLote = $state<{ mensaje: string; fallidas: number } | null>(null);

	const todasMarcadas = $derived(reportes.length > 0 && reportes.every((r) => marcadas.has(r.id)));
	const algunaMarcada = $derived(reportes.some((r) => marcadas.has(r.id)));

	function alternar(id: number) {
		if (marcadas.has(id)) marcadas.delete(id);
		else marcadas.add(id);
	}

	function alternarTodas() {
		if (todasMarcadas) {
			for (const r of reportes) marcadas.delete(r.id);
		} else {
			for (const r of reportes) marcadas.add(r.id);
		}
	}

	async function descargarSeleccionadas() {
		if (descargando || marcadas.size === 0) return;

		const elegidas = reportes.filter((r) => marcadas.has(r.id));

		descargando = true;
		detener = false;
		resultadoLote = null;
		avance = { hechas: 0, total: elegidas.length, fallidas: 0 };

		try {
			// La librería de PDF y la de compresión pesan; entran solo cuando alguien
			// descarga de verdad.
			const { generarLote, nombreZip } = await import('$lib/ficha-pdf/lote');

			const r = await generarLote(
				elegidas.map((e) => ({ id: e.id, radicado: e.radicado })),
				(id) => rufeApi.ver(id),
				{ alAvanzar: (a) => (avance = a), detenido: () => detener }
			);

			if (r.generadas === 0) {
				resultadoLote = { mensaje: 'No se pudo generar ninguna ficha.', fallidas: 1 };
			} else {
				descargarArchivo(r.zip, nombreZip(r.generadas));

				resultadoLote = {
					mensaje:
						r.fallidas.length === 0
							? `Se descargaron ${r.generadas} fichas en un archivo .zip.`
							: `Se descargaron ${r.generadas} fichas. No se pudieron generar ${r.fallidas.length}: ${r.fallidas.map((f) => f.radicado).join(', ')}.`,
					fallidas: r.fallidas.length
				};
			}
		} catch (e) {
			resultadoLote = {
				mensaje: e instanceof ApiError ? e.message : 'No se pudo preparar la descarga.',
				fallidas: 1
			};
		} finally {
			descargando = false;
		}
	}

	function descargarArchivo(blob: Blob, nombre: string) {
		const url = URL.createObjectURL(blob);
		const enlace = document.createElement('a');
		enlace.href = url;
		enlace.download = nombre;
		enlace.click();
		// Sin revocar, el navegador conserva el zip entero en memoria hasta
		// recargar; con cincuenta fichas son cientos de megas.
		URL.revokeObjectURL(url);
	}

	const ESTADOS = [
		{ codigo: '', etiqueta: 'Todos los estados' },
		{ codigo: 'RECIBIDO', etiqueta: 'Recibido' },
		{ codigo: 'EN_VALIDACION', etiqueta: 'En validación' },
		{ codigo: 'VALIDADO', etiqueta: 'Validado' },
		{ codigo: 'RECHAZADO', etiqueta: 'Rechazado' },
		{ codigo: 'ARCHIVADO', etiqueta: 'Archivado' }
	];

	const ZONAS = [
		{ codigo: '', etiqueta: 'Urbano y rural' },
		{ codigo: 'URBANO', etiqueta: 'Urbano' },
		{ codigo: 'RURAL', etiqueta: 'Rural' }
	];

	onMount(cargar);

	async function cargar() {
		cargando = true;
		error = null;

		try {
			const datos = await rufeApi.listar(filtros);
			reportes = datos.reportes;
			paginacion = datos.paginacion;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudieron cargar los reportes.';
		} finally {
			cargando = false;
		}
	}

	function aplicar() {
		filtros.pagina = 1;
		void cargar();
	}

	function limpiar() {
		filtros = { estado: '', zona: '', q: '', pagina: 1 };
		void cargar();
	}

	function irAPagina(n: number) {
		filtros.pagina = n;
		void cargar();
	}

	function claseEstado(estado: string): string {
		return `pastilla pastilla--${estado.toLowerCase()}`;
	}

	const hayFiltros = $derived(!!(filtros.estado || filtros.zona || filtros.q));
</script>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">Fichas RUFE</h2>
	<p class="tarjeta__nota">
		Registro Unifamiliar de Emergencias levantado en campo por los funcionarios desde
		<strong>Registro</strong>. Las fichas entran en estado «Recibido» y no son oficiales hasta
		que un gestor les da el Vo.Bo.
	</p>

	<form
		class="filtros"
		onsubmit={(e) => {
			e.preventDefault();
			aplicar();
		}}
	>
		<div class="campo filtros__buscar">
			<label class="campo__etiqueta" for="filtro-q">Buscar</label>
			<input
				id="filtro-q"
				class="campo__control"
				type="search"
				placeholder="Cédula, nombre completo o número de ficha"
				bind:value={filtros.q}
				aria-describedby="filtro-q-ayuda"
			/>
		</div>

		<p class="campo__ayuda filtros__ayuda" id="filtro-q-ayuda">
			También encuentra por dirección, barrio o evento. El nombre puede ir en cualquier orden y
			sin tildes.
		</p>

		<div class="campo filtros__estado">
			<label class="campo__etiqueta" for="filtro-estado">Estado</label>
			<select id="filtro-estado" class="campo__control" bind:value={filtros.estado}>
				{#each ESTADOS as e (e.codigo)}<option value={e.codigo}>{e.etiqueta}</option>{/each}
			</select>
		</div>

		<div class="campo filtros__zona">
			<label class="campo__etiqueta" for="filtro-zona">Zona</label>
			<select id="filtro-zona" class="campo__control" bind:value={filtros.zona}>
				{#each ZONAS as z (z.codigo)}<option value={z.codigo}>{z.etiqueta}</option>{/each}
			</select>
		</div>

		<div class="filtros__acciones">
			<button type="submit" class="boton">
				<Search size={15} aria-hidden="true" />
				Filtrar
			</button>
			{#if hayFiltros}
				<button type="button" class="boton boton--suave" onclick={limpiar}>
					<X size={15} aria-hidden="true" />
					Limpiar
				</button>
			{/if}
		</div>
	</form>

	{#if error}
		<p class="aviso aviso--error" role="alert">{error}</p>
	{/if}

	{#if cargando}
		<p class="cargando">
			<LoaderCircle size={18} class="girando" aria-hidden="true" />
			Cargando reportes…
		</p>
	{:else if reportes.length === 0}
		<p class="vacio">
			{hayFiltros
				? 'Ninguna ficha coincide con los filtros aplicados.'
				: 'Todavía no se ha registrado ninguna ficha.'}
		</p>
	{:else}
		{#if marcadas.size > 0}
			<div class="barra-seleccion">
				<span>
					<strong>{marcadas.size}</strong>
					{marcadas.size === 1 ? 'ficha seleccionada' : 'fichas seleccionadas'}
				</span>

				{#if descargando}
					<span class="barra-seleccion__avance">
						<LoaderCircle size={15} class="girando" aria-hidden="true" />
						Generando {avance.hechas} de {avance.total}…
					</span>
					<button type="button" class="boton boton--suave" onclick={() => (detener = true)}>
						Detener
					</button>
				{:else}
					<button type="button" class="boton" onclick={descargarSeleccionadas}>
						<Download size={15} aria-hidden="true" />
						Descargar en .zip
					</button>
					<button type="button" class="boton boton--suave" onclick={() => (marcadas = new SvelteSet())}>
						Quitar selección
					</button>
				{/if}
			</div>
		{/if}

		{#if resultadoLote}
			<p class="aviso {resultadoLote.fallidas > 0 ? 'aviso--alerta' : 'aviso--ok'}" role="status">
				{resultadoLote.mensaje}
			</p>
		{/if}

		<div class="tabla-envoltura">
			<table class="tabla">
				<caption class="visualmente-oculto">
					Fichas RUFE registradas, ordenadas por fecha
				</caption>
				<thead>
					<tr>
						<th scope="col" class="col-marca">
							<input
								type="checkbox"
								checked={todasMarcadas}
								indeterminate={algunaMarcada && !todasMarcadas}
								onchange={alternarTodas}
								aria-label="Seleccionar todas las fichas de esta página"
							/>
						</th>
						<th scope="col">Radicado</th>
						<th scope="col">Evento</th>
						<th scope="col">Ubicación</th>
						<th scope="col">Fecha del evento</th>
						<th scope="col">Personas</th>
						<th scope="col">Estado</th>
						<th scope="col">Recibido</th>
						<th scope="col">Ficha oficial</th>
					</tr>
				</thead>
				<tbody>
					{#each reportes as reporte (reporte.id)}
						<!-- El enlace va en la celda y no en la fila entera: una <tr> con
						     onclick no es alcanzable con teclado ni se anuncia como enlace. -->
						<tr
							class="fila"
							class:fila--prioritaria={reporte.revision_prioritaria}
							class:fila--marcada={marcadas.has(reporte.id)}
						>
							<td class="col-marca">
								<input
									type="checkbox"
									checked={marcadas.has(reporte.id)}
									onchange={() => alternar(reporte.id)}
									aria-label="Seleccionar la ficha {reporte.radicado}"
								/>
							</td>
							<td>
								<a class="radicado" href="/riesgo/reportes/{reporte.id}">
									{reporte.radicado}
								</a>
								{#if reporte.revision_prioritaria}
									<span class="marca-prioridad" title="Marcado para revisión prioritaria">
										<Flag size={13} aria-hidden="true" />
										<span class="visualmente-oculto">Revisión prioritaria</span>
									</span>
								{/if}
								{#if reporte.anonimizado}
									<span class="etiqueta etiqueta--inactivo">Anonimizado</span>
								{/if}
							</td>
							<td>{reporte.evento}</td>
							<td>
								{reporte.vereda_sector_barrio}
								<span class="sub">
									{reporte.zona_etiqueta}{reporte.corregimiento
										? ` · ${reporte.corregimiento}`
										: ''}
								</span>
							</td>
							<td>{soloFecha(reporte.fecha_evento)}</td>
							<td>
								{reporte.personas}
								{#if reporte.evidencias > 0}
									<span class="sub">{reporte.evidencias} foto(s)</span>
								{/if}
							</td>
							<td><span class={claseEstado(reporte.estado)}>{reporte.estado_etiqueta}</span></td>
							<td>{fechaHora(reporte.creado_en)}</td>
						<td>
							<BotonFichaPdf id={reporte.id} radicado={reporte.radicado} />
						</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if paginacion && paginacion.paginas > 1}
			<nav class="paginacion" aria-label="Paginación de reportes">
				<button
					type="button"
					class="boton boton--suave"
					disabled={paginacion.pagina <= 1}
					onclick={() => irAPagina(paginacion!.pagina - 1)}
				>
					Anterior
				</button>

				<span class="paginacion__texto" aria-live="polite">
					Página {paginacion.pagina} de {paginacion.paginas} · {paginacion.total} reportes
				</span>

				<button
					type="button"
					class="boton boton--suave"
					disabled={paginacion.pagina >= paginacion.paginas}
					onclick={() => irAPagina(paginacion!.pagina + 1)}
				>
					Siguiente
				</button>
			</nav>
		{/if}
	{/if}
</div>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">
		<FileWarning size={16} aria-hidden="true" />
		Sobre estos datos
	</h2>
	<p class="tarjeta__nota">
		Cada ficha contiene datos personales y datos sensibles (identidad de género y pertenencia
		étnica) de todo un núcleo familiar. Abrirla queda registrado en la auditoría del sistema con
		su usuario y la fecha. Buscar por cédula o por nombre también queda registrado, sin guardar
		lo que se escribió.
	</p>
</div>

<style>
	.filtros {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}

	@media (min-width: 760px) {
		.filtros {
			/* El buscador se queda con el espacio sobrante; los dos selectores piden
			   solo lo que necesitan para mostrar su opción más larga. */
			grid-template-columns: minmax(14rem, 1fr) minmax(9.5rem, auto) minmax(9.5rem, auto) auto;
			align-items: end;
			column-gap: 0.7rem;
			row-gap: 0.3rem;
		}

		/* Colocación explícita: sin esto la ayuda, al ocupar todo el ancho, echaría
		   a los selectores a una tercera fila. */
		.filtros__buscar { grid-area: 1 / 1; }
		.filtros__estado { grid-area: 1 / 2; }
		.filtros__zona { grid-area: 1 / 3; }
		.filtros__acciones { grid-area: 1 / 4; }
		.filtros__ayuda { grid-area: 2 / 1 / 3 / -1; }
	}

	.filtros .campo {
		margin-bottom: 0;
	}

	.filtros__ayuda {
		margin: 0;
	}

	.filtros__acciones {
		display: flex;
		gap: 0.4rem;
	}

	.barra-seleccion {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-bottom: 0.8rem;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--color-primary);
		border-radius: 10px;
		background: var(--color-surface-alt);
		font-size: 0.88rem;
	}

	.barra-seleccion__avance {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	/* La columna de marcado pide lo justo: el ancho es del contenido de la ficha. */
	.col-marca {
		width: 2.2rem;
		text-align: center;
	}

	.col-marca input {
		accent-color: var(--color-primary);
		width: 1rem;
		height: 1rem;
		cursor: pointer;
	}

	.fila--marcada {
		background: var(--color-surface-alt);
	}

	.fila:hover {
		background: var(--color-surface-alt);
	}

	/* La prioridad no se marca solo con color: lleva además una banderita y su
	   texto alternativo. */
	.fila--prioritaria td:first-child {
		box-shadow: inset 3px 0 0 var(--color-warning);
	}

	.marca-prioridad {
		display: inline-flex;
		vertical-align: middle;
		margin-left: 0.3rem;
		color: var(--color-warning);
	}

	.radicado {
		font-family: ui-monospace, 'SFMono-Regular', monospace;
		font-size: 0.78rem;
		color: var(--color-primary-dark);
	}

	.sub {
		display: block;
		font-size: 0.74rem;
		color: var(--color-muted);
	}

	.pastilla {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.72rem;
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

	.paginacion {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}

	.paginacion__texto {
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.visualmente-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
