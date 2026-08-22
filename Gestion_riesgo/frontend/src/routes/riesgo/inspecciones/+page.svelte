<script lang="ts">
	// Las inspecciones de vivienda ya registradas.
	//
	// Se consulta desde una oficina, no en campo: aquí se revisa qué combo salió,
	// se aprueba o se devuelve. Por eso necesita conexión y no está en la lista
	// de pantallas que funcionan sin señal.

	import { onMount } from 'svelte';
	import { ClipboardCheck, LoaderCircle, Search, TriangleAlert } from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { inspeccionApi } from '$lib/api/servicios';
	import BotonInspeccionPdf from '$lib/components/BotonInspeccionPdf.svelte';

	type Fila = {
		id: number;
		numero: string;
		fecha_evaluacion: string;
		estado: string;
		cumple_requisitos: number;
		propietario_nombres: string;
		propietario_documento: string;
		direccion_cabecera: string | null;
		corregimiento: string | null;
		vereda: string | null;
		sistema_constructivo: string | null;
		combo: string | null;
		combo_nivel: string | null;
		colapso_total: number;
		requiere_evacuacion: number | null;
	};

	let filas = $state<Fila[]>([]);
	let total = $state(0);
	let pagina = $state(1);
	let porPagina = $state(25);
	let busqueda = $state('');
	let filtroCombo = $state('');
	let cargando = $state(true);
	let error = $state('');

	const paginas = $derived(Math.max(1, Math.ceil(total / porPagina)));

	const COMBOS = [
		{ codigo: '', etiqueta: 'Todos los combos' },
		{ codigo: 'COMBO_1', etiqueta: 'Combo 1 — mampostería leve' },
		{ codigo: 'COMBO_2', etiqueta: 'Combo 2 — mampostería moderado' },
		{ codigo: 'COMBO_3', etiqueta: 'Combo 3 — mampostería severo' },
		{ codigo: 'COMBO_4', etiqueta: 'Combo 4 — madera leve' },
		{ codigo: 'COMBO_5', etiqueta: 'Combo 5 — madera moderado' },
		{ codigo: 'COMBO_6', etiqueta: 'Combo 6 — madera severo' },
		{ codigo: 'COLAPSO_MAMPOSTERIA', etiqueta: 'Colapso total — mampostería' },
		{ codigo: 'COLAPSO_MADERA', etiqueta: 'Colapso total — madera' }
	];

	onMount(() => void cargar());

	async function cargar() {
		cargando = true;
		error = '';

		try {
			const r = await inspeccionApi.listar({ q: busqueda.trim(), combo: filtroCombo, pagina });

			filas = r.inspecciones as unknown as Fila[];
			total = r.total;
			porPagina = r.por_pagina;
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 0
					? 'No hay conexión con el servidor. Esta sección consulta datos y necesita señal.'
					: 'No se pudieron cargar las inspecciones.';
		} finally {
			cargando = false;
		}
	}

	function buscar(evento: Event) {
		evento.preventDefault();
		pagina = 1;
		void cargar();
	}

	function irA(n: number) {
		pagina = Math.min(Math.max(1, n), paginas);
		void cargar();
	}

	function lugar(f: Fila): string {
		return [f.direccion_cabecera, f.vereda, f.corregimiento].filter(Boolean).join(' · ') || '—';
	}

	function comboLegible(f: Fila): string {
		if (!f.cumple_requisitos) return 'No cumple requisitos';
		if (!f.combo) return 'Sin combo';

		return COMBOS.find((c) => c.codigo === f.combo)?.etiqueta ?? f.combo;
	}
</script>

<svelte:head><title>Inspecciones · SGR Jamundí</title></svelte:head>

<div class="tarjeta">
	<h2 class="tarjeta__titulo">Inspecciones de vivienda</h2>
	<p class="tarjeta__nota">
		Evaluaciones técnicas para el banco de materiales, con el combo que resultó de cada una.
	</p>

	<form class="filtros" onsubmit={buscar}>
		<label class="filtros__buscar">
			<span class="filtros__etiqueta">Buscar</span>
			<input
				type="search"
				bind:value={busqueda}
				placeholder="Número, propietario, cédula, dirección o vereda"
			/>
		</label>

		<label>
			<span class="filtros__etiqueta">Combo</span>
			<select bind:value={filtroCombo} onchange={() => irA(1)}>
				{#each COMBOS as c (c.codigo)}
					<option value={c.codigo}>{c.etiqueta}</option>
				{/each}
			</select>
		</label>

		<button type="submit" class="boton boton--principal">
			<Search size={15} aria-hidden="true" />
			Buscar
		</button>
	</form>

	{#if error}
		<p class="aviso aviso--error" role="alert">
			<TriangleAlert size={15} aria-hidden="true" />
			{error}
		</p>
	{:else if cargando}
		<p class="cargando">
			<LoaderCircle size={18} class="girando" aria-hidden="true" />
			Cargando…
		</p>
	{:else if filas.length === 0}
		<p class="vacio">
			<ClipboardCheck size={26} aria-hidden="true" />
			<span>No hay inspecciones que coincidan.</span>
		</p>
	{:else}
		<p class="cuenta">{total} {total === 1 ? 'inspección' : 'inspecciones'}</p>

		<div class="tabla-envoltura">
			<table class="tabla">
				<thead>
					<tr>
						<th scope="col">Ficha</th>
						<th scope="col">Propietario</th>
						<th scope="col">Vivienda</th>
						<th scope="col">Fecha</th>
						<th scope="col">Resultado</th>
						<th scope="col">Formato oficial</th>
					</tr>
				</thead>
				<tbody>
					{#each filas as f (f.id)}
						<tr>
							<td class="numero">
								<!-- El número lleva a la ficha: es donde se ven las fotos, la
								     ubicación y donde se aprueba o se rechaza. -->
								<a href="/riesgo/inspecciones/{f.id}">{f.numero}</a>
							</td>
							<td>
								{f.propietario_nombres}
								<small>C.C. {f.propietario_documento}</small>
							</td>
							<td>
								{lugar(f)}
								{#if f.requiere_evacuacion}
									<!-- Si hay que evacuar, es lo primero que alguien tiene que
									     ver al abrir el listado. -->
									<span class="marca marca--urgente">Requiere evacuación</span>
								{/if}
							</td>
							<td class="fecha">{f.fecha_evaluacion}</td>
							<td>
								<span
									class="marca"
									class:marca--sin={!f.cumple_requisitos || !f.combo}
									class:marca--colapso={f.colapso_total === 1}
								>
									{comboLegible(f)}
								</span>
							</td>
							<td>
								<BotonInspeccionPdf id={f.id} numero={f.numero} />
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if paginas > 1}
			<div class="paginacion">
				<button type="button" class="boton boton--suave" disabled={pagina <= 1} onclick={() => irA(pagina - 1)}>
					Anterior
				</button>
				<span>Página {pagina} de {paginas}</span>
				<button
					type="button"
					class="boton boton--suave"
					disabled={pagina >= paginas}
					onclick={() => irA(pagina + 1)}
				>
					Siguiente
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.filtros {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		align-items: flex-end;
		margin-bottom: 1rem;
	}

	.filtros label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.filtros__buscar {
		flex: 1 1 16rem;
	}

	.filtros__etiqueta {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	.filtros input,
	.filtros select {
		min-height: 2.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 0.45rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.cuenta {
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	/* La tabla desborda en un teléfono: se desplaza dentro de su caja, nunca
	   empujando la página entera de lado. */
	.tabla-envoltura {
		overflow-x: auto;
	}

	.tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.86rem;
	}

	.tabla th,
	.tabla td {
		padding: 0.5rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}

	.tabla th {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted);
	}

	.tabla small {
		display: block;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.numero,
	.fecha {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.marca {
		display: inline-block;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		background: var(--color-info-bg);
		color: var(--aviso-info-texto);
		font-size: 0.74rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.marca--sin {
		background: var(--color-surface-alt);
		color: var(--color-muted);
	}

	.marca--colapso {
		background: var(--color-danger-bg);
		color: var(--aviso-error-texto);
	}

	.marca--urgente {
		display: block;
		margin-top: 0.25rem;
		background: var(--aviso-alerta-fondo);
		color: var(--aviso-alerta-texto);
	}

	.paginacion {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		margin-top: 1rem;
		font-size: 0.83rem;
		color: var(--color-muted);
	}
</style>
