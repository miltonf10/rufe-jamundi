<script lang="ts">
	// Descargar una ficha en el formato oficial FR-1703-SMD-69.
	//
	// El listado no trae los datos completos —solo el resumen de cada fila—, así
	// que al pulsar se pide el detalle y con él se arma el PDF. Es una petición
	// más, pero evita cargar de golpe las personas, el agropecuario y el historial
	// de cada una de las fichas del listado solo por si alguien descarga una.
	//
	// La librería de PDF pesa, así que entra por importación dinámica: quien no
	// descargue ninguna ficha no la carga nunca.

	import { Download, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import { rufeApi } from '$lib/api/servicios';
	import { ApiError } from '$lib/api/client';
	import { nombreArchivo } from '$lib/ficha-pdf/texto';

	let { id, radicado }: { id: number; radicado: string } = $props();

	let generando = $state(false);
	let error = $state<string | null>(null);

	async function descargar() {
		if (generando) return;

		generando = true;
		error = null;

		try {
			const [detalle, { generarFichaPdf }] = await Promise.all([
				rufeApi.ver(id),
				import('$lib/ficha-pdf/generar')
			]);

			const pdf = await generarFichaPdf(detalle);
			const url = URL.createObjectURL(pdf);

			const enlace = document.createElement('a');
			enlace.href = url;
			enlace.download = nombreArchivo(radicado);
			enlace.click();

			// Sin revocar, el navegador conserva el PDF entero en memoria hasta
			// recargar la página. Descargando varias fichas seguidas se nota.
			URL.revokeObjectURL(url);
		} catch (e) {
			error =
				e instanceof ApiError ? e.message : 'No se pudo generar la ficha. Intente de nuevo.';
		} finally {
			generando = false;
		}
	}
</script>

<button
	type="button"
	class="boton boton--suave ficha-pdf"
	onclick={descargar}
	disabled={generando}
	title="Descargar {radicado} en el formato oficial FR-1703-SMD-69"
	aria-label="Descargar la ficha {radicado} en el formato oficial"
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
	<span class="ficha-pdf__error" role="alert">
		<TriangleAlert size={13} aria-hidden="true" />
		{error}
	</span>
{/if}

<style>
	.ficha-pdf {
		white-space: nowrap;
	}

	.ficha-pdf__error {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.25rem;
		font-size: 0.72rem;
		color: var(--aviso-error-texto);
		overflow-wrap: anywhere;
	}
</style>
