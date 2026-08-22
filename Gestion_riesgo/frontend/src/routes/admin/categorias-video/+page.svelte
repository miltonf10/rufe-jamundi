<script lang="ts">
	// Qué videos se le piden al ciudadano en la pre-inscripción.
	//
	// Esta lista NO está en el código: la arma el administrador. Qué hay que
	// grabar de una vivienda cambia entre una emergencia y la siguiente —un
	// sismo pide ver muros y cubierta; una inundación, alturas de agua— y
	// esperar a un despliegue para ajustarlo sería llegar tarde siempre.
	//
	// Se ordena con los botones de subir y bajar, no arrastrando: arrastrar no
	// funciona con teclado ni con lector de pantalla, y aquí la lista es corta.

	import { onMount } from 'svelte';
	import {
		ArrowDown, ArrowUp, Check, LoaderCircle, Pencil, Plus, Power, Trash2, TriangleAlert, Video
	} from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { categoriasVideoApi, type CategoriaVideo } from '$lib/api/servicios';

	let categorias = $state<CategoriaVideo[]>([]);
	let maximoObligatorias = $state(6);
	let cargando = $state(true);
	let error = $state('');
	let exito = $state('');
	let guardando = $state(false);

	let modo = $state<{ tipo: 'cerrado' } | { tipo: 'crear' } | { tipo: 'editar'; id: number }>({
		tipo: 'cerrado'
	});
	let erroresCampo = $state<Record<string, string>>({});
	let confirmandoBorrado = $state<number | null>(null);

	const VACIO = {
		nombre: '',
		instruccion: '',
		obligatoria: true,
		segundos_min: 5,
		segundos_max: 30
	};

	let form = $state({ ...VACIO });

	const obligatoriasActivas = $derived(
		categorias.filter((c) => c.activa && c.obligatoria).length
	);

	onMount(cargar);

	async function cargar() {
		cargando = true;
		error = '';

		try {
			const r = await categoriasVideoApi.listar();
			categorias = r.categorias;
			maximoObligatorias = r.maximo_obligatorias;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo cargar el catálogo.';
		} finally {
			cargando = false;
		}
	}

	function abrirNueva() {
		form = { ...VACIO };
		erroresCampo = {};
		modo = { tipo: 'crear' };
	}

	function abrirEdicion(c: CategoriaVideo) {
		form = {
			nombre: c.nombre,
			instruccion: c.instruccion ?? '',
			obligatoria: c.obligatoria,
			segundos_min: c.segundos_min,
			segundos_max: c.segundos_max
		};
		erroresCampo = {};
		modo = { tipo: 'editar', id: c.id };
	}

	async function guardar(evento: SubmitEvent) {
		evento.preventDefault();
		if (guardando || modo.tipo === 'cerrado') return;

		guardando = true;
		erroresCampo = {};
		error = '';

		try {
			if (modo.tipo === 'crear') {
				await categoriasVideoApi.crear(form);
				exito = 'Categoría agregada.';
			} else {
				await categoriasVideoApi.actualizar(modo.id, form);
				exito = 'Categoría actualizada.';
			}

			modo = { tipo: 'cerrado' };
			await cargar();
		} catch (e) {
			if (e instanceof ApiError) {
				error = e.message;
				erroresCampo = e.errors;
			} else {
				error = 'No se pudo guardar.';
			}
		} finally {
			guardando = false;
		}
	}

	async function alternar(c: CategoriaVideo) {
		error = '';

		try {
			await categoriasVideoApi.cambiarEstado(c.id, !c.activa);
			await cargar();
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo cambiar el estado.';
		}
	}

	async function mover(indice: number, hacia: -1 | 1) {
		const destino = indice + hacia;
		if (destino < 0 || destino >= categorias.length) return;

		const ids = categorias.map((c) => c.id);
		[ids[indice], ids[destino]] = [ids[destino], ids[indice]];

		try {
			const r = await categoriasVideoApi.reordenar(ids);
			categorias = r.categorias;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo reordenar.';
		}
	}

	async function eliminar(id: number) {
		error = '';

		try {
			await categoriasVideoApi.eliminar(id);
			confirmandoBorrado = null;
			exito = 'Categoría eliminada.';
			await cargar();
		} catch (e) {
			// El servidor explica que hay videos detrás y ofrece desactivarla.
			error = e instanceof ApiError ? (e.errors.categoria ?? e.message) : 'No se pudo eliminar.';
			confirmandoBorrado = null;
		}
	}
</script>

<div class="tarjeta">
	<div class="cabecera">
		<p class="tarjeta__nota">
			Lo que se le pide grabar al ciudadano en la pre-inscripción, en este orden. Puede cambiarlo
			cuando quiera: los cambios aplican a las solicitudes nuevas y no tocan los videos ya grabados.
		</p>
		<button type="button" class="boton" onclick={abrirNueva}>
			<Plus size={16} aria-hidden="true" />
			Agregar categoría
		</button>
	</div>

	{#if error}<p class="aviso aviso--error" role="alert">{error}</p>{/if}
	{#if exito}<p class="aviso aviso--exito" role="status">{exito}</p>{/if}

	{#if obligatoriasActivas >= maximoObligatorias}
		<p class="aviso aviso--alerta" role="note">
			<TriangleAlert size={15} aria-hidden="true" />
			Hay {obligatoriasActivas} categorías obligatorias activas, el máximo. Cada una alarga la
			solicitud, y quien la abandona a la mitad se queda sin turno.
		</p>
	{/if}

	{#if cargando}
		<p class="cargando"><LoaderCircle size={18} class="girando" aria-hidden="true" /> Cargando…</p>
	{:else if categorias.length === 0}
		<p class="vacio">
			<Video size={22} aria-hidden="true" />
			Todavía no hay categorías. Mientras no agregue ninguna, la pre-inscripción no pedirá videos.
		</p>
	{:else}
		<ul class="lista">
			{#each categorias as c, i (c.id)}
				<li class="fila" class:fila--inactiva={!c.activa}>
					<div class="fila__orden">
						<button
							type="button"
							class="boton boton--suave boton--icono"
							aria-label="Subir {c.nombre}"
							disabled={i === 0}
							onclick={() => mover(i, -1)}
						>
							<ArrowUp size={14} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="boton boton--suave boton--icono"
							aria-label="Bajar {c.nombre}"
							disabled={i === categorias.length - 1}
							onclick={() => mover(i, 1)}
						>
							<ArrowDown size={14} aria-hidden="true" />
						</button>
					</div>

					<div class="fila__datos">
						<p class="fila__nombre">
							{c.nombre}
							{#if c.obligatoria}<span class="marca marca--obligatoria">obligatoria</span>{/if}
							{#if !c.activa}<span class="marca">inactiva</span>{/if}
						</p>
						{#if c.instruccion}<p class="fila__instruccion">{c.instruccion}</p>{/if}
						<p class="fila__meta">Entre {c.segundos_min} y {c.segundos_max} segundos</p>
					</div>

					<div class="fila__acciones">
						<button
							type="button"
							class="boton boton--suave boton--icono"
							aria-label="Editar {c.nombre}"
							onclick={() => abrirEdicion(c)}
						>
							<Pencil size={15} aria-hidden="true" />
						</button>
						<button
							type="button"
							class="boton boton--suave boton--icono"
							aria-label={c.activa ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`}
							onclick={() => alternar(c)}
						>
							<Power size={15} aria-hidden="true" />
						</button>
						{#if confirmandoBorrado === c.id}
							<button type="button" class="boton boton--peligro" onclick={() => eliminar(c.id)}>
								Sí, borrar
							</button>
							<button
								type="button"
								class="boton boton--suave"
								onclick={() => (confirmandoBorrado = null)}
							>
								No
							</button>
						{:else}
							<button
								type="button"
								class="boton boton--suave boton--icono"
								aria-label="Eliminar {c.nombre}"
								onclick={() => (confirmandoBorrado = c.id)}
							>
								<Trash2 size={15} aria-hidden="true" />
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#if modo.tipo !== 'cerrado'}
	<div class="modal-fondo" role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-categoria">
			<h2 class="tarjeta__titulo" id="titulo-categoria">
				{modo.tipo === 'crear' ? 'Nueva categoría de video' : 'Editar categoría'}
			</h2>

			<form onsubmit={guardar}>
				<label class="campo">
					<span class="campo__etiqueta">Nombre</span>
					<input class="campo__control" bind:value={form.nombre} placeholder="Ej.: Cubierta" />
					<span class="campo__ayuda">Es lo que verá el ciudadano como título del video.</span>
					{#if erroresCampo.nombre}<span class="campo__error">{erroresCampo.nombre}</span>{/if}
				</label>

				<label class="campo">
					<span class="campo__etiqueta">Instrucción</span>
					<textarea
						class="campo__control"
						rows="3"
						maxlength="300"
						bind:value={form.instruccion}
						placeholder="Ej.: Grabe el techo recorriéndolo despacio, de un extremo al otro."
					></textarea>
					<span class="campo__ayuda">
						Dígale exactamente qué enfocar. Sin esto, la mitad de los videos no sirven.
					</span>
					{#if erroresCampo.instruccion}
						<span class="campo__error">{erroresCampo.instruccion}</span>
					{/if}
				</label>

				<div class="duraciones">
					<label class="campo">
						<span class="campo__etiqueta">Mínimo (segundos)</span>
						<input class="campo__control" type="number" min="3" max="60" bind:value={form.segundos_min} />
						{#if erroresCampo.segundos_min}
							<span class="campo__error">{erroresCampo.segundos_min}</span>
						{/if}
					</label>
					<label class="campo">
						<span class="campo__etiqueta">Máximo (segundos)</span>
						<input class="campo__control" type="number" min="5" max="60" bind:value={form.segundos_max} />
						{#if erroresCampo.segundos_max}
							<span class="campo__error">{erroresCampo.segundos_max}</span>
						{/if}
					</label>
				</div>
				<p class="campo__ayuda">
					Cada 10 segundos son cerca de 1 MB. En una vereda con mala señal, un video largo puede
					tardar minutos en subir.
				</p>

				<label class="campo campo--fila">
					<input type="checkbox" bind:checked={form.obligatoria} />
					<span>Obligatoria</span>
				</label>
				<span class="campo__ayuda">
					Una obligatoria que falte se marca en la bandeja, pero no impide enviar la solicitud:
					nadie se queda sin turno por un celular viejo.
				</span>
				{#if erroresCampo.obligatoria}
					<span class="campo__error">{erroresCampo.obligatoria}</span>
				{/if}

				<div class="modal__acciones">
					<button
						type="button"
						class="boton boton--suave"
						onclick={() => (modo = { tipo: 'cerrado' })}
						disabled={guardando}
					>
						Cancelar
					</button>
					<button class="boton" type="submit" disabled={guardando}>
						{#if guardando}<LoaderCircle size={15} class="girando" aria-hidden="true" />{/if}
						<Check size={15} aria-hidden="true" />
						Guardar
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.9rem;
	}

	.cabecera .tarjeta__nota {
		flex: 1 1 20rem;
		margin: 0;
	}

	.cargando,
	.vacio {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		text-align: center;
		color: var(--color-muted);
	}

	.lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}

	.fila {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		background: var(--color-surface);
	}

	.fila--inactiva {
		opacity: 0.6;
	}

	.fila__orden {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.fila__datos {
		flex: 1;
		min-width: 0;
	}

	.fila__nombre {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
	}

	.fila__instruccion {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		line-height: 1.4;
		color: var(--color-text);
	}

	.fila__meta {
		margin: 0.25rem 0 0;
		font-size: 0.76rem;
		color: var(--color-muted);
	}

	.fila__acciones {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.marca {
		padding: 0.05rem 0.4rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--color-muted);
	}

	.marca--obligatoria {
		border-color: var(--color-primary);
		color: var(--color-primary-dark);
	}

	.duraciones {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}
</style>
