<script lang="ts">
	// Descargar una inspección en el formato oficial de la NGRD.
	//
	// Mismo patrón que el botón del RUFE: el listado no trae los datos completos,
	// así que al pulsar se pide el detalle y con él se arma el PDF. Es una
	// petición más, pero evita cargar la evaluación, el historial y las fotos de
	// todas las filas del listado solo por si alguien descarga una.
	//
	// La librería de PDF pesa, así que entra por importación dinámica: quien no
	// descargue ninguna inspección no la carga nunca.

	import { Download, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import { inspeccionApi } from '$lib/api/servicios';
	import { ApiError } from '$lib/api/client';

	let { id, numero }: { id: number; numero: string } = $props();

	let generando = $state(false);
	let error = $state<string | null>(null);

	async function descargar() {
		if (generando) return;

		generando = true;
		error = null;

		try {
			const [detalle, { generarInspeccionPdf, nombreArchivo }] = await Promise.all([
				inspeccionApi.ver(id),
				import('$lib/inspeccion-pdf/generar')
			]);

			const pdf = await generarInspeccionPdf(detalle);
			const url = URL.createObjectURL(pdf);

			const enlace = document.createElement('a');
			enlace.href = url;
			enlace.download = nombreArchivo(numero);
			enlace.click();

			// Sin revocar, el navegador conserva el PDF entero en memoria hasta
			// recargar la página. Descargando varias seguidas se nota.
			URL.revokeObjectURL(url);
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'No se pudo generar el formato. Intente de nuevo.';
		} finally {
			generando = false;
		}
	}
</script>

<button
	type="button"
	class="boton boton--suave inspeccion-pdf"
	onclick={descargar}
	disabled={generando}
	title="Descargar {numero} en el formato oficial de la NGRD"
	aria-label="Descargar la inspección {numero} en el formato oficial"
>
	{#if generando}
		<LoaderCircle size={14} class="girando" aria-hidden="true" />
		Generando…
	{:else}
		<Download size={14} aria-hidden="true" />
		PDF
	{/if}
</button>

{#if error}
	<span class="inspeccion-pdf__error" role="alert">
		<TriangleAlert size={13} aria-hidden="true" />
		{error}
	</span>
{/if}

<style>
	.inspeccion-pdf {
		white-space: nowrap;
	}

	.inspeccion-pdf__error {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.25rem;
		font-size: 0.72rem;
		color: var(--aviso-error-texto);
		overflow-wrap: anywhere;
	}
</style>
