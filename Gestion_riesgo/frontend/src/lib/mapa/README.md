# Sección Mapas

Dónde se concentra la afectación del sismo, sobre Leaflet + OpenStreetMap.

## Cómo está repartido

| Archivo | Qué hace |
|---|---|
| `src/routes/riesgo/mapas/+page.svelte` | La pantalla. **Único** archivo que toca Leaflet. |
| `src/lib/mapa/datos.ts` | Qué se pinta y qué no. Lógica pura, comprobable sin navegador. |
| `src/lib/mapa/datos.spec.ts` | Sus pruebas. |
| `backend/src/Rufe/Geocodificador.php` | Direcciones → coordenadas. **En el servidor.** |
| `backend/src/Controllers/MapaController.php` | `/mapa/fichas`, `/mapa/ubicaciones`, `/mapa/geocodificar`. |
| `src/routes/admin/mapas/+page.svelte` | Lanzar la geocodificación por lotes. |

**No hay componente de mapa reutilizable ni selector de punto arrastrable.** El
mapa es de solo lectura: muestra la afectación, no sirve para elegir un sitio. La
ubicación de una ficha se captura en el formulario con el GPS del teléfono
(`usarMiUbicacion()` en `routes/riesgo/reportar/+page.svelte`), no señalando en un
mapa.

## Por qué el geocodificador vive en PHP y no en el navegador

Tres razones, y ninguna es de gusto:

1. **Cupo.** Nominatim admite una consulta por segundo. Desde el navegador, cada
   persona que abriera el mapa dispararía cientos de consultas y nos bloquearían.
2. **Se resuelve una vez.** El resultado de una dirección es el mismo para todos.
   Se guarda en `rufe_geocodificacion` y no se vuelve a pedir nunca.
3. **La clave de Google.** Es el respaldo cuando OpenStreetMap falla, y una clave
   no puede viajar al navegador.

Por eso el navegador nunca llama a un geocodificador: le pide al servidor las
direcciones que ya están resueltas (`POST /mapa/ubicaciones`).

## Los tres intentos para ubicar algo

En `datos.ts#ubicarEnCascada`, en orden de calidad:

1. **Coordenadas del censador.** El GPS que capturó delante de la casa. El mejor
   dato que existe, y no gasta cupo.
2. **La dirección escrita**, geocodificada contra el municipio.
3. **El sector** —corregimiento o vereda— cuando la dirección no se puede
   resolver. «Caseta comunal 200 metros» no la ubica nadie; «La Liberia, Jamundí»
   sí.

Lo ubicado por sector **se rebaja a aproximado** aunque el servicio afine más: se
ubicó la vereda, no el predio. Sobre un mapa que se usa para repartir ayuda, dejar
creer que el punto está sobre la casa sería peor que no pintarlo.

## Lo que nunca se pinta

Una dirección que solo se resuelve hasta el municipio devuelve coordenadas
válidas y del todo inútiles: las del parque principal. Pintarlas amontonaría
cientos de hogares en el centro e inventaría una zona de calor donde no la hay.
Se clasifican como `MUNICIPIO` y se descartan, y el número de hogares sin ubicar
está siempre a la vista.

## Trampas de Leaflet que ya están resueltas

Si toca esta pantalla, no deshaga esto:

- **Importación dinámica.** `await import('leaflet')` dentro de `dibujar()`, no
  arriba del archivo: así Leaflet no entra en el paquete de las demás pantallas
  (son 145 KB) y no se ejecuta fuera del navegador.
- **`invalidateSize()`.** Leaflet calcula la posición de tejas y marcadores según
  el tamaño que tenía el contenedor al crearse. Si cambia después —tipografía que
  carga, aviso que aparece, teléfono que gira— **todo queda desplazado**. Se llama
  tras el primer fotograma y en cada cambio de tamaño, con un `ResizeObserver`.
- **Guarda de doble inicialización.** Leaflet lanza «Map container is already
  initialized» y deja el contenedor inservible.
- **Limpieza en `onDestroy`.** Sin `mapa.remove()` y `observador.disconnect()`,
  cada visita deja un mapa vivo escuchando eventos.
- **Altura explícita** en `.lienzo`. Un contenedor sin alto no dibuja nada.
- **`isolation: isolate`.** Leaflet numera sus capas de 400 a 800 dando por hecho
  que es lo único de la página; sin aislarlo se dibujaba encima del menú lateral.
- **`[lat, lon]`**, nunca al revés.
- **`preferCanvas: true`.** Cientos de marcadores en un teléfono modesto.

## Poner el mapa en marcha

El mapa sale vacío hasta que las direcciones estén geocodificadas:

1. Entrar como administrador a **Administración → Ubicaciones del mapa**.
2. Pulsar **Ubicar las pendientes** y dejar la pestaña abierta.
3. Va a una consulta por segundo —es lo que permite Nominatim—, así que ~1.300
   direcciones tardan cerca de veinte minutos. Lo procesado queda guardado aunque
   se cierre antes.

Las fichas con GPS aparecen sin necesidad de esto.

**Google es opcional.** Con `geocodificacion.google_key` vacía en `config.php`
—como viene— solo se usa OpenStreetMap. Poner la clave hace que lo que
OpenStreetMap no ubique se reintente con Google, que acierta más con direcciones
desordenadas pero cobra por consulta.

## Comprobar

```bash
cd frontend && npm run check && npm test          # 298 pruebas
cd backend  && php tests/run.php                  # 143 pruebas
```

A mano, sobre el mapa: que las tejas carguen, que los puntos caigan sobre las
calles correctas —no corridos—, que el globo diga cómo se ubicó cada uno, que el
menú lateral tape el mapa y no al revés, y que al entrar y salir varias veces de
la sección no se degrade el rendimiento.
