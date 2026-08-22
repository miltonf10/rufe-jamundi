<script lang="ts">
	// El numeral 6: qué combo de materiales corresponde y por qué.
	//
	// El combo NO se elige: sale de la evaluación técnica, siguiendo la regla
	// impresa en el formato. Por eso aquí no hay casillas que marcar salvo el kit
	// de cubierta — que sí es una decisión del profesional.
	//
	// Se muestra siempre el PORQUÉ junto al resultado. Quien revisa el
	// expediente, y sobre todo la familia que pregunta por qué le dan un combo y
	// no otro, tiene derecho a ver el razonamiento sin rehacerlo. Un número solo
	// se parece demasiado a una decisión arbitraria.
	//
	// El combo que se ve aquí lo calcula el navegador para que cambie al
	// instante mientras se llena la tabla; el que queda en el expediente lo
	// calcula el servidor. Coinciden porque las dos implementaciones ejecutan la
	// misma tabla de casos.

	import { Info, PackageCheck, Scale, TriangleAlert } from '@lucide/svelte';
	import CampoOpciones from '$lib/rufe-form/componentes/CampoOpciones.svelte';
	import type { ResultadoCombo } from '../combo';
	import type { Explicacion } from '../explicacion';
	import type { ListaMateriales } from '../detalle';

	type Props = {
		resultado: ResultadoCombo;
		motivo: string;
		/** La cadena de razonamiento, para el desplegable de auditoría. */
		explicacion: Explicacion;
		materiales: ListaMateriales | null;
		kits: { codigo: string; etiqueta: string }[];
		kitCubierta: string;
		sugerido: string | null;
		error?: string;
		alCambiar?: () => void;
	};

	let {
		resultado,
		motivo,
		explicacion,
		materiales,
		kits,
		kitCubierta = $bindable(''),
		sugerido,
		error = '',
		alCambiar
	}: Props = $props();

	const opciones = $derived(kits.map((k) => ({ valor: k.codigo, etiqueta: k.etiqueta })));

	const totalItems = $derived(
		(materiales?.kits ?? []).reduce((suma, k) => suma + k.items.length, 0)
	);
</script>

{#if resultado.combo === null}
	<p class="aviso aviso--info" role="status">
		<Info size={15} aria-hidden="true" />
		{motivo}
	</p>
{:else}
	<div class="combo">
		<div class="combo__cabecera">
			<PackageCheck size={20} aria-hidden="true" />
			<div>
				<p class="combo__nombre">{resultado.etiqueta}</p>
				<!-- El porqué, no solo el qué. -->
				<p class="combo__motivo">{motivo}</p>
			</div>
		</div>
	</div>
{/if}

<!--
	De dónde sale la decisión, para quien la revisa.

	Va cerrado: lo primero que hay que ver sigue siendo el combo. Pero de aquí
	sale una entrega de materiales públicos, y una decisión que reparte recursos
	sin poder auditarse se parece demasiado a una decisión arbitraria.

	Se muestra TAMBIÉN cuando no corresponde combo, que es cuando más falta hace:
	esa es la familia que va a preguntar por qué no le dan nada.

	`<details>` nativo y no el patrón de botón + `{#if}` de `TablaEvaluacion`:
	aquí no hay que recordar el estado de varios desplegables a la vez, y el
	elemento nativo ya trae teclado y semántica sin una línea de código.
-->
{#if explicacion.mapa.length > 0}
	<details class="porque">
		<summary class="porque__resumen">
			<Scale size={15} aria-hidden="true" />
			<span>¿De dónde sale esta decisión?</span>
		</summary>

		<div class="porque__cuerpo">
			<!-- La norma, citada. Quien revisa tiene que ver la regla, no mi resumen. -->
			<blockquote class="regla">
				{explicacion.regla}
				<cite>Numeral 6 del formato</cite>
			</blockquote>

			{#if explicacion.colapsoTotal}
				<p class="porque__nota">
					Se marcó <strong>colapso estructural total</strong>. El formato indica marcar solo esa
					casilla, así que la tabla por elementos del numeral 5.4 no se diligencia y el combo sale
					directamente de ahí.
				</p>
			{:else}
				<section class="bloque">
					<h4 class="bloque__titulo">Hasta dónde llegó el daño estructural</h4>
					<ol class="escala">
						{#each explicacion.escala as peldano (peldano.codigo)}
							<li
								class="escala__paso escala__paso--{peldano.codigo.toLowerCase()}"
								class:escala__paso--alcanzado={peldano.alcanzado}
								class:escala__paso--marcado={peldano.esElNivel}
								aria-current={peldano.esElNivel ? 'step' : undefined}
							>
								<span class="escala__barra" aria-hidden="true"></span>
								<span class="escala__nombre">{peldano.etiqueta}</span>
								{#if peldano.esElNivel}
									<span class="escala__alcance">{peldano.alcance}</span>
								{/if}
							</li>
						{/each}
					</ol>
				</section>

				<section class="bloque">
					<h4 class="bloque__titulo">Lo que se evaluó, elemento por elemento</h4>
					<div class="desliza">
						<table class="detalle">
							<thead>
								<tr>
									<th scope="col">Elemento</th>
									<th scope="col">Nivel</th>
									<th scope="col">¿Decide?</th>
								</tr>
							</thead>
							<tbody>
								{#each explicacion.filas as fila (fila.codigo)}
									<tr class:detalle__fila--decide={fila.decide}>
										<td>
											{fila.etiqueta}
											{#if fila.estructural}
												<span class="marca">estructural</span>
											{/if}
										</td>
										<td>
											{#if fila.nivel}
												<span class="chip chip--{fila.nivel.toLowerCase()}">{fila.nivelEtiqueta}</span>
											{:else}
												<span class="detalle__sin">No afectado</span>
											{/if}
										</td>
										<td>
											{#if fila.decide}
												<strong class="detalle__decide">Fija el combo</strong>
											{:else if fila.estructural}
												<span class="detalle__sin">No es el peor</span>
											{:else}
												<span class="detalle__sin">No decide</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="porque__nota">
						Los elementos <strong>no estructurales</strong> se registran y quedan en el expediente,
						pero no cambian el combo: una cubierta destruida sobre una estructura intacta no
						convierte el caso en severo. Entregar de más ahí dejaría sin materiales otra vivienda
						donde la estructura sí cedió.
					</p>
				</section>
			{/if}

			<section class="bloque">
				<h4 class="bloque__titulo">Qué combo corresponde a cada nivel</h4>
				<div class="desliza">
					<table class="detalle">
						<thead>
							<tr>
								<th scope="col">Nivel estructural</th>
								<th scope="col">Combo</th>
							</tr>
						</thead>
						<tbody>
							{#each explicacion.mapa as fila (fila.nivel)}
								<tr class:detalle__fila--decide={fila.esElResultado}>
									<td>
										<span class="chip chip--{fila.nivel.toLowerCase()}">{fila.nivelEtiqueta}</span>
									</td>
									<td>
										{fila.combo}
										{#if fila.esElResultado}
											<strong class="detalle__decide">← el de esta vivienda</strong>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	</details>
{/if}

{#if kits.length > 0}
	<CampoOpciones
		id="kit_cubierta"
		etiqueta="Kit de cubierta"
		bind:valor={kitCubierta}
		opciones={opciones}
		{error}
		ayuda={sugerido
			? 'Según el material de cubierta que registró, corresponde el kit marcado. Puede cambiarlo.'
			: 'Elija el kit según la cubierta que se va a instalar.'}
		{alCambiar}
	/>
{/if}

{#if materiales}
	{#if materiales.sin_lista}
		<p class="aviso aviso--alerta" role="status">
			<TriangleAlert size={15} aria-hidden="true" />
			<!--
				El Anexo 2 solo trae columnas para leve, moderado y severo. Para el
				colapso total el formato nombra un combo pero no lista sus
				materiales. Se dice, en vez de rellenarlo con las cantidades del
				severo: son materiales públicos y una cifra inventada no se
				distingue de una correcta al imprimirla.
			-->
			{materiales.nota || 'Este combo no tiene lista de materiales en el Anexo 2.'}
		</p>
	{:else}
		<div class="materiales">
			<p class="materiales__titulo">
				Materiales del Anexo 2
				<span class="materiales__cuenta">{totalItems} renglones</span>
			</p>

			{#each materiales.kits as kit (kit.kit)}
				<div class="kit">
					<p class="kit__nombre">{kit.kit}</p>
					<table class="kit__tabla">
						<thead>
							<tr>
								<th scope="col">Descripción</th>
								<th scope="col">Und</th>
								<th scope="col" class="kit__num">Cantidad</th>
							</tr>
						</thead>
						<tbody>
							{#each kit.items as item (item.descripcion)}
								<tr>
									<td>{item.descripcion}</td>
									<td>{item.unidad}</td>
									<td class="kit__num">{item.cantidad}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}

			<p class="materiales__nota">
				<!--
					El cemento, por ejemplo, aparece en el kit de estructura y otra vez
					en el de mampostería, con cantidades distintas. Son partidas
					distintas del anexo y sumarlas o fundirlas cambiaría la entrega.
				-->
				Cada kit se lista por separado, tal como el Anexo 2. Un mismo material puede aparecer en
				más de un kit con cantidades distintas.
			</p>
		</div>
	{/if}
{/if}

<style>
	.combo {
		margin: 0.4rem 0 1rem;
		padding: 0.85rem;
		border: 1px solid var(--color-primary);
		border-radius: 0.6rem;
		background: var(--color-info-bg);
	}

	.combo__cabecera {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		color: var(--aviso-info-texto);
	}

	.combo__nombre {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.combo__motivo {
		margin: 0.15rem 0 0;
		font-size: 0.83rem;
		line-height: 1.4;
	}

	/* ── El desplegable del porqué ─────────────────────────────────────────── */

	.porque {
		margin: -0.6rem 0 1rem;
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		background: var(--color-surface);
		overflow: hidden;
	}

	.porque__resumen {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.6rem;
		padding: 0.5rem 0.7rem;
		background: var(--color-surface-alt);
		font-size: 0.83rem;
		font-weight: 600;
		color: var(--color-text);
		cursor: pointer;
		list-style: none;
	}

	/* Safari dibuja su propio triángulo y descoloca la fila. */
	.porque__resumen::-webkit-details-marker {
		display: none;
	}

	.porque__resumen::after {
		content: '▾';
		margin-left: auto;
		font-size: 0.9rem;
		color: var(--color-muted);
	}

	.porque[open] .porque__resumen::after {
		content: '▴';
	}

	.porque__cuerpo {
		padding: 0.8rem 0.7rem 0.9rem;
		border-top: 1px solid var(--color-border);
	}

	.regla {
		margin: 0 0 1rem;
		padding: 0.55rem 0.75rem;
		border-left: 3px solid var(--color-primary);
		background: var(--color-surface-alt);
		font-size: 0.83rem;
		line-height: 1.5;
		font-style: italic;
	}

	.regla cite {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.72rem;
		font-style: normal;
		color: var(--color-muted);
	}

	.bloque + .bloque {
		margin-top: 1.1rem;
	}

	.bloque__titulo {
		margin: 0 0 0.5rem;
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted);
	}

	/* La escala de gravedad: cuatro peldaños, apagados los que no se alcanzaron.
	   Se lee de un vistazo hasta dónde llegó el daño de la estructura. */
	.escala {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.escala__paso {
		min-width: 0;
	}

	.escala__barra {
		display: block;
		height: 0.4rem;
		border-radius: 999px;
		background: var(--color-border);
	}

	.escala__nombre {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		overflow-wrap: break-word;
	}

	.escala__alcance {
		display: block;
		font-size: 0.7rem;
		color: var(--color-muted);
	}

	/* Los colores del anexo impreso, los mismos que la tabla del 5.4: quien viene
	   del papel reconoce la escala sin leerla. */
	.escala__paso--alcanzado.escala__paso--leve .escala__barra {
		background: var(--nivel-leve);
	}
	.escala__paso--alcanzado.escala__paso--moderado .escala__barra {
		background: var(--nivel-moderado);
	}
	.escala__paso--alcanzado.escala__paso--severo .escala__barra {
		background: var(--nivel-severo);
	}
	.escala__paso--alcanzado.escala__paso--colapso_total .escala__barra {
		background: var(--nivel-colapso);
	}

	.escala__paso--marcado .escala__nombre {
		color: var(--color-text);
		font-weight: 700;
	}

	/* En un teléfono estrecho la tabla se desplaza sola en vez de estirar la
	   página entera. */
	.desliza {
		overflow-x: auto;
	}

	.detalle {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.detalle th,
	.detalle td {
		padding: 0.4rem 0.5rem;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--color-border);
	}

	.detalle th {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.detalle tbody tr:last-child td {
		border-bottom: 0;
	}

	.detalle__fila--decide {
		background: var(--color-info-bg);
	}

	.detalle__decide {
		color: var(--aviso-info-texto);
		font-size: 0.76rem;
		white-space: nowrap;
	}

	.detalle__sin {
		color: var(--color-muted);
	}

	.marca {
		display: inline-block;
		margin-left: 0.3rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: var(--color-info-bg);
		color: var(--aviso-info-texto);
		font-size: 0.63rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.chip {
		display: inline-block;
		padding: 0.05rem 0.4rem;
		border: 1px solid currentcolor;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.chip--leve {
		color: var(--nivel-leve);
	}
	.chip--moderado {
		color: var(--nivel-moderado);
	}
	.chip--severo {
		color: var(--nivel-severo);
	}
	.chip--colapso_total {
		color: var(--nivel-colapso);
	}

	.porque__nota {
		margin: 0.55rem 0 0;
		font-size: 0.76rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.materiales {
		margin-top: 1rem;
	}

	.materiales__titulo {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted);
	}

	.materiales__cuenta {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
	}

	.kit {
		margin-bottom: 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.kit__nombre {
		margin: 0;
		padding: 0.45rem 0.6rem;
		background: var(--color-surface-alt);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.kit__tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	.kit__tabla th,
	.kit__tabla td {
		padding: 0.35rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}

	.kit__tabla th {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--color-muted);
	}

	.kit__tabla tbody tr:last-child td {
		border-bottom: 0;
	}

	.kit__num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.materiales__nota {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-muted);
	}
</style>
