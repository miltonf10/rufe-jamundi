<script lang="ts">
	import { LogOut, X, ChevronRight } from '@lucide/svelte';
	import logo from '$lib/assets/logo-jamundi.svg';
	import { menuParaRol, esActivo, ETIQUETA_ROL, type Seccion } from '$lib/navigation';
	import { sesion } from '$lib/stores/sesion.svelte';
	import BotonInstalar from './BotonInstalar.svelte';

	type Props = {
		rutaActual: string;
		abierto: boolean;
		onNavegar?: () => void;
		onCerrar?: () => void;
		onSalir?: () => void;
	};

	let { rutaActual, abierto, onNavegar, onCerrar, onSalir }: Props = $props();

	const secciones = $derived<Seccion[]>(menuParaRol(sesion.rol));

	// Grupos plegados manualmente. Se guarda el estado del usuario, no el
	// contrario: un grupo que contiene la página actual empieza abierto aunque
	// no se haya tocado nunca.
	let plegados = $state<Record<string, boolean>>({});

	function grupoAbierto(seccion: Seccion & { type: 'group' }): boolean {
		const manual = plegados[seccion.group.id];
		if (manual !== undefined) return manual;

		return seccion.items.some((i) => esActivo(i, rutaActual));
	}

	function alternarGrupo(id: string, estadoActual: boolean) {
		plegados[id] = !estadoActual;
	}

	const iniciales = $derived(
		(sesion.usuario?.nombre ?? '?')
			.split(/\s+/)
			.slice(0, 2)
			.map((p) => p.charAt(0).toUpperCase())
			.join('')
	);
</script>

<aside class="menu" class:menu--abierto={abierto} aria-label="Menú principal" aria-hidden={!abierto}>
	<div class="menu__marca">
		<img class="menu__logo" src={logo} alt="" aria-hidden="true" />
		<div class="menu__marca-texto">
			<div class="menu__titulo">Gestión del Riesgo</div>
			<div class="menu__subtitulo">Alcaldía de Jamundí</div>
		</div>
		<button class="menu__cerrar" type="button" aria-label="Cerrar el menú" onclick={onCerrar}>
			<X size={18} aria-hidden="true" />
		</button>
	</div>

	<nav class="menu__nav">
		{#each secciones as seccion (seccion.type === 'group' ? seccion.group.id : seccion.item.id)}
			{#if seccion.type === 'item'}
				{@const Icono = seccion.item.icon}
				<a
					class="menu__enlace"
					href={seccion.item.href}
					aria-current={esActivo(seccion.item, rutaActual) ? 'page' : undefined}
					onclick={onNavegar}
					tabindex={abierto ? 0 : -1}
				>
					{#if Icono}<Icono size={19} aria-hidden="true" />{/if}
					<span>{seccion.item.label}</span>
				</a>
			{:else}
				{@const IconoGrupo = seccion.group.icon}
				{@const desplegado = grupoAbierto(seccion)}
				<button
					class="menu__grupo"
					type="button"
					aria-expanded={desplegado}
					onclick={() => alternarGrupo(seccion.group.id, desplegado)}
					tabindex={abierto ? 0 : -1}
				>
					{#if IconoGrupo}<IconoGrupo size={19} aria-hidden="true" />{/if}
					<span class="menu__grupo-texto">{seccion.group.label}</span>
					<span class="menu__chevron" class:menu__chevron--abierto={desplegado} aria-hidden="true">
						<ChevronRight size={16} />
					</span>
				</button>

				{#if desplegado}
					<div class="menu__hijos">
						{#each seccion.items as item (item.id)}
							{@const Icono = item.icon}
							<a
								class="menu__enlace menu__enlace--hijo"
								href={item.href}
								aria-current={esActivo(item, rutaActual) ? 'page' : undefined}
								onclick={onNavegar}
								tabindex={abierto ? 0 : -1}
							>
								{#if Icono}<Icono size={17} aria-hidden="true" />{/if}
								<span>{item.label}</span>
							</a>
						{/each}
					</div>
				{/if}
			{/if}
		{/each}
	</nav>

	{#if sesion.usuario}
		<div class="menu__pie">
			<div class="menu__usuario">
				<div class="menu__avatar" aria-hidden="true">{iniciales}</div>
				<div class="menu__usuario-datos">
					<div class="menu__usuario-nombre">{sesion.usuario.nombre}</div>
					<div class="menu__usuario-rol">
						<span class="menu__punto" aria-hidden="true"></span>
						{ETIQUETA_ROL[sesion.usuario.rol]}
					</div>
				</div>
			</div>
			<!-- Instalada, Android le da al sistema garantías de almacenamiento mucho
			     mejores: deja de ser una pestaña que el navegador puede desalojar
			     llevándose las fichas que aún no se han enviado. -->
			<BotonInstalar />

			<button class="menu__salir" type="button" onclick={onSalir} tabindex={abierto ? 0 : -1}>
				<LogOut size={16} aria-hidden="true" />
				Cerrar sesión
			</button>
		</div>
	{/if}
</aside>
