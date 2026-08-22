<script lang="ts">
	import { goto } from '$app/navigation';
	import { LoaderCircle, LogIn } from '@lucide/svelte';
	import logo from '$lib/assets/logo-jamundi.svg';
	import { ApiError } from '$lib/api/client';
	import { sesion } from '$lib/stores/sesion.svelte';
	import { preparacion } from '$lib/offline/estado.svelte';

	let email = $state('');
	let password = $state('');
	let enviando = $state(false);
	let error = $state('');
	let errores = $state<Record<string, string>>({});

	async function enviar(evento: SubmitEvent) {
		evento.preventDefault();
		if (enviando) return;

		enviando = true;
		error = '';
		errores = {};

		try {
			await sesion.iniciar(email.trim(), password);

			// Se deja el teléfono listo para trabajar sin internet en cuanto se
			// entra: aquí hay señal por definición —se acaba de hablar con el
			// servidor— y es el único momento garantizado antes de salir a campo.
			// No se espera a que termine: descargar el formato oficial puede tardar
			// y no tiene por qué retrasar la entrada.
			void preparacion.ejecutar();

			await goto('/dashboard', { replaceState: true });
		} catch (e) {
			if (e instanceof ApiError) {
				error = e.message;
				errores = e.errors;
			} else {
				error = 'No se pudo iniciar sesión.';
			}
		} finally {
			enviando = false;
		}
	}
</script>

<div class="acceso">
	<form class="acceso__caja" onsubmit={enviar}>
		<img class="acceso__logo" src={logo} alt="Alcaldía Municipal de Jamundí" />
		<h1 class="acceso__titulo">Sistema de Gestión del Riesgo</h1>
		<p class="acceso__sub">Alcaldía Municipal de Jamundí</p>

		{#if error}
			<p class="aviso aviso--error" role="alert">{error}</p>
		{/if}

		<label class="campo">
			<span class="campo__etiqueta">Correo institucional</span>
			<input
				class="campo__control"
				type="email"
				bind:value={email}
				autocomplete="username"
				required
				disabled={enviando}
			/>
			{#if errores.email}<span class="campo__error">{errores.email}</span>{/if}
		</label>

		<label class="campo">
			<span class="campo__etiqueta">Contraseña</span>
			<input
				class="campo__control"
				type="password"
				bind:value={password}
				autocomplete="current-password"
				required
				disabled={enviando}
			/>
			{#if errores.password}<span class="campo__error">{errores.password}</span>{/if}
		</label>

		<button class="boton acceso__boton" type="submit" disabled={enviando}>
			{#if enviando}
				<LoaderCircle size={17} class="girando" aria-hidden="true" />
				Entrando…
			{:else}
				<LogIn size={17} aria-hidden="true" />
				Entrar
			{/if}
		</button>

		<p class="acceso__pie">
			¿No tienes acceso? Solicítalo a un administrador del sistema.
		</p>
	</form>
</div>

<style>
	.acceso {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 1.25rem;
		background: var(--gradient-brand, var(--color-primary-deep));
	}

	.acceso__caja {
		width: min(420px, 100%);
		background: var(--color-surface);
		border-radius: 16px;
		padding: 2rem 1.6rem 1.6rem;
		box-shadow: 0 22px 60px rgb(4 22 48 / 32%);
		text-align: left;
	}

	.acceso__logo {
		display: block;
		width: 74px;
		margin: 0 auto 1rem;
	}

	.acceso__titulo {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 800;
		text-align: center;
		color: var(--color-text);
	}

	.acceso__sub {
		margin: 0.25rem 0 1.5rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--color-muted);
	}

	.acceso__boton {
		width: 100%;
		justify-content: center;
		padding: 0.65rem;
		font-size: 0.92rem;
	}

	.acceso__pie {
		margin: 1.1rem 0 0;
		text-align: center;
		font-size: 0.78rem;
		color: var(--color-muted);
	}
</style>
