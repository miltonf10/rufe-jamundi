<script lang="ts">
	// Sector agropecuario: hasta 4 renglones, cada uno con cultivo, animales o
	// ambos. Igual que con las personas, el papel usa una tabla y aquí son
	// tarjetas: cinco columnas no caben en 360 px.

	import { Plus, Trash2 } from '@lucide/svelte';
	import CampoTexto from './CampoTexto.svelte';
	import CampoSelect from './CampoSelect.svelte';
	import type { Catalogos, RenglonAgro } from '../tipos';
	import { renglonAgroVacio } from '../esquema';

	type Props = {
		renglones: RenglonAgro[];
		catalogos: Catalogos;
		errores: Record<string, string>;
		alCambiar: () => void;
	};

	let { renglones = $bindable([]), catalogos, errores, alCambiar }: Props = $props();

	const limite = $derived(catalogos.limites.agropecuario);
	const lleno = $derived(renglones.length >= limite);

	const unidades = $derived(
		catalogos.unidades_medida.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta }))
	);

	function agregar() {
		if (lleno) return;
		renglones.push(renglonAgroVacio());
		alCambiar();
	}

	function quitar(uid: string) {
		renglones = renglones.filter((r) => r.uid !== uid);
		alCambiar();
	}
</script>

<div class="lista" id="campo-agropecuario">
	{#if errores.agropecuario}
		<p class="aviso aviso--error" role="alert">{errores.agropecuario}</p>
	{/if}

	{#each renglones as renglon, i (renglon.uid)}
		<article class="tarjeta renglon">
			<header class="renglon__cabecera">
				<h3 class="renglon__titulo">Renglón {i + 1}</h3>
				<button
					type="button"
					class="boton boton--peligro"
					onclick={() => quitar(renglon.uid)}
					aria-label="Quitar el renglón {i + 1}"
				>
					<Trash2 size={15} aria-hidden="true" />
				</button>
			</header>

			{#if errores[`agropecuario.${i}`]}
				<p class="aviso aviso--error" role="alert">{errores[`agropecuario.${i}`]}</p>
			{/if}

			<p class="renglon__seccion">Cultivos</p>

			<CampoTexto
				id="agropecuario.{i}.tipo_cultivo"
				etiqueta="Tipo de cultivo"
				maximo={120}
				marcador="Plátano, caña, maíz…"
				ayuda="Déjelo vacío si solo perdió animales."
				bind:valor={renglon.tipo_cultivo}
				error={errores[`agropecuario.${i}.tipo_cultivo`] ?? ''}
				{alCambiar}
			/>

			<!-- C10: la unidad y el área solo tienen sentido si hay cultivo. -->
			{#if renglon.tipo_cultivo.trim()}
				<div class="pareja">
					<CampoSelect
						id="agropecuario.{i}.unidad_medida"
						etiqueta="Unidad de medida"
						requerido
						opciones={unidades}
						bind:valor={renglon.unidad_medida}
						error={errores[`agropecuario.${i}.unidad_medida`] ?? ''}
						{alCambiar}
					/>

					<CampoTexto
						id="agropecuario.{i}.area_cantidad"
						etiqueta="Área afectada"
						requerido
						tipo="number"
						modoTeclado="numeric"
						min="0"
						bind:valor={renglon.area_cantidad}
						error={errores[`agropecuario.${i}.area_cantidad`] ?? ''}
						{alCambiar}
					/>
				</div>
			{/if}

			<p class="renglon__seccion">Animales</p>

			<CampoTexto
				id="agropecuario.{i}.especie_pecuaria"
				etiqueta="Especie"
				maximo={120}
				marcador="Gallinas, cerdos, ganado…"
				ayuda="Déjelo vacío si solo perdió cultivos."
				bind:valor={renglon.especie_pecuaria}
				error={errores[`agropecuario.${i}.especie_pecuaria`] ?? ''}
				{alCambiar}
			/>

			<!-- C11 -->
			{#if renglon.especie_pecuaria.trim()}
				<CampoTexto
					id="agropecuario.{i}.cantidad_unidades"
					etiqueta="Cantidad de animales"
					requerido
					tipo="number"
					modoTeclado="numeric"
					min="1"
					bind:valor={renglon.cantidad_unidades}
					error={errores[`agropecuario.${i}.cantidad_unidades`] ?? ''}
					{alCambiar}
				/>
			{/if}
		</article>
	{/each}

	<button type="button" class="boton agregar" onclick={agregar} disabled={lleno}>
		<Plus size={16} aria-hidden="true" />
		Agregar renglón
	</button>

	{#if lleno}
		<p class="tope">El formato oficial permite hasta {limite} renglones.</p>
	{/if}
</div>

<style>
	.lista {
		display: grid;
		gap: 0.75rem;
	}

	.renglon {
		padding: 0.85rem;
	}

	.renglon__cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}

	.renglon__titulo {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.renglon__seccion {
		margin: 0.9rem 0 0.5rem;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
	}

	.pareja {
		display: grid;
		gap: 0.5rem;
	}

	@media (min-width: 480px) {
		.pareja {
			grid-template-columns: 1fr 1fr;
		}
	}

	.agregar {
		justify-content: center;
		min-height: 46px;
	}

	.tope {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted);
	}
</style>
