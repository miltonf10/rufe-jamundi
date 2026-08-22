<script lang="ts">
	// Revisión previa al envío.
	//
	// Muestra las etiquetas, nunca los códigos: el ciudadano eligió "Cédula de
	// ciudadanía", no "3", y un resumen que dijera 3 no le serviría para
	// comprobar nada. Cada bloque lleva su enlace de vuelta al paso que lo llenó.

	import { Pencil } from '@lucide/svelte';
	import type { Catalogos, FormularioRufe } from '../tipos';
	import type { IdPaso } from '../esquema';
	import { muestraCorregimiento, muestraDireccionAlojamiento } from '../esquema';
	import { soloDigitos } from '../validacion';

	type Props = {
		datos: FormularioRufe;
		catalogos: Catalogos;
		archivos: number;
		irAPaso: (paso: IdPaso) => void;
	};

	let { datos, catalogos, archivos, irAPaso }: Props = $props();

	function etiquetaTextual(lista: { codigo: string; etiqueta: string }[], valor: string): string {
		return lista.find((o) => o.codigo === valor)?.etiqueta ?? '—';
	}

	function etiquetaNumerada(
		lista: { codigo: number; etiqueta: string }[],
		valor: number | null
	): string {
		return lista.find((o) => o.codigo === valor)?.etiqueta ?? '—';
	}

	function fechaLegible(iso: string): string {
		if (!iso) return '—';
		const [a, m, d] = iso.split('-');

		return `${d}/${m}/${a}`;
	}

	function nacimiento(p: FormularioRufe['personas'][number]): string {
		if (!p.nacimiento_dia || !p.nacimiento_mes || !p.nacimiento_ano) return 'No informa';

		return `${p.nacimiento_dia}/${p.nacimiento_mes}/${p.nacimiento_ano}`;
	}

	const lugarEtiqueta = $derived(datos.zona === 'RURAL' ? 'Vereda o sector' : 'Barrio');
</script>

{#snippet bloque(titulo: string, paso: IdPaso, filas: [string, string][])}
	<section class="tarjeta bloque">
		<header class="bloque__cabecera">
			<h3 class="bloque__titulo">{titulo}</h3>
			<button type="button" class="boton boton--suave" onclick={() => irAPaso(paso)}>
				<Pencil size={14} aria-hidden="true" />
				Editar
			</button>
		</header>

		<dl class="datos">
			{#each filas as [etiqueta, valor] (etiqueta)}
				<div class="dato">
					<dt>{etiqueta}</dt>
					<dd>{valor || '—'}</dd>
				</div>
			{/each}
		</dl>
	</section>
{/snippet}

<div class="resumen">
	{@render bloque('El evento', 'evento', [
		['Qué ocurrió', datos.evento === 'OTRO' ? datos.evento_otro : datos.evento],
		['Fecha del evento', fechaLegible(datos.fecha_evento)],
		['Municipio', `${catalogos.fijos.municipio}, ${catalogos.fijos.departamento}`]
	])}

	{@render bloque('Ubicación del inmueble', 'ubicacion', [
		['Zona', etiquetaTextual(catalogos.zonas, datos.zona)],
		...(muestraCorregimiento(datos)
			? ([['Corregimiento', datos.corregimiento]] as [string, string][])
			: []),
		[lugarEtiqueta, datos.vereda_sector_barrio],
		['Dirección', datos.direccion],
		['Ubicación GPS', datos.latitud !== null ? 'Compartida' : 'No compartida']
	])}

	{@render bloque('El inmueble', 'inmueble', [
		['Tipo de bien', etiquetaTextual(catalogos.tipos_bien, datos.tipo_bien)],
		['Forma de tenencia', etiquetaTextual(catalogos.formas_tenencia, datos.forma_tenencia)],
		['Estado del bien', etiquetaTextual(catalogos.estados_bien, datos.estado_bien)]
	])}

	{@render bloque('Alojamiento actual', 'alojamiento', [
		['Dónde se aloja', etiquetaTextual(catalogos.alojamientos, datos.alojamiento)],
		...(muestraDireccionAlojamiento(datos)
			? ([['Dirección del alojamiento', datos.alojamiento_direccion]] as [string, string][])
			: [])
	])}

	<section class="tarjeta bloque">
		<header class="bloque__cabecera">
			<h3 class="bloque__titulo">
				Personas del hogar ({datos.personas.length})
			</h3>
			<button type="button" class="boton boton--suave" onclick={() => irAPaso('personas')}>
				<Pencil size={14} aria-hidden="true" />
				Editar
			</button>
		</header>

		{#each datos.personas as persona, i (persona.uid)}
			<article class="persona">
				<h4 class="persona__nombre">
					{i + 1}. {persona.nombres}
					{persona.apellidos}
				</h4>
				<dl class="datos">
					<div class="dato">
						<dt>Parentesco</dt>
						<dd>{etiquetaNumerada(catalogos.parentescos, persona.parentesco)}</dd>
					</div>
					<div class="dato">
						<dt>Documento</dt>
						<dd>
							{etiquetaNumerada(catalogos.tipos_documento, persona.tipo_documento)}
							{persona.numero_documento ? ` · ${persona.numero_documento}` : ''}
						</dd>
					</div>
					<div class="dato">
						<dt>Género</dt>
						<dd>{etiquetaNumerada(catalogos.generos, persona.genero)}</dd>
					</div>
					<div class="dato">
						<dt>Nacimiento</dt>
						<dd>{nacimiento(persona)}</dd>
					</div>
					<div class="dato">
						<dt>Pertenencia étnica</dt>
						<dd>{etiquetaNumerada(catalogos.etnias, persona.pertenencia_etnica)}</dd>
					</div>
					<div class="dato">
						<dt>Teléfono</dt>
						<dd>{persona.telefono || 'No informa'}</dd>
					</div>
				</dl>
			</article>
		{/each}
	</section>

	<section class="tarjeta bloque">
		<header class="bloque__cabecera">
			<h3 class="bloque__titulo">Cultivos y animales</h3>
			<button type="button" class="boton boton--suave" onclick={() => irAPaso('agropecuario')}>
				<Pencil size={14} aria-hidden="true" />
				Editar
			</button>
		</header>

		{#if datos.tiene_afectacion_agro !== true || datos.agropecuario.length === 0}
			<p class="sin-datos">No reportó afectación de cultivos ni de animales.</p>
		{:else}
			{#each datos.agropecuario as renglon, i (renglon.uid)}
				<article class="persona">
					<h4 class="persona__nombre">Renglón {i + 1}</h4>
					<dl class="datos">
						{#if renglon.tipo_cultivo}
							<div class="dato">
								<dt>Cultivo</dt>
								<dd>
									{renglon.tipo_cultivo} · {renglon.area_cantidad}
									{etiquetaTextual(catalogos.unidades_medida, renglon.unidad_medida)}
								</dd>
							</div>
						{/if}
						{#if renglon.especie_pecuaria}
							<div class="dato">
								<dt>Animales</dt>
								<dd>{renglon.especie_pecuaria} · {renglon.cantidad_unidades} unidades</dd>
							</div>
						{/if}
					</dl>
				</article>
			{/each}
		{/if}
	</section>

	{@render bloque('Fotos y contacto', 'evidencias', [
		['Fotos adjuntas', archivos === 0 ? 'Ninguna' : `${archivos}`],
		['Teléfono de contacto', soloDigitos(datos.contacto_telefono)],
		['Correo electrónico', datos.contacto_correo || 'No informa'],
		['Observaciones', datos.observaciones || 'Ninguna']
	])}
</div>

<style>
	.resumen {
		display: grid;
		gap: 0.75rem;
	}

	.bloque {
		padding: 0.9rem;
	}

	.bloque__cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.7rem;
	}

	.bloque__titulo {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
	}

	.datos {
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}

	.dato {
		display: grid;
		grid-template-columns: minmax(9rem, 38%) 1fr;
		gap: 0.5rem;
		font-size: 0.84rem;
	}

	.dato dt {
		color: var(--color-muted);
	}

	.dato dd {
		margin: 0;
		word-break: break-word;
	}

	.persona {
		padding-top: 0.7rem;
		margin-top: 0.7rem;
		border-top: 1px solid var(--color-border);
	}

	.persona:first-of-type {
		padding-top: 0;
		margin-top: 0;
		border-top: 0;
	}

	.persona__nombre {
		margin: 0 0 0.4rem;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.sin-datos {
		margin: 0;
		font-size: 0.84rem;
		color: var(--color-muted);
	}

	@media (max-width: 420px) {
		.dato {
			grid-template-columns: 1fr;
			gap: 0.05rem;
		}
	}
</style>
