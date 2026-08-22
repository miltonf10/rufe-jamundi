<script lang="ts">
	// Las solicitudes que mandaron los ciudadanos, para revisarlas y decidir.
	//
	// Es la contraparte del formulario público: sin esta pantalla, lo que la
	// gente envía no lo ve nadie. Por defecto se muestran las que están sin
	// atender, que es el trabajo pendiente; el resto se consulta con el filtro.

	import { onMount, tick } from 'svelte';
	import {
		IdCard, Image, Inbox, LoaderCircle, MapPin, Trash2, TriangleAlert, Video, X
	} from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { preinscripcionApi } from '$lib/api/servicios';
	import { sesion } from '$lib/stores/sesion.svelte';
	import { SOLO_ADMIN } from '$lib/navigation';
	import { fechaHora } from '$lib/formato';
	import IconoSenal from '$lib/preinscripcion/IconoSenal.svelte';

	type Fila = {
		id: number;
		radicado: string;
		nombre_completo: string;
		documento: string;
		telefono: string;
		correo: string | null;
		direccion: string;
		zona: 'URBANA' | 'RURAL' | null;
		corregimiento: string | null;
		vereda: string | null;
		estado: string;
		inspeccion_id: number | null;
		creado_en: string;
		/** Lo que marcó, con su dibujo. La etiqueta es la que se le mostró. */
		senales: { codigo: string; etiqueta: string; icono: string }[];
		fotos: number;
		cedula: boolean;
		videos: number;
		/** Solo si mandó punto GPS; las coordenadas no viajan al listado. */
		ubicada: boolean;
	};

	let filas = $state<Fila[]>([]);
	let total = $state(0);
	let pagina = $state(1);
	let estado = $state('RECIBIDA');
	let cargando = $state(true);
	let error = $state('');

	const paginas = $derived(Math.max(1, Math.ceil(total / 25)));

	const ESTADOS = [
		{ valor: 'RECIBIDA', etiqueta: 'Sin atender' },
		{ valor: 'EN_REVISION', etiqueta: 'En revisión' },
		{ valor: 'CONVERTIDA', etiqueta: 'Convertidas' },
		{ valor: 'DESCARTADA', etiqueta: 'Descartadas' },
		{ valor: '', etiqueta: 'Todas' }
	];

	const ETIQUETA_ESTADO: Record<string, string> = {
		RECIBIDA: 'Sin atender',
		EN_REVISION: 'En revisión',
		CONVERTIDA: 'Convertida',
		DESCARTADA: 'Descartada'
	};

	onMount(cargar);

	async function cargar() {
		cargando = true;
		error = '';

		try {
			const r = await preinscripcionApi.listar({ estado, pagina });
			filas = r.preinscripciones as unknown as Fila[];
			total = r.total;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudieron cargar las solicitudes.';
		} finally {
			cargando = false;
		}
	}

	function filtrar(valor: string) {
		estado = valor;
		pagina = 1;
		void cargar();
	}

	function irA(n: number) {
		pagina = Math.min(Math.max(1, n), paginas);
		void cargar();
	}

	function lugar(f: Fila): string {
		return [f.direccion, f.vereda, f.corregimiento].filter(Boolean).join(' · ');
	}

	const ETIQUETA_ZONA: Record<string, string> = { URBANA: 'Urbana', RURAL: 'Rural' };

	// ── Eliminar ────────────────────────────────────────────────────────────
	//
	// Destruye los datos de un ciudadano y no se deshace, así que va detrás de un
	// diálogo que nombra a quién se borra y exige escribir por qué. En una tabla
	// el botón queda a un dedo de la fila de al lado: el diálogo es justamente lo
	// que convierte un resbalón en un susto en vez de en una pérdida.

	const puedeBorrar = $derived(!!sesion.rol && SOLO_ADMIN.includes(sesion.rol));

	let aBorrar = $state<Fila | null>(null);
	let motivoBorrado = $state('');
	let borrando = $state(false);
	let errorBorrado = $state('');
	let avisoBorrado = $state('');
	let campoMotivo = $state<HTMLInputElement | null>(null);

	async function pedirBorrado(f: Fila) {
		aBorrar = f;
		motivoBorrado = '';
		errorBorrado = '';

		// `tick()` no es opcional: el campo solo existe en el DOM cuando el
		// diálogo ya está dibujado, y Svelte lo dibuja DESPUÉS de esta línea.
		await tick();
		campoMotivo?.focus();
	}

	function cerrarBorrado() {
		if (borrando) return;
		aBorrar = null;
		motivoBorrado = '';
		errorBorrado = '';
	}

	async function confirmarBorrado() {
		if (!aBorrar || borrando || motivoBorrado.trim().length < 5) return;

		const ficha = aBorrar;
		borrando = true;
		errorBorrado = '';

		try {
			await preinscripcionApi.eliminar(ficha.id, motivoBorrado.trim());

			// Se quita de la tabla en vez de recargar: recargar devolvería a la
			// primera página y perdería el filtro que tuviera puesto.
			filas = filas.filter((x) => x.id !== ficha.id);
			total = Math.max(0, total - 1);
			avisoBorrado = `Se eliminó ${ficha.radicado}.`;
			aBorrar = null;
			motivoBorrado = '';
		} catch (e) {
			errorBorrado = e instanceof ApiError ? e.message : 'No se pudo eliminar la solicitud.';
		} finally {
			borrando = false;
		}
	}

	function cuantosArchivos(f: Fila): number {
		return f.fotos + f.videos + (f.cedula ? 1 : 0);
	}

	// Con el diálogo abierto, la rueda del ratón movía la tabla de detrás y al
	// cerrarlo uno aparecía en otro punto del listado sin saber por qué.
	$effect(() => {
		if (!aBorrar) return;

		const previo = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previo;
		};
	});
</script>

<div class="tarjeta">
	<p class="tarjeta__nota">
		Solicitudes que los ciudadanos enviaron desde el formulario público. Revíselas y conviértalas en
		inspección cuando corresponda.
	</p>

	<div class="filtros" role="group" aria-label="Filtrar por estado">
		{#each ESTADOS as e (e.valor)}
			<button
				type="button"
				class="boton boton--suave"
				class:filtro--activo={estado === e.valor}
				aria-pressed={estado === e.valor}
				onclick={() => filtrar(e.valor)}
			>
				{e.etiqueta}
			</button>
		{/each}
	</div>

	{#if error}<p class="aviso aviso--error" role="alert">{error}</p>{/if}
	{#if avisoBorrado}<p class="aviso aviso--exito" role="status">{avisoBorrado}</p>{/if}

	{#if cargando}
		<p class="cargando"><LoaderCircle size={18} class="girando" aria-hidden="true" /> Cargando…</p>
	{:else if filas.length === 0}
		<p class="vacio">
			<Inbox size={22} aria-hidden="true" />
			No hay solicitudes en este estado.
		</p>
	{:else}
		<div class="tabla-envoltura">
			<table class="tabla">
				<thead>
					<tr>
						<th scope="col">Radicado</th>
						<th scope="col">Solicitante</th>
						<th scope="col">Vivienda</th>
						<th scope="col">Qué reportó</th>
						<th scope="col">Adjuntó</th>
						<th scope="col">Recibida</th>
						<th scope="col">Estado</th>
						{#if puedeBorrar}
							<th scope="col"><span class="solo-lectores">Acciones</span></th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each filas as f (f.id)}
						<tr>
							<td class="radicado">
								<a href="/riesgo/preinscripciones/{f.id}">{f.radicado}</a>
							</td>
							<td>
								{f.nombre_completo}
								<small>C.C. {f.documento} · {f.telefono}</small>
								{#if f.correo}<small>{f.correo}</small>{/if}
							</td>
							<td>
								{lugar(f)}
								{#if f.zona}
									<small>
										Zona {ETIQUETA_ZONA[f.zona] ?? f.zona}
										{#if f.ubicada}
											· <span class="ubicada"><MapPin size={11} aria-hidden="true" /> con ubicación</span>
										{/if}
									</small>
								{/if}
							</td>

							<!--
								Los dibujos y no los nombres: son las mismas ocho figuras que
								vio el ciudadano al marcarlas, y de un vistazo separan un techo
								caído de una tubería rota sin leer nada. El nombre va en el
								`title` y en el texto para lector de pantalla, porque un dibujo
								sin palabra no es accesible.
							-->
							<td>
								{#if f.senales.length === 0}
									<span class="nada">Nada marcado</span>
								{:else}
									<ul class="senales">
										{#each f.senales as s (s.codigo)}
											<li class="senal" title={s.etiqueta}>
												<IconoSenal icono={s.icono} compacto />
												<span class="solo-lectores">{s.etiqueta}</span>
											</li>
										{/each}
									</ul>
								{/if}
							</td>

							<td>
								{#if !f.cedula && f.fotos === 0 && f.videos === 0}
									<span class="nada">Sin archivos</span>
								{:else}
									<ul class="adjuntos">
										{#if f.cedula}
											<li title="Mandó la foto de su cédula">
												<IdCard size={13} aria-hidden="true" />
												Cédula
											</li>
										{/if}
										{#if f.fotos > 0}
											<li title="Fotos del daño">
												<Image size={13} aria-hidden="true" />
												{f.fotos}
											</li>
										{/if}
										{#if f.videos > 0}
											<li title="Videos de la vivienda">
												<Video size={13} aria-hidden="true" />
												{f.videos}
											</li>
										{/if}
									</ul>
								{/if}
							</td>

							<td class="fecha">{fechaHora(f.creado_en)}</td>
							<td><span class="marca">{ETIQUETA_ESTADO[f.estado] ?? f.estado}</span></td>

							{#if puedeBorrar}
								<td>
									<!--
										Una solicitud ya convertida no se puede borrar: ninguna ficha
										de inspección guarda de qué solicitud nació, y borrarla dejaría
										esa visita sin nada que la explique. Se muestra el botón
										desactivado y no se esconde, para que se entienda por qué.
									-->
									<button
										type="button"
										class="borrar"
										disabled={f.estado === 'CONVERTIDA'}
										title={f.estado === 'CONVERTIDA'
											? 'Ya se convirtió en inspección: es lo único que explica por qué se hizo esa visita'
											: `Eliminar ${f.radicado}`}
										onclick={() => pedirBorrado(f)}
									>
										<Trash2 size={15} aria-hidden="true" />
										<span class="solo-lectores">
											Eliminar {f.radicado} de {f.nombre_completo}
										</span>
									</button>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if paginas > 1}
			<div class="paginacion">
				<button
					type="button"
					class="boton boton--suave"
					disabled={pagina <= 1}
					onclick={() => irA(pagina - 1)}
				>
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

<!-- ── Diálogo de borrado ───────────────────────────────────────────────── -->
{#if aBorrar}
	<!--
		`role="dialog"` con `aria-modal`: sin ellos el lector de pantalla sigue
		leyendo la tabla de detrás como si nada, y quien lo usa no se entera de que
		hay una pregunta esperando respuesta.
	-->
	<div
		class="velo"
		role="dialog"
		aria-modal="true"
		aria-labelledby="titulo-borrado"
		tabindex="-1"
		onkeydown={(e) => {
			if (e.key === 'Escape') cerrarBorrado();
		}}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="velo__fondo" onclick={cerrarBorrado}></div>

		<div class="dialogo">
			<h2 class="dialogo__titulo" id="titulo-borrado">
				<TriangleAlert size={18} aria-hidden="true" />
				Eliminar la solicitud
			</h2>

			<p class="dialogo__texto">
				Va a borrar <strong>{aBorrar.radicado}</strong>, de {aBorrar.nombre_completo}.
				{#if cuantosArchivos(aBorrar) > 0}
					Se llevará
					{cuantosArchivos(aBorrar)}
					{cuantosArchivos(aBorrar) === 1 ? 'archivo' : 'archivos'} y todo su historial.
				{:else}
					No tiene archivos adjuntos.
				{/if}
				<strong>No se puede deshacer.</strong>
			</p>

			<p class="dialogo__alternativa">
				Si solo quiere sacarla de la cola, ábrala y márquela como «Descartada»: así deja de
				aparecer sin destruir nada.
			</p>

			<div class="campo">
				<label class="campo__etiqueta" for="motivo-borrado">¿Por qué se borra? *</label>
				<input
					id="motivo-borrado"
					class="campo__control"
					bind:this={campoMotivo}
					bind:value={motivoBorrado}
					placeholder="Ej.: registro de prueba"
					disabled={borrando}
				/>
				<span class="campo__ayuda">
					Queda en la auditoría con el radicado y su usuario. Es lo único que quedará de esta
					solicitud.
				</span>
			</div>

			{#if errorBorrado}
				<p class="aviso aviso--error" role="alert">{errorBorrado}</p>
			{/if}

			<div class="dialogo__acciones">
				<button type="button" class="boton boton--suave" onclick={cerrarBorrado} disabled={borrando}>
					<X size={15} aria-hidden="true" />
					Cancelar
				</button>
				<button
					type="button"
					class="boton boton--peligro"
					onclick={confirmarBorrado}
					disabled={borrando || motivoBorrado.trim().length < 5}
				>
					{#if borrando}
						<LoaderCircle size={15} class="girando" aria-hidden="true" />
						Eliminando…
					{:else}
						<Trash2 size={15} aria-hidden="true" />
						Sí, eliminar
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.filtros {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.8rem 0 1rem;
	}

	.filtro--activo {
		border-color: var(--color-primary);
		background: var(--color-info-bg);
		color: var(--aviso-info-texto);
		font-weight: 600;
	}

	.cargando,
	.vacio {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem 0;
		color: var(--color-muted);
	}

	.radicado {
		font-family: ui-monospace, 'SFMono-Regular', monospace;
		font-size: 0.82rem;
		white-space: nowrap;
	}

	.tabla small {
		display: block;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.fecha {
		white-space: nowrap;
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.marca {
		display: inline-block;
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 999px;
		font-size: 0.74rem;
		white-space: nowrap;
	}

	.paginacion {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		margin-top: 1rem;
		font-size: 0.84rem;
		color: var(--color-muted);
	}

	/* ── Lo que mandó el ciudadano ──────────────────────────────────────── */

	.senales {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		/* Ocho señales caben en dos filas de cuatro sin ensanchar la tabla más
		   allá de lo que ya se desplaza. */
		max-width: 9.5rem;
	}

	.senal {
		width: 2rem;
		padding: 0.15rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface-alt);
	}

	.adjuntos {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
	}

	.adjuntos li {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.4rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 999px;
		font-size: 0.74rem;
		white-space: nowrap;
	}

	.nada {
		font-size: 0.76rem;
		color: var(--color-muted);
	}

	.ubicada {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
	}

	/*
		Visible para el lector de pantalla y no para el ojo. No se usa
		`display:none` ni `visibility:hidden`: las dos lo sacan también del árbol
		de accesibilidad, y entonces la columna de señales sería ocho dibujos sin
		una sola palabra que los nombre.
	*/
	.borrar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
	}

	.borrar:hover:not(:disabled) {
		border-color: var(--color-danger);
		background: var(--color-danger-bg);
		color: var(--color-danger);
	}

	.borrar:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.velo {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.velo__fondo {
		position: absolute;
		inset: 0;
		background: rgb(4 12 26 / 68%);
	}

	.dialogo {
		position: relative;
		width: min(30rem, 100%);
		max-height: 90vh;
		overflow-y: auto;
		padding: 1.2rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-surface);
		box-shadow: 0 20px 60px rgb(4 12 26 / 45%);
	}

	.dialogo__titulo {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.7rem;
		font-size: 1.02rem;
		color: var(--color-danger);
	}

	.dialogo__texto {
		margin: 0 0 0.7rem;
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.dialogo__alternativa {
		margin: 0 0 1rem;
		padding: 0.6rem 0.75rem;
		border-left: 3px solid var(--color-border-strong);
		border-radius: 0 8px 8px 0;
		background: var(--color-surface-alt);
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--color-muted);
	}

	.dialogo__acciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.dialogo__acciones .boton {
		flex: 1;
		justify-content: center;
		min-height: 42px;
	}

	.boton--peligro {
		background: var(--color-danger);
		color: #fff;
	}

	.boton--peligro:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-danger) 88%, black);
	}

	.solo-lectores {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
