<script lang="ts">
	// Aviso permanente de dónde está guardado el reporte.
	//
	// Se dice explícitamente "en este dispositivo" porque es la verdad y porque
	// cambia lo que el ciudadano debe esperar: si limpia el navegador o cambia de
	// teléfono, el borrador no le sigue.

	import { Check, CloudOff, LoaderCircle, TriangleAlert, RotateCcw } from '@lucide/svelte';
	import { describirEstado, type EstadoGuardado } from '../borrador.svelte';

	type Props = {
		estado: EstadoGuardado;
		guardadoEn: number | null;
		enLinea: boolean;
		/**
		 * El aviso de que no hay señal, entero.
		 *
		 * Se pasa la frase completa y no solo el sustantivo porque en español hay
		 * que concordar: «su reporte está guardado» pero «su inspección está
		 * guardada». Un hueco donde meter la palabra produciría una de las dos mal.
		 */
		sinConexion?: string;
		/**
		 * El texto ya redactado. Cada formulario tiene su propio borrador y sus
		 * propias frases; sin esto, la inspección heredaría las del censo.
		 */
		texto?: string;
	};

	let {
		estado,
		guardadoEn,
		enLinea,
		sinConexion = 'Sin conexión. Su reporte está guardado en este dispositivo.',
		texto
	}: Props = $props();

	const mensaje = $derived(texto ?? describirEstado(estado, guardadoEn));
</script>

<p class="estado" class:estado--error={estado === 'error'} role="status" aria-live="polite">
	{#if !enLinea}
		<CloudOff size={14} aria-hidden="true" />
		{sinConexion}
	{:else if estado === 'guardando'}
		<LoaderCircle size={14} class="girando" aria-hidden="true" />
		{mensaje}
	{:else if estado === 'error'}
		<TriangleAlert size={14} aria-hidden="true" />
		{mensaje}
	{:else if estado === 'recuperado'}
		<RotateCcw size={14} aria-hidden="true" />
		{mensaje}
	{:else if estado === 'guardado'}
		<Check size={14} aria-hidden="true" />
		{mensaje}
	{:else}
		{mensaje}
	{/if}
</p>

<style>
	.estado {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0 0 0.9rem;
		font-size: 0.78rem;
		color: var(--color-muted);
		min-height: 1.2rem;
	}

	.estado--error {
		color: var(--color-danger);
	}
</style>
