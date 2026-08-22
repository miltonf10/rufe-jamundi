# Sistema de Gestión del Riesgo — Jamundí

Plataforma de gestión del riesgo de desastres de la Alcaldía Municipal de
Jamundí. Integra el tablero en vivo del RUFE (Registro Único de Familias
Evacuadas) con la administración de usuarios y la trazabilidad de las
actualizaciones del sistema.

| | |
|---|---|
| Aplicación | <https://grj.oticjamundi.com> |
| API | <https://grj.oticjamundi.com/api> |

**Ninguna pantalla es pública.** Sin sesión, cualquier ruta redirige al login y
el contenido protegido no se renderiza en ningún momento — ni siquiera durante
la redirección.

Todo el sistema vive en **una sola carpeta del hosting**
(`/home1/gilibert/grj.oticjamundi.com`) y bajo **un solo subdominio**. La API se
sirve como subcarpeta `/api` del mismo dominio, no en un subdominio aparte: así
no hay peticiones entre orígenes distintos y el CORS deja de existir como
problema.

Desde el 15 de agosto de 2026 el sistema **reemplaza** al tablero RUFE que se
publicaba abierto: ahora todo, incluido el tablero, exige iniciar sesión. El
sitio anterior quedó respaldado íntegro en
`/home1/gilibert/_respaldo_tablero_rufe_20260815`; restaurarlo es copiar esa
carpeta de vuelta al document root.



---

## Arquitectura

El sistema está separado en dos piezas que se despliegan y evolucionan por
separado:

```
Gestion_riesgo/
├── backend/     API REST en PHP 8 + MySQL    → se despliega en /api
└── frontend/    SvelteKit 2 (build estático) → se despliega en la raíz
```

En el servidor ambos conviven en la misma carpeta:

```
grj.oticjamundi.com/
├── .htaccess          SPA + excluye /api del reenvío a index.html
├── index.html  200.html  robots.txt  _app/
└── api/
    ├── .htaccess      front controller; niega config.php y archivos de datos
    ├── index.php  config.php
    ├── src/       + .htaccess  (Require all denied)
    └── database/  + .htaccess  (Require all denied)

sgr_almacen/           evidencias del RUFE — hermana del sitio, nunca dentro
└── rufe/AAAA/MM/<id>/
```

El hosting solo ofrece una carpeta por sitio, así que el código PHP no puede
colocarse por encima del document root como sería deseable. Se compensa
negando el acceso web a `src/`, `database/` y `config.php` desde `.htaccess`;
está verificado que los tres responden 403.

Las evidencias del RUFE sí quedan fuera del docroot, y esa es la diferencia que
importa: si Apache no puede alcanzarlas, da igual que alguien lograra subir un
archivo ejecutable, porque no existe URL que lo dispare. Un `.htaccess` protege
mientras nadie cambie la configuración del servidor; estar fuera del árbol web
protege siempre.

El navegador es el único que habla con las dos: descarga la aplicación del
frontend y esta consume la API por HTTPS con un token de sesión.

### Por qué este stack

**El backend no usa Composer ni un framework.** El hosting es cPanel compartido
sin acceso por consola, así que `composer install` no se puede ejecutar en el
servidor y subir el `vendor/` de un framework serían decenas de megabytes por la
API de cPanel en cada despliegue. Un autoloader PSR-4 de diez líneas cubre la
misma necesidad: el despliegue completo pesa 28 KB y arranca sin cargar nada más.

**La autenticación usa un token opaco, no JWT.** Un JWT no se puede revocar sin
mantener igualmente una lista en base de datos. Aquí el token es un valor
aleatorio de 256 bits cuyo SHA-256 se guarda en `sesiones`: desactivar a una
persona o cambiarle el rol cierra sus sesiones en el acto, que es lo que exige un
sistema con datos de familias damnificadas.

**El frontend es una SPA sin pre-renderizado.** Lo que ve cada persona depende de
su sesión, que solo existe en el navegador; generar HTML en el build produciría
la pantalla de un usuario que no existe.

---

## Módulos

| Módulo | Ruta | Quién entra |
|---|---|---|
| Dashboard — tablero RUFE en vivo | `/dashboard` | Todos los roles |
| **Registrar RUFE** (captura en campo) | `/riesgo/reportar` | Administrador y Gestor |
| **Bandeja de reportes RUFE** | `/riesgo/reportes` | Todos los roles |
| Acerca de — sistema y actualizaciones | `/acerca` | Todos los roles |
| Administración → Usuarios del sistema | `/admin/usuarios` | Solo Administrador |

### Dashboard

Es el tablero del RUFE reutilizado tal cual, con su identidad visual intacta.
Lee los datos en vivo del CSV público de la hoja de cálculo del censo
(`src/lib/rufe/source.ts`) directamente desde el navegador, con un respaldo
estático en `src/lib/data/rufe-fallback.json` por si la hoja deja de estar
compartida.

### Acerca de

Dos pestañas:

- **Sistema actual** — descripción, módulos, roles y sus permisos, tecnología de
  cada capa y estado real del servicio (conexión a la base, versión de PHP,
  usuarios activos, sesiones abiertas).
- **Actualizaciones del sistema** — historial de commits del repositorio en
  GitHub, atribuido a cada persona del equipo. Cada commit se asigna por el
  usuario de GitHub cuando viene (lo asigna GitHub, es fiable) y si no por el
  nombre del autor de git. Se puede filtrar la línea de tiempo por autor.

  La consulta a GitHub se cachea 5 minutos en la tabla `ajustes`; si GitHub falla,
  se sirve la caché vencida antes que dejar la pantalla vacía. El token de GitHub
  se usa solo desde el servidor y nunca viaja al navegador.

### Registrar RUFE

Digitaliza el **Registro Unifamiliar de Emergencias** (formato UNGRD
`FR-1703-SMD-69`, versión 01). Lo diligencia un funcionario —Administrador o
Gestor— durante la visita al hogar afectado, con la información que le da el jefe
de hogar. **No es una pantalla pública:** exige sesión, y la API lo exige otra vez
por su lado, que es la capa que de verdad cuenta.

Está pensado para trabajo de campo con un teléfono de gama baja:

- **Ocho pasos cortos** en vez de un formulario largo. Cada uno cabe en una o dos
  pantallas y se valida por separado.
- **Autoguardado local**: `localStorage` con un retardo de 800 ms para el
  formulario, IndexedDB para las fotos (un `Blob` no cabe en `localStorage`, cuya
  cuota ronda los 5 MB). La ficha a medias vive 7 días en el dispositivo.
- **Tolerante a quedarse sin señal.** Las fotos que fallan vuelven a la cola y se
  suben solas al recuperar cobertura. Si se pulsa Enviar sin red, la ficha queda
  encolada y sale automáticamente después; se puede cerrar la aplicación y al
  volver se retoma. Lo que hace seguro reintentar es un `envio_id` que genera el
  navegador: si la ficha ya entró pero la respuesta se perdió, el servidor
  devuelve el radicado original en vez de registrar dos veces el mismo hogar.
- **Campos condicionales** escritos una sola vez en `frontend/src/lib/rufe/esquema.ts`
  y espejados en `backend/src/Rufe/Validador.php`. Un campo oculto se limpia y no
  se envía; si llegara igual, el servidor lo rechaza en vez de ignorarlo.
- **Dos clases de foto**, con cupo propio: el documento de identidad del jefe de
  hogar (una) y el daño (hasta cuatro). Cada una con botón de cámara y de galería.
- **Ubicación GPS opcional**, tomada frente al inmueble.
- **Encadenado de fichas**: al terminar, un botón deja el formulario listo para la
  siguiente casa conservando el evento y su fecha.

El formulario abre precargado con el evento y la fecha de la emergencia en curso
(`EVENTO_PREDETERMINADO` y `FECHA_EVENTO_PREDETERMINADA` en `Catalogos.php`).
Ambos son editables y ese es el único sitio donde cambiarlos.

Cada ficha queda firmada: `origen = INTERNO`, `creado_por_usuario_id` con el
funcionario, y una entrada en el historial y en la auditoría con su correo.

### Bandeja de reportes RUFE

Donde el «Vo.Bo. CMGRD/CDGRD» del formato de papel se vuelve un acto trazable.
Los reportes entran en estado `RECIBIDO` y **no son oficiales** hasta que un
gestor los valida; el historial guarda cada cambio con su autor y su nota.

El listado no trae nombres ni documentos —para decidir qué revisar bastan el
evento, el lugar y la fecha—, así que los datos identificatorios solo salen de la
base al abrir un reporte, que es lo que queda registrado en auditoría.

El Administrador puede **anonimizar** un reporte: borra nombres, documentos,
teléfonos, dirección, coordenadas y evidencias, y conserva lo estadístico
(género, etnia, zona, tipo y estado del bien, agropecuario) para que el reporte
siga contando en los indicadores del municipio.

### Gestión de usuarios

Alta, edición, activación, restablecimiento de contraseña y eliminación. Las
salvaguardas que el rol por sí solo no cubre están en el controlador: un
administrador no puede cambiar su propio rol, desactivarse ni eliminarse, y el
sistema nunca se queda sin al menos un administrador activo.

---

## Roles

| Rol | Alcance |
|---|---|
| **Administrador** | Control total: lectura, escritura y gestión de usuarios. |
| **Gestor** | Carga de datos: lectura y escritura, sin acceso a usuarios. |
| **Visualización** | Solo visualizar los indicadores (KPI) y tableros (BI). |

El control de acceso se aplica en tres capas, y las tres derivan del mismo
registro para que no se desincronicen:

1. **Menú** — `frontend/src/lib/navigation.ts` filtra por rol lo que se dibuja.
2. **Rutas del navegador** — el mismo archivo alimenta la guardia del layout.
3. **API** — `backend/src/Core/Router.php` exige el rol en cada ruta. Esta es la
   única capa que cuenta como seguridad: ocultar un botón no protege nada.

---

## API

Base: `https://grj.oticjamundi.com/api`. Autenticación con
`Authorization: Bearer <token>`.

| Método | Ruta | Rol |
|---|---|---|
| `GET` | `/health` | pública |
| `POST` | `/auth/login` | pública |
| `GET` | `/auth/me` | autenticado |
| `POST` | `/auth/logout` | autenticado |
| `POST` | `/auth/password` | autenticado |
| `GET` | `/acerca/sistema` | autenticado |
| `GET` | `/acerca/actualizaciones` | autenticado |
| `GET` | `/usuarios` | Administrador |
| `POST` | `/usuarios` | Administrador |
| `GET` | `/usuarios/{id}` | Administrador |
| `PUT` | `/usuarios/{id}` | Administrador |
| `DELETE` | `/usuarios/{id}` | Administrador |
| `POST` | `/usuarios/{id}/password` | Administrador |

### RUFE — captura en campo (Administrador y Gestor)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/rufe/catalogos` | Catálogos del formato y valores precargados. |
| `POST` | `/rufe/cargas` | Abre una carga de evidencias y devuelve su token opaco. |
| `GET` | `/rufe/cargas/{token}/archivos` | Lista los archivos de esa carga. |
| `POST` | `/rufe/cargas/{token}/archivos` | Sube un archivo (multipart, uno por petición, con `tipo`). |
| `DELETE` | `/rufe/cargas/{token}/archivos/{id}` | Quita un archivo de la carga. |
| `POST` | `/rufe/reportes` | Registra la ficha. Devuelve solo `{ radicado, recibido_en }`. |

Controles del registro: tope por **funcionario** (no por IP) de 40 fichas/hora y
250/día; reintento idempotente por `envio_id`; detección de duplicados en 24 h
(`409`, indicando el radicado que ya existe); corte del cuerpo por encima de
256 KB (`413`) y validación completa en PHP.

El tope se cuenta por usuario y no por IP a propósito: una brigada entera puede
salir a campo compartiendo la conexión del municipio, y contar por IP dejaría
fuera a todos menos al primero que reporte.

### RUFE — bandeja interna

| Método | Ruta | Rol |
|---|---|---|
| `GET` | `/rufe/reportes` | autenticado |
| `GET` | `/rufe/reportes/{id}` | autenticado |
| `GET` | `/rufe/reportes/{id}/evidencias/{ev}` | autenticado |
| `PUT` | `/rufe/reportes/{id}` | Administrador y Gestor |
| `PUT` | `/rufe/reportes/{id}/estado` | Administrador y Gestor |
| `GET` `POST` | `/rufe/borradores` | Administrador y Gestor |
| `GET` `DELETE` | `/rufe/borradores/{clave}` | Administrador y Gestor |
| `POST` | `/rufe/reportes/{id}/anonimizar` | Administrador |

Respuestas: `{ "ok": true, "data": … }` o
`{ "ok": false, "message": "…", "errors": { "campo": "…" } }`. Los errores de
validación del RUFE usan rutas con puntos (`personas.2.numero_documento`) para
que el formulario lleve al ciudadano al control exacto.

---

## Base de datos

Once tablas. Las cuatro originales en `backend/database/schema.sql`:

- `usuarios` — con el rol como ENUM; son tres roles fijos, no un catálogo que se
  administre, así que una tabla aparte solo añadiría un JOIN por petición.
- `sesiones` — token hasheado, expiración, IP y agente.
- `auditoria` — quién hizo qué y sobre qué registro.
- `ajustes` — clave/valor; hoy guarda la caché de GitHub.

Las siete del RUFE en `backend/database/rufe.sql`:

- `rufe_reportes` — cabecera; un registro por unidad familiar afectada.
- `rufe_personas` — de 1 a 10 personas, con el `orden` del renglón del formato.
- `rufe_agropecuario` — de 0 a 4 renglones.
- `rufe_evidencias` — nace con `reporte_id` nulo (carga temporal) y se adopta al
  enviar el reporte.
- `rufe_historial` — cada cambio de estado, con el correo del funcionario
  desnormalizado para que sobreviva a su borrado.
- `rufe_borradores` — solo de funcionarios autenticados. El ciudadano anónimo no
  usa esta tabla: guardar nombres, documentos y etnia de terceros antes de que
  exista la autorización de tratamiento sería recolectar datos sensibles sin base
  legal.
- `rufe_limite` — contadores del control de tasa, con la IP derivada a SHA-256.

Los códigos de documento, parentesco, género y etnia **no** son tablas de
catálogo: son números impresos en un formato con versión controlada por la UNGRD,
no una lista que la Alcaldía administre. Viven en `backend/src/Rufe/Catalogos.php`,
que es su fuente única —el frontend los pide por `GET /rufe/catalogos` en vez de
duplicarlos en TypeScript— y se guarda el código, no la etiqueta, para que un
cambio de redacción de la UNGRD no invalide los registros históricos.

### Migración

No hay herramienta de migraciones: todo el SQL es idempotente
(`CREATE TABLE IF NOT EXISTS`) y `backend/src/Core/Migrador.php` lo aplica en
orden. Sobre una instalación en uso:

```
POST /api/migrar.php?clave=LA_INSTALL_KEY
```

Devuelve qué tablas creó y si el almacén de evidencias quedó escribible. Después:
vacíe `install_key` en `config.php` y borre `migrar.php` del servidor.

**Reversión:** `backend/database/rufe_revertir.sql` borra las siete tablas del
RUFE en orden inverso y no toca ninguna previa. Elimina todos los reportes
ciudadanos: exporte antes. Los archivos en disco no los borra ese script.

---

## Desarrollo local

```bash
# Backend
cd backend
cp config.example.php config.php     # completar credenciales de MySQL
php -S localhost:8000 -t public

# Frontend
cd frontend
npm install
npm run dev                          # http://localhost:5173
```

El cliente de la API resuelve la URL base por dominio
(`frontend/src/lib/api/client.ts`): en `localhost` apunta a `localhost:8000` y en
cualquier otro sitio a producción. Así el mismo build sirve en los dos lados sin
recompilar.

Comprobaciones:

```bash
cd frontend && npm run check && npm test    # 0 errores de tipos, 138 pruebas
find backend -name '*.php' -exec php -l {} \;
php backend/tests/run.php                   # 98 pruebas, sin base de datos
```

`backend/tests/run.php` es un arnés de pruebas en PHP plano: no hay Composer en
el hosting ni forma de instalarlo, así que tampoco hay PHPUnit. Cubre solo código
puro (validación, catálogos, radicado, troceo del SQL) y por eso corre en
cualquier máquina sin montar nada.

Lo que solo se ve con una base delante —transacciones, control de tasa,
duplicados, subida de archivos y permisos por rol— va en un guion aparte:

```bash
mysql -u root -e "CREATE DATABASE sgr_prueba CHARACTER SET utf8mb4"
mysql -u root sgr_prueba < backend/database/schema.sql
mysql -u root sgr_prueba < backend/database/rufe.sql
php -S 127.0.0.1:8099 -t backend/public &

SGR_RESET_LIMITE='mysql -u root sgr_prueba -e "TRUNCATE rufe_limite"' \
  bash backend/tests/http.sh                # 47 comprobaciones
```

El guion inicia sesión con los tres roles y comprueba que cada uno llega hasta
donde debe: que **ninguna** ruta del RUFE responde sin token, que el rol de solo
visualización recibe 403 al intentar capturar, y que el gestor sí puede. Los
correos y la contraseña se ajustan con `SGR_ADMIN`, `SGR_GESTOR`, `SGR_VISOR` y
`SGR_PASS`.

Es repetible sobre la misma base: cada corrida marca sus fichas con un
identificador propio para no chocar con la detección de duplicados de la corrida
anterior. **No lo ejecute contra producción**: crea reportes de verdad.

---

## Despliegue

No hay SSH en el hosting. Todo se hace por la API de cPanel sobre HTTPS con el
header `Authorization: cpanel <usuario>:<token>`.

```bash
cd frontend && npm run build          # genera build/ con index.html y .htaccess
```

Luego, por cada destino:

1. Empaquetar en ZIP el contenido a subir.
2. `POST /execute/Fileman/upload_files` con `dir`, **`overwrite=1`** y el archivo.
   Sin `overwrite=1` cPanel rechaza en silencio los archivos que ya existen.
3. Extraer: `/json-api/cpanel?cpanel_jsonapi_module=Fileman&cpanel_jsonapi_func=fileop&op=extract`
   (la UAPI no expone extracción).
4. Borrar el ZIP con el mismo `fileop` pero `op=unlink`.

El paquete de la API va **aplanado**: `public/index.php` y `public/.htaccess`
suben a la raíz de `api/`, junto a `src/`, `database/` y `config.php`. El
front controller detecta esa disposición y resuelve su raíz en consecuencia.

Varias funciones de subdominio solo existen en la API2, no en la UAPI:
`SubDomain::addsubdomain` está en ambas, pero `delsubdomain` y
`list_subdomains` solo responden por `/json-api/cpanel` con
`cpanel_jsonapi_apiversion=2`.

Rutas en el servidor:

| Qué | Dónde |
|---|---|
| Frontend | `/home1/gilibert/grj.oticjamundi.com` |
| API | `/home1/gilibert/grj.oticjamundi.com/api` |
| Backend | `/home1/gilibert/sgr_backend` (docroot: `public/`) |
| Configuración | `/home1/gilibert/sgr_backend/config.php` — **fuera** del docroot |
| Evidencias RUFE | `/home1/gilibert/sgr_almacen` — **fuera** del docroot |

El código PHP y `config.php` viven un nivel por encima del directorio público, así
que no son descargables ni aunque Apache dejara de interpretar PHP.

### Puesta en marcha del RUFE

Además de subir el código, hay que hacer tres cosas una sola vez:

1. **Crear el almacén de evidencias.** Desde el Administrador de archivos de
   cPanel, una carpeta hermana del sitio (nunca dentro): `/home1/gilibert/sgr_almacen`.
   Si el hosting no permitiera una carpeta fuera del docroot, el respaldo es una
   dentro protegida por `.htaccess` con `Require all denied` y `php_flag engine off`
   — es más débil, porque bastaría un cambio de configuración de Apache para
   dejarla al descubierto, y debe quedar anotado como riesgo asumido.

2. **Añadir las claves nuevas a `config.php`** (ver `config.example.php`):

   ```php
   'almacenamiento' => ['ruta' => '/home1/gilibert/sgr_almacen'],
   'rufe' => ['sal' => '…'],   // php -r "echo bin2hex(random_bytes(32));"
   ```

   La sal deriva el hash de la IP del ciudadano y las claves del control de tasa.
   **No debe cambiar después**: si cambia, los contadores en curso se reinician y
   los reportes anteriores dejan de poder correlacionarse por origen.

3. **Ejecutar la migración** (`POST /api/migrar.php?clave=…`) y luego vaciar
   `install_key` y borrar `migrar.php` del servidor.

Antes de dar por buena la instalación: `GET /api/rufe/catalogos` **sin token**
debe responder `401`, y con la sesión de un gestor debe responder `ok: true`.
`/riesgo/reportar` debe redirigir al login cuando no hay sesión.

### Reversión del despliegue

Para desactivar el módulo sin tocar el resto del sistema, en este orden:

1. Quitar la entrada `captura-rufe` de `NAV_ITEMS` (`frontend/src/lib/navigation.ts`)
   y volver a compilar. El enlace desaparece y la ruta deja de estar autorizada.
2. Si además hay que retirar la API: comentar el bloque de rutas `/rufe/*` en
   `backend/public/index.php`. Ninguna otra ruta depende de ellas.
3. Solo si hay que borrar los datos: exportar y aplicar `rufe_revertir.sql`.

Los pasos 1 y 2 son reversibles y no pierden nada. El 3 no.

### Instalación inicial

`backend/public/instalar.php` crea las tablas y el primer administrador. Se
protege con `install_key` de `config.php`, se niega a actuar si esa clave está
vacía y solo crea un administrador si todavía no existe ninguno. **Tras instalar
se borra del servidor** — no forma parte del despliegue normal.

---

## Notas de seguridad

- Contraseñas con `password_hash`/bcrypt; mínimo 10 caracteres.
- El login responde igual ante un correo inexistente y una contraseña incorrecta,
  y hace la verificación contra un hash falso cuando el usuario no existe, para
  que el tiempo de respuesta no delate qué correos están registrados.
- Cambiar la contraseña cierra las demás sesiones de esa persona.
- CORS con lista blanca de orígenes; nunca se refleja un origen arbitrario.
- Los errores 500 no exponen el detalle en producción: se registran en el log.
- La bitácora de auditoría nunca interrumpe la operación que la origina.

### Captura del RUFE

El formulario exige sesión y rol de escritura, pero recibe datos personales de
terceros y archivos, así que se sigue escribiendo con desconfianza:

- **Archivos.** Nada de lo que envía el cliente construye una ruta: el nombre en
  disco se genera con `random_bytes` y la extensión sale de una lista blanca. El
  tipo se determina leyendo el contenido con `finfo`, nunca con el encabezado que
  declara el navegador. Los archivos viven fuera del docroot, así que no existe
  URL que pueda ejecutarlos, y solo salen por un endpoint que exige token y deja
  rastro en auditoría. El hosting compartido no ofrece antivirus: es una
  limitación asumida, mitigada con lista blanca, límites de tamaño y cantidad,
  renombrado y almacenamiento inalcanzable por web.
- **Datos personales.** La ficha guarda la IP derivada a SHA-256 con sal, no en
  claro: sirve para investigar un uso indebido, pero no hace falta para atender la
  emergencia. (La bitácora general de auditoría sí registra la IP, como en todas
  las acciones del sistema; son dos registros con finalidad y retención distintas.)
- **Autoría.** Cada ficha queda atada al funcionario que la levantó
  (`creado_por_usuario_id`, historial y auditoría). No hay captura anónima.
- **Datos sensibles.** Identidad de género y pertenencia étnica son categorías
  especiales bajo el art. 5 de la Ley 1581 de 2012. Se piden con una autorización
  **separada** de la general y se guarda con cada reporte la versión del aviso
  aceptado y el instante en que se aceptó, que es la prueba exigible.
- **Datos de terceros.** El funcionario registra datos que no son suyos. Las
  casillas del último paso declaran lo que el ciudadano manifestó de viva voz —no
  lo que opina quien está en la pantalla— y quedan guardadas junto con la versión
  del aviso y el instante en que se marcaron. El estado inicial `RECIBIDO` no es
  oficial: hace falta el Vo.Bo. de un gestor.
- **Sin enumeración.** El radicado son 8 caracteres aleatorios en Crockford
  Base32 (sin I, L, O ni U, para poder dictarlo), no el `id`. La respuesta del
  envío no devuelve identificadores internos ni repite los datos recibidos.
- **El borrador nunca sale del dispositivo** mientras la ficha no se envíe, y las
  casillas de autorización no se guardan en él: el consentimiento se registra en la
  sesión del envío, no se hereda de una ficha a medias de hace tres días.

### Retención

- Reportes: 5 años desde `VALIDADO`; luego, anonimización.
- Evidencias: 2 años desde `VALIDADO`.
- Cargas de evidencias sin adoptar: 2 horas.
- Borradores de funcionario: 30 días.

No hay cron en el hosting, así que la limpieza de lo efímero (cargas caducadas,
borradores vencidos, ventanas del control de tasa) viaja montada en el propio
tráfico. La retención a años es una tarea manual: no está automatizada.
