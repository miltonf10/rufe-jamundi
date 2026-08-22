<script lang="ts">
	import { onMount } from 'svelte';
	import { LoaderCircle, UserPlus, Pencil, Trash2, KeyRound } from '@lucide/svelte';
	import { ApiError } from '$lib/api/client';
	import { usuariosApi, type DatosUsuario } from '$lib/api/servicios';
	import type { RolCatalogo, Usuario } from '$lib/api/tipos';
	import { fechaHora } from '$lib/formato';
	import { sesion } from '$lib/stores/sesion.svelte';

	let usuarios = $state<Usuario[]>([]);
	let roles = $state<RolCatalogo[]>([]);
	let cargando = $state(true);
	let error = $state('');
	let exito = $state('');

	type Modo = { tipo: 'cerrado' } | { tipo: 'crear' } | { tipo: 'editar'; usuario: Usuario } | { tipo: 'password'; usuario: Usuario } | { tipo: 'eliminar'; usuario: Usuario };

	let modo = $state<Modo>({ tipo: 'cerrado' });
	let guardando = $state(false);
	let erroresCampo = $state<Record<string, string>>({});
	let errorModal = $state('');

	const PERFIL_VACIO = {
		profesion: '',
		tarjeta_profesional: '',
		documento: '',
		documento_de: '',
		telefono: '',
		direccion: ''
	};

	let form = $state<DatosUsuario>({
		nombre: '',
		email: '',
		rol: 'VISUALIZACION',
		activo: true,
		password: '',
		...PERFIL_VACIO
	});

	/**
	 * Los datos del numeral 1 solo se piden a quien va a diligenciarlo.
	 *
	 * Enseñárselos a un administrador o a un visor sería pedir seis campos que
	 * nunca se van a usar, y en un formulario cada campo de más es un motivo para
	 * dejarlo a medias.
	 */
	const esInspector = $derived(form.rol === 'INSPECTOR');

	/**
	 * Las profesiones con tarjeta que habilitan para evaluar daño estructural.
	 *
	 * Vienen del servidor, de la MISMA lista que ofrece el numeral 1. Escritas
	 * aquí a mano acabarían divergiendo, y entonces el dato precargado no
	 * coincidiría con ninguna opción del formulario.
	 */
	let profesiones = $state<string[]>([]);
	let passwordNueva = $state('');

	const CLASE_ROL: Record<string, string> = {
		ADMINISTRADOR: 'etiqueta--admin',
		GESTOR: 'etiqueta--gestor',
		INSPECTOR: 'etiqueta--inspector',
		VISUALIZACION: 'etiqueta--visor'
	};

	const claseRol = (rol: string) => CLASE_ROL[rol] ?? 'etiqueta--visor';

	async function cargar() {
		cargando = true;
		error = '';
		try {
			const datos = await usuariosApi.listar();
			usuarios = datos.usuarios;
			roles = datos.roles;
			profesiones = datos.profesiones ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo cargar la lista de usuarios.';
		} finally {
			cargando = false;
		}
	}

	function abrirCrear() {
		form = { nombre: '', email: '', rol: 'VISUALIZACION', activo: true, password: '', ...PERFIL_VACIO };
		erroresCampo = {};
		errorModal = '';
		modo = { tipo: 'crear' };
	}

	function abrirEditar(u: Usuario) {
		form = {
			nombre: u.nombre,
			email: u.email,
			rol: u.rol,
			activo: u.activo,
			profesion: u.profesion ?? '',
			tarjeta_profesional: u.tarjeta_profesional ?? '',
			documento: u.documento ?? '',
			documento_de: u.documento_de ?? '',
			telefono: u.telefono ?? '',
			direccion: u.direccion ?? ''
		};
		erroresCampo = {};
		errorModal = '';
		modo = { tipo: 'editar', usuario: u };
	}

	function abrirPassword(u: Usuario) {
		passwordNueva = '';
		erroresCampo = {};
		errorModal = '';
		modo = { tipo: 'password', usuario: u };
	}

	function cerrar() {
		modo = { tipo: 'cerrado' };
	}

	/**
	 * Escape cierra el modal, salvo mientras se está guardando: cortar a mitad de
	 * un guardado deja al usuario sin saber si el cambio se aplicó.
	 */
	function alPulsar(e: KeyboardEvent) {
		if (e.key !== 'Escape' || modo.tipo === 'cerrado' || guardando) return;

		cerrar();
		e.preventDefault();
	}

	// Con el modal abierto, la página de detrás no debe desplazarse. En el
	// teléfono era especialmente confuso: al aparecer el teclado, el fondo se
	// movía y el formulario parecía irse de la pantalla.
	$effect(() => {
		if (modo.tipo === 'cerrado') return;

		const previo = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previo;
		};
	});

	/** Traduce cualquier fallo de la API a los mensajes del formulario. */
	function manejarError(e: unknown, porDefecto: string) {
		if (e instanceof ApiError) {
			errorModal = e.message;
			erroresCampo = e.errors;
		} else {
			errorModal = porDefecto;
		}
	}

	async function guardar(evento: SubmitEvent) {
		evento.preventDefault();
		if (guardando || (modo.tipo !== 'crear' && modo.tipo !== 'editar')) return;

		guardando = true;
		errorModal = '';
		erroresCampo = {};

		try {
			if (modo.tipo === 'crear') {
				await usuariosApi.crear(form);
				exito = `Usuario ${form.email} creado.`;
			} else {
				await usuariosApi.actualizar(modo.usuario.id, {
					nombre: form.nombre,
					email: form.email,
					rol: form.rol,
					profesion: form.profesion,
					tarjeta_profesional: form.tarjeta_profesional,
					documento: form.documento,
					documento_de: form.documento_de,
					telefono: form.telefono,
					direccion: form.direccion,
					activo: form.activo
				});
				exito = `Usuario ${form.email} actualizado.`;
			}
			cerrar();
			await cargar();
		} catch (e) {
			manejarError(e, 'No se pudo guardar el usuario.');
		} finally {
			guardando = false;
		}
	}

	async function guardarPassword(evento: SubmitEvent) {
		evento.preventDefault();
		if (guardando || modo.tipo !== 'password') return;

		guardando = true;
		errorModal = '';
		erroresCampo = {};

		try {
			const { mensaje } = await usuariosApi.restablecerPassword(modo.usuario.id, passwordNueva);
			exito = mensaje;
			cerrar();
		} catch (e) {
			manejarError(e, 'No se pudo restablecer la contraseña.');
		} finally {
			guardando = false;
		}
	}

	async function confirmarEliminar() {
		if (guardando || modo.tipo !== 'eliminar') return;

		guardando = true;
		errorModal = '';

		try {
			await usuariosApi.eliminar(modo.usuario.id);
			exito = `Usuario ${modo.usuario.email} eliminado.`;
			cerrar();
			await cargar();
		} catch (e) {
			manejarError(e, 'No se pudo eliminar el usuario.');
		} finally {
			guardando = false;
		}
	}

	onMount(cargar);
</script>

<div class="cabecera">
	<div>
		<p class="tarjeta__nota" style="margin:0">
			Personas con acceso al sistema y el rol con el que entran.
		</p>
	</div>
	<button class="boton" type="button" onclick={abrirCrear}>
		<UserPlus size={16} aria-hidden="true" />
		Nuevo usuario
	</button>
</div>

{#if exito}
	<p class="aviso aviso--ok" role="status">{exito}</p>
{/if}
{#if error}
	<p class="aviso aviso--error" role="alert">{error}</p>
{/if}

{#if cargando}
	<div class="cargando"><LoaderCircle size={20} class="girando" /> Cargando usuarios…</div>
{:else if usuarios.length === 0}
	<p class="vacio">Todavía no hay usuarios registrados.</p>
{:else}
	<div class="tabla-envoltura">
		<table class="tabla">
			<thead>
				<tr>
					<th>Nombre</th>
					<th>Correo</th>
					<th>Rol</th>
					<th>Estado</th>
					<th>Último acceso</th>
					<th><span class="visualmente-oculto">Acciones</span></th>
				</tr>
			</thead>
			<tbody>
				{#each usuarios as u (u.id)}
					<tr>
						<td>
							{u.nombre}
							{#if u.id === sesion.usuario?.id}<span class="tu">(tú)</span>{/if}
						</td>
						<td>{u.email}</td>
						<td><span class="etiqueta {claseRol(u.rol)}">{u.rol_etiqueta}</span></td>
						<td>
							<span class="etiqueta {u.activo ? 'etiqueta--activo' : 'etiqueta--inactivo'}">
								{u.activo ? 'Activo' : 'Inactivo'}
							</span>
						</td>
						<td>{fechaHora(u.ultimo_acceso)}</td>
						<td>
							<div class="acciones">
								<button class="icono" type="button" title="Editar" onclick={() => abrirEditar(u)}>
									<Pencil size={15} aria-hidden="true" />
									<span class="visualmente-oculto">Editar {u.nombre}</span>
								</button>
								<button
									class="icono"
									type="button"
									title="Restablecer contraseña"
									onclick={() => abrirPassword(u)}
								>
									<KeyRound size={15} aria-hidden="true" />
									<span class="visualmente-oculto">Restablecer contraseña de {u.nombre}</span>
								</button>
								<button
									class="icono icono--peligro"
									type="button"
									title="Eliminar"
									disabled={u.id === sesion.usuario?.id}
									onclick={() => (modo = { tipo: 'eliminar', usuario: u })}
								>
									<Trash2 size={15} aria-hidden="true" />
									<span class="visualmente-oculto">Eliminar {u.nombre}</span>
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if roles.length > 0}
	<div class="tarjeta" style="margin-top:1.25rem">
		<h3 class="tarjeta__titulo">Qué puede hacer cada rol</h3>
		<p class="tarjeta__nota">Referencia para asignar el acceso adecuado.</p>
		<div class="rejilla">
			{#each roles as r (r.valor)}
				<div class="rol-caja">
					<span class="etiqueta {claseRol(r.valor)}">{r.etiqueta}</span>
					<p class="rol-desc">{r.descripcion}</p>
				</div>
			{/each}
		</div>
	</div>
{/if}

<svelte:window onkeydown={alPulsar} />

<!-- ── Ventanas modales ── -->
{#if modo.tipo === 'crear' || modo.tipo === 'editar'}
	<div class="modal-fondo" role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-modal">
			<h2 class="modal__titulo" id="titulo-modal">
				{modo.tipo === 'crear' ? 'Nuevo usuario' : `Editar a ${modo.usuario.nombre}`}
			</h2>

			{#if errorModal}<p class="aviso aviso--error" role="alert">{errorModal}</p>{/if}

			<form onsubmit={guardar}>
				<label class="campo">
					<span class="campo__etiqueta">Nombre completo</span>
					<input class="campo__control" bind:value={form.nombre} required disabled={guardando} />
					{#if erroresCampo.nombre}<span class="campo__error">{erroresCampo.nombre}</span>{/if}
				</label>

				<label class="campo">
					<span class="campo__etiqueta">Correo</span>
					<input
						class="campo__control"
						type="email"
						bind:value={form.email}
						required
						disabled={guardando}
					/>
					{#if erroresCampo.email}<span class="campo__error">{erroresCampo.email}</span>{/if}
				</label>

				<label class="campo">
					<span class="campo__etiqueta">Rol</span>
					<select class="campo__control" bind:value={form.rol} disabled={guardando}>
						{#each roles as r (r.valor)}
							<option value={r.valor}>{r.etiqueta}</option>
						{/each}
					</select>
					<span class="ayuda">
						{roles.find((r) => r.valor === form.rol)?.descripcion ?? ''}
					</span>
					{#if erroresCampo.rol}<span class="campo__error">{erroresCampo.rol}</span>{/if}
				</label>

				{#if esInspector}
					<!--
						Los datos del numeral 1 del formato. Guardarlos aquí es lo que
						evita que el profesional los reescriba en cada visita; llegan
						precargados al formulario y allí puede corregirlos.
					-->
					<fieldset class="perfil">
						<legend>Datos del profesional</legend>
						<p class="ayuda">
							Se usan para precargar el numeral 1 del formato de inspección. Puede dejarlos en
							blanco y completarlos después.
						</p>

						<label class="campo">
							<span class="campo__etiqueta">Profesión</span>
							<select class="campo__control" bind:value={form.profesion} disabled={guardando}>
								<option value="">Sin definir</option>
								{#each profesiones as p (p)}
									<option value={p}>{p}</option>
								{/each}
							</select>
							<span class="ayuda">
								Debe ser una profesión con tarjeta profesional que habilite para evaluar daño
								estructural.
							</span>
						</label>

						<label class="campo">
							<span class="campo__etiqueta">Tarjeta profesional</span>
							<input class="campo__control" bind:value={form.tarjeta_profesional} disabled={guardando} />
						</label>

						<label class="campo">
							<span class="campo__etiqueta">Cédula</span>
							<input
								class="campo__control"
								inputmode="numeric"
								bind:value={form.documento}
								disabled={guardando}
							/>
						</label>

						<label class="campo">
							<span class="campo__etiqueta">Expedida en</span>
							<input class="campo__control" bind:value={form.documento_de} disabled={guardando} />
						</label>

						<label class="campo">
							<span class="campo__etiqueta">Teléfono</span>
							<input
								class="campo__control"
								type="tel"
								inputmode="tel"
								bind:value={form.telefono}
								disabled={guardando}
							/>
						</label>

						<label class="campo">
							<span class="campo__etiqueta">Dirección</span>
							<input class="campo__control" bind:value={form.direccion} disabled={guardando} />
						</label>
					</fieldset>
				{/if}

				{#if modo.tipo === 'crear'}
					<label class="campo">
						<span class="campo__etiqueta">Contraseña inicial</span>
						<input
							class="campo__control"
							type="text"
							bind:value={form.password}
							minlength="10"
							required
							disabled={guardando}
						/>
						<span class="ayuda">Mínimo 10 caracteres. Comunícala por un medio seguro.</span>
						{#if erroresCampo.password}<span class="campo__error">{erroresCampo.password}</span>{/if}
					</label>
				{/if}

				<label class="campo campo--fila">
					<input type="checkbox" bind:checked={form.activo} disabled={guardando} />
					<span>Cuenta activa</span>
				</label>

				<div class="modal__acciones">
					<button class="boton boton--suave" type="button" onclick={cerrar} disabled={guardando}>
						Cancelar
					</button>
					<button class="boton" type="submit" disabled={guardando}>
						{#if guardando}<LoaderCircle size={15} class="girando" aria-hidden="true" />{/if}
						Guardar
					</button>
				</div>
			</form>
		</div>
	</div>
{:else if modo.tipo === 'password'}
	<div class="modal-fondo" role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-modal">
			<h2 class="modal__titulo" id="titulo-modal">Restablecer contraseña</h2>
			<p class="tarjeta__nota">
				Se asignará una contraseña nueva a <strong>{modo.usuario.nombre}</strong> y se cerrarán todas
				sus sesiones.
			</p>

			{#if errorModal}<p class="aviso aviso--error" role="alert">{errorModal}</p>{/if}

			<form onsubmit={guardarPassword}>
				<label class="campo">
					<span class="campo__etiqueta">Contraseña nueva</span>
					<input
						class="campo__control"
						type="text"
						bind:value={passwordNueva}
						minlength="10"
						required
						disabled={guardando}
					/>
					{#if erroresCampo.password}<span class="campo__error">{erroresCampo.password}</span>{/if}
				</label>

				<div class="modal__acciones">
					<button class="boton boton--suave" type="button" onclick={cerrar} disabled={guardando}>
						Cancelar
					</button>
					<button class="boton" type="submit" disabled={guardando}>Restablecer</button>
				</div>
			</form>
		</div>
	</div>
{:else if modo.tipo === 'eliminar'}
	<div class="modal-fondo" role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-modal">
			<h2 class="modal__titulo" id="titulo-modal">Eliminar usuario</h2>
			<p>
				¿Seguro que quieres eliminar a <strong>{modo.usuario.nombre}</strong> ({modo.usuario.email})?
				Esta acción no se puede deshacer.
			</p>

			{#if errorModal}<p class="aviso aviso--error" role="alert">{errorModal}</p>{/if}

			<div class="modal__acciones">
				<button class="boton boton--suave" type="button" onclick={cerrar} disabled={guardando}>
					Cancelar
				</button>
				<button class="boton boton--peligro" type="button" onclick={confirmarEliminar} disabled={guardando}>
					{#if guardando}<LoaderCircle size={15} class="girando" aria-hidden="true" />{/if}
					Eliminar
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.perfil {
		margin: 0 0 0.9rem;
		padding: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		background: var(--color-surface-alt);
	}

	.perfil legend {
		padding: 0 0.35rem;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.acciones {
		display: flex;
		gap: 0.3rem;
	}

	.icono {
		background: transparent;
		border: 1px solid var(--color-border-strong);
		border-radius: 7px;
		padding: 0.32rem;
		cursor: pointer;
		color: var(--color-muted);
		display: grid;
		place-items: center;
	}

	.icono:hover:not(:disabled) {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	.icono--peligro:hover:not(:disabled) {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}

	.icono:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tu {
		font-size: 0.72rem;
		color: var(--color-muted);
		margin-left: 0.2rem;
	}

	.ayuda {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.76rem;
		color: var(--color-muted);
	}

	.campo--fila {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.88rem;
	}

	.rol-caja {
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 0.8rem;
		background: var(--color-surface-alt);
	}

	.rol-desc {
		margin: 0.45rem 0 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.visualmente-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
