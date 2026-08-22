<script lang="ts">
	// Información demográfica: de 1 a 10 personas.
	//
	// Es el punto donde la gente abandona el formulario, así que se aparta del
	// papel en la forma aunque no en el fondo: en vez de una tabla de 10 filas por
	// 9 columnas (90 celdas imposibles en un teléfono), una lista de tarjetas que
	// se editan en línea. No se usa un modal a propósito: en móvil tapa el resto y
	// hace perder la noción de dónde se está.

	import { ChevronDown, Pencil, Plus, Trash2, UserRound } from '@lucide/svelte';
	import CampoTexto from './CampoTexto.svelte';
	import CampoSelect from './CampoSelect.svelte';
	import CampoOpciones from './CampoOpciones.svelte';
	import CampoFechaPartes from './CampoFechaPartes.svelte';
	import type { Catalogos, Persona } from '../tipos';
	import { muestraDocumentoOtro, muestraNumeroDocumento, personaVacia } from '../esquema';

	type Props = {
		personas: Persona[];
		catalogos: Catalogos;
		errores: Record<string, string>;
		telefonoContacto: string;
		alCambiar: () => void;
	};

	let {
		personas = $bindable([]),
		catalogos,
		errores,
		telefonoContacto,
		alCambiar
	}: Props = $props();

	let editando = $state<string | null>(null);

	const limite = $derived(catalogos.limites.personas);
	const lleno = $derived(personas.length >= limite);

	const opcionesDocumento = $derived(
		catalogos.tipos_documento.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta }))
	);
	const opcionesParentesco = $derived(
		catalogos.parentescos.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta }))
	);
	const opcionesGenero = $derived(
		catalogos.generos.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta }))
	);
	const opcionesEtnia = $derived(
		catalogos.etnias.map((o) => ({ valor: o.codigo, etiqueta: o.etiqueta }))
	);

	function agregar() {
		if (lleno) return;

		// La primera persona es siempre el jefe de hogar: el formato lo exige y
		// preseleccionarlo ahorra un paso al caso más común, que es alguien
		// registrando a su propia familia.
		const esPrimera = personas.length === 0;
		const nueva = personaVacia(esPrimera ? catalogos.parentesco_jefe : undefined);

		if (esPrimera && telefonoContacto) nueva.telefono = telefonoContacto;

		personas.push(nueva);
		editando = nueva.uid;
		alCambiar();
	}

	function quitar(uid: string) {
		personas = personas.filter((p) => p.uid !== uid);
		if (editando === uid) editando = null;
		alCambiar();
	}

	function alternar(uid: string) {
		editando = editando === uid ? null : uid;
	}

	function esJefe(p: Persona): boolean {
		return p.parentesco === catalogos.parentesco_jefe;
	}

	function otroJefe(uid: string): boolean {
		return personas.some((p) => p.uid !== uid && esJefe(p));
	}

	function tituloDe(p: Persona, i: number): string {
		const nombre = `${p.nombres} ${p.apellidos}`.trim();

		return nombre || `Persona ${i + 1}`;
	}

	function subtituloDe(p: Persona): string {
		const partes: string[] = [];
		const parentesco = catalogos.parentescos.find((x) => x.codigo === p.parentesco);
		if (parentesco) partes.push(parentesco.etiqueta);
		if (p.numero_documento) partes.push(`Doc. ${p.numero_documento}`);

		return partes.join(' · ');
	}

	/** ¿Esta tarjeta tiene algún error? Sirve para marcarla sin abrirla. */
	function tieneErrores(i: number): boolean {
		return Object.keys(errores).some((k) => k.startsWith(`personas.${i}.`));
	}
</script>

<div class="lista" id="campo-personas">
	<p class="contador" aria-live="polite">
		{personas.length} de {limite}
		{personas.length === 1 ? 'persona registrada' : 'personas registradas'}
	</p>

	{#if errores.personas}
		<p class="aviso aviso--error" role="alert">{errores.personas}</p>
	{/if}

	{#each personas as persona, i (persona.uid)}
		{@const abierta = editando === persona.uid}
		<article class="tarjeta persona" class:persona--error={tieneErrores(i)}>
			<header class="persona__cabecera">
				<span class="persona__icono" aria-hidden="true"><UserRound size={18} /></span>

				<span class="persona__identidad">
					<span class="persona__nombre">{tituloDe(persona, i)}</span>
					{#if subtituloDe(persona)}
						<span class="persona__meta">{subtituloDe(persona)}</span>
					{/if}
				</span>

				<button
					type="button"
					class="boton boton--suave"
					aria-expanded={abierta}
					aria-controls="persona-{persona.uid}"
					onclick={() => alternar(persona.uid)}
				>
					{#if abierta}
						<ChevronDown size={15} aria-hidden="true" />
						Listo
					{:else}
						<Pencil size={15} aria-hidden="true" />
						Editar
					{/if}
				</button>

				<button
					type="button"
					class="boton boton--peligro"
					onclick={() => quitar(persona.uid)}
					aria-label="Quitar a {tituloDe(persona, i)} del reporte"
				>
					<Trash2 size={15} aria-hidden="true" />
				</button>
			</header>

			{#if abierta}
				<div class="persona__campos" id="persona-{persona.uid}">
					<CampoTexto
						id="personas.{i}.nombres"
						etiqueta="Nombre(s)"
						requerido
						maximo={120}
						autocompletar="off"
						bind:valor={persona.nombres}
						error={errores[`personas.${i}.nombres`] ?? ''}
						{alCambiar}
					/>

					<CampoTexto
						id="personas.{i}.apellidos"
						etiqueta="Apellido(s)"
						requerido
						maximo={120}
						autocompletar="off"
						bind:valor={persona.apellidos}
						error={errores[`personas.${i}.apellidos`] ?? ''}
						{alCambiar}
					/>

					<CampoSelect
						id="personas.{i}.parentesco"
						etiqueta="Parentesco con el jefe de hogar"
						requerido
						numerico
						opciones={opcionesParentesco}
						bind:valor={persona.parentesco}
						error={errores[`personas.${i}.parentesco`] ?? ''}
						{alCambiar}
					/>

					{#if esJefe(persona) && otroJefe(persona.uid)}
						<p class="aviso aviso--error" role="alert">
							Ya hay otra persona marcada como jefe de hogar. Solo puede haber una.
						</p>
					{/if}

					<CampoSelect
						id="personas.{i}.tipo_documento"
						etiqueta="Tipo de documento"
						requerido
						numerico
						opciones={opcionesDocumento}
						bind:valor={persona.tipo_documento}
						error={errores[`personas.${i}.tipo_documento`] ?? ''}
						{alCambiar}
					/>

					<!-- C5 y C6: los códigos "sin identificación" no llevan número. -->
					{#if muestraNumeroDocumento(persona, catalogos.documentos_sin_numero)}
						<CampoTexto
							id="personas.{i}.numero_documento"
							etiqueta="Número de documento"
							requerido
							maximo={30}
							modoTeclado={catalogos.documentos_alfanumericos.includes(persona.tipo_documento ?? 0)
								? 'text'
								: 'numeric'}
							ayuda="Sin puntos ni espacios."
							bind:valor={persona.numero_documento}
							error={errores[`personas.${i}.numero_documento`] ?? ''}
							{alCambiar}
						/>
					{/if}

					<!-- C7 -->
					{#if muestraDocumentoOtro(persona, catalogos.documento_otro)}
						<CampoTexto
							id="personas.{i}.documento_otro"
							etiqueta="¿Cuál documento?"
							requerido
							maximo={60}
							bind:valor={persona.documento_otro}
							error={errores[`personas.${i}.documento_otro`] ?? ''}
							{alCambiar}
						/>
					{/if}

					<CampoOpciones
						id="personas.{i}.genero"
						etiqueta="Identidad de género"
						requerido
						columnas
						ayuda="Dato sensible. Se usa solo para estadísticas de atención."
						opciones={opcionesGenero}
						bind:valor={persona.genero}
						error={errores[`personas.${i}.genero`] ?? ''}
						{alCambiar}
					/>

					<CampoFechaPartes
						id="personas.{i}.fecha_nacimiento"
						etiqueta="Fecha de nacimiento"
						ayuda="Opcional. Ayuda a priorizar la atención de niños y adultos mayores."
						bind:dia={persona.nacimiento_dia}
						bind:mes={persona.nacimiento_mes}
						bind:ano={persona.nacimiento_ano}
						error={errores[`personas.${i}.fecha_nacimiento`] ?? ''}
						{alCambiar}
					/>

					<CampoSelect
						id="personas.{i}.pertenencia_etnica"
						etiqueta="Pertenencia étnica"
						requerido
						numerico
						ayuda="Dato sensible. Si no se reconoce en ninguna, elija «No aplica»."
						opciones={opcionesEtnia}
						bind:valor={persona.pertenencia_etnica}
						error={errores[`personas.${i}.pertenencia_etnica`] ?? ''}
						{alCambiar}
					/>

					<CampoTexto
						id="personas.{i}.telefono"
						etiqueta="Teléfono"
						tipo="tel"
						modoTeclado="tel"
						maximo={30}
						requerido={esJefe(persona)}
						ayuda={esJefe(persona)
							? 'A este número lo llamaremos para el seguimiento.'
							: 'Opcional.'}
						bind:valor={persona.telefono}
						error={errores[`personas.${i}.telefono`] ?? ''}
						{alCambiar}
					/>
				</div>
			{/if}
		</article>
	{/each}

	{#if personas.length === 0}
		<p class="vacio">Todavía no ha registrado a nadie.</p>
	{/if}

	<button type="button" class="boton agregar" onclick={agregar} disabled={lleno}>
		<Plus size={16} aria-hidden="true" />
		{personas.length === 0 ? 'Agregar al jefe de hogar' : 'Agregar otra persona'}
	</button>

	{#if lleno}
		<p class="tope">
			El formato oficial permite hasta {limite} personas. Si su hogar es más numeroso,
			comuníquese con la Secretaría de Gestión del Riesgo.
		</p>
	{/if}
</div>

<style>
	.lista {
		display: grid;
		gap: 0.75rem;
	}

	.contador {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-muted);
	}

	.persona {
		padding: 0.85rem;
	}

	/* El borde grueso, y no solo el color, marca la tarjeta con errores: quien no
	   distinga el rojo igual ve que esa tarjeta destaca. */
	.persona--error {
		border: 2px solid var(--color-danger);
	}

	.persona__cabecera {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.persona__icono {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: 50%;
		background: var(--color-surface-alt);
		color: var(--color-primary);
	}

	.persona__identidad {
		flex: 1;
		min-width: 0;
	}

	.persona__nombre {
		display: block;
		font-weight: 600;
		font-size: 0.92rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.persona__meta {
		display: block;
		font-size: 0.76rem;
		color: var(--color-muted);
	}

	.persona__campos {
		margin-top: 0.9rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--color-border);
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
