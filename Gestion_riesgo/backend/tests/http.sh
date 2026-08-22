#!/usr/bin/env bash
#
# Pruebas de humo del formulario RUFE contra una API viva.
#
# run.php cubre el código puro; esto cubre lo que solo se ve con una base de
# datos delante: transacciones, control de tasa, duplicados, subida de archivos
# y permisos por rol.
#
# Uso:
#   1. Cree una base vacía y aplique los .sql de backend/database
#   2. Copie config.example.php a config.php y apúntelo a esa base
#   3. Cree los tres usuarios de prueba (ver SGR_PASS abajo)
#   4. php -S 127.0.0.1:8099 -t backend/public
#   5. bash backend/tests/http.sh
#
# Todo el formulario RUFE exige sesión, así que el guion inicia la suya con los
# tres roles y comprueba que cada uno llega hasta donde debe y no más.
#
# Variables:
#   SGR_ADMIN / SGR_GESTOR / SGR_VISOR  correos de prueba
#   SGR_PASS                            contraseña común
#   SGR_RESET_LIMITE                    orden SQL para vaciar rufe_limite
#
# ATENCIÓN: crea reportes de verdad. No lo ejecute contra producción.

set -uo pipefail

API="${1:-http://127.0.0.1:8099}"
RESET="${SGR_RESET_LIMITE:-}"
PASS="${SGR_PASS:-contrasena-larga-1}"
CORREO_ADMIN="${SGR_ADMIN:-admin@prueba.co}"
CORREO_GESTOR="${SGR_GESTOR:-gestor@prueba.co}"
CORREO_VISOR="${SGR_VISOR:-visor@prueba.co}"
OK=0
FALLOS=0
OMITIDAS=0

verde()   { printf '\033[32m✓\033[0m %s\n' "$1"; OK=$((OK + 1)); }
rojo()    { printf '\033[31m✗\033[0m %s\n' "$1"; printf '      %s\n' "${2:-}"; FALLOS=$((FALLOS + 1)); }
omitida() { printf '\033[33m•\033[0m %s (omitida: sin SGR_RESET_LIMITE)\n' "$1"; OMITIDAS=$((OMITIDAS + 1)); }
titulo()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Devuelve la cuota de envíos. Sin ella, cada tres peticiones el resto sería 429
# y las comprobaciones dejarían de significar nada.
reset_limite() {
	[ -n "$RESET" ] && eval "$RESET" > /dev/null 2>&1
	return 0
}

hay_cuota() { [ -n "$RESET" ]; }

FECHA_OK=$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d '3 days ago' +%Y-%m-%d)

# Identificador de esta ejecución. Va dentro de la dirección y del documento de
# cada ficha de prueba para que dos corridas seguidas no choquen entre sí: la API
# considera duplicado, durante 24 horas, todo reporte con la misma fecha,
# dirección y documento del jefe de hogar. Sin esto, la segunda corrida sobre la
# misma base fallaría entera con 409 y parecería un fallo del código.
EJECUCION="$(date +%s)"

entrar() {
	curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
		-d "{\"email\":\"$1\",\"password\":\"$PASS\"}" |
		sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

TOKEN_ADMIN=$(entrar "$CORREO_ADMIN")
TOKEN_GESTOR=$(entrar "$CORREO_GESTOR")
TOKEN_VISOR=$(entrar "$CORREO_VISOR")

if [ -z "$TOKEN_GESTOR" ]; then
	printf '\033[31mNo se pudo iniciar sesión como %s.\033[0m\n' "$CORREO_GESTOR"
	printf 'Cree los usuarios de prueba o ajuste SGR_GESTOR y SGR_PASS.\n'
	exit 1
fi

# Cabecera del funcionario que captura. Todo el formulario va firmado por él.
AUTH="Authorization: Bearer $TOKEN_GESTOR"

# Cuerpo del reporte, con cada campo que alguna prueba necesita variar expuesto
# como parámetro. Se arma así, y no recortando un JSON con sed, porque sed
# trabaja línea a línea y sobre un JSON con saltos falla en silencio: la petición
# sale válida y la prueba pasa sin haber probado nada.
#
#   reporte <sufijo> [zona] [personas] [autoriza_datos] [extra] [fecha] [direccion]
#
# El sufijo entra en la dirección y en el número de documento, y sirve para que
# dos llamadas no choquen con la detección de duplicados. Por eso la dirección
# tiene además su propio parámetro: las pruebas de inyección necesitan meter
# caracteres raros ahí sin invalidar de paso la cédula.
reporte() {
	local sufijo="${1:-$RANDOM}"
	local zona="${2:-URBANO}"
	local personas="${3:-}"
	local autoriza="${4:-true}"
	local extra="${5:-}"
	local fecha="${6:-$FECHA_OK}"
	# El sufijo se ancla a la ejecución para que el guion sea repetible.
	sufijo="${EJECUCION}${sufijo}"
	local direccion="${7:-Calle 10 # 5-$sufijo}"

	if [ -z "$personas" ]; then
		personas="[{\"nombres\":\"María José\",\"apellidos\":\"Riascos Mina\",\"tipo_documento\":3,\"numero_documento\":\"3$sufijo\",\"parentesco\":1,\"genero\":2,\"fecha_nacimiento\":\"1985-04-11\",\"pertenencia_etnica\":5,\"telefono\":\"3105551234\"}]"
	fi

	printf '{"evento":"Terremoto","fecha_evento":"%s","zona":"%s","vereda_sector_barrio":"Barrio Belalcázar","direccion":"%s","tipo_bien":"VIVIENDA","forma_tenencia":"PROPIETARIO","estado_bien":"AVERIADO","alojamiento":"LUGAR_HABITUAL","tiene_afectacion_agro":false,"contacto_telefono":"3105551234","autoriza_tratamiento":%s,"sitio_web":"","personas":%s%s}' \
		"$fecha" "$zona" "$direccion" "$autoriza" "$personas" "$extra"
}

# espera <descripción> <código esperado> <método> <ruta> [cuerpo json]
espera() {
	local desc="$1" esperado="$2" metodo="$3" ruta="$4" cuerpo="${5:-}" codigo

	if [ -n "$cuerpo" ]; then
		codigo=$(curl -s -o /tmp/sgr-resp.json -w '%{http_code}' \
			-X "$metodo" "$API$ruta" -H "$AUTH" -H 'Content-Type: application/json' -d "$cuerpo")
	else
		codigo=$(curl -s -o /tmp/sgr-resp.json -w '%{http_code}' -X "$metodo" "$API$ruta" -H "$AUTH")
	fi

	if [ "$codigo" = "$esperado" ]; then
		verde "$desc"
	else
		rojo "$desc" "esperaba $esperado, recibió $codigo — $(head -c 220 /tmp/sgr-resp.json)"
	fi
}

titulo "Disponibilidad"
espera "GET /health responde" 200 GET /health

titulo "Ninguna ruta del RUFE responde sin sesión"
# Comprobación central del control de acceso: /health y /auth/login son lo único
# que el sistema atiende sin token.
sin_sesion() {
	local desc="$1" metodo="$2" ruta="$3" cuerpo="${4:-}" codigo
	if [ -n "$cuerpo" ]; then
		codigo=$(curl -s -o /dev/null -w '%{http_code}' -X "$metodo" "$API$ruta" \
			-H 'Content-Type: application/json' -d "$cuerpo")
	else
		codigo=$(curl -s -o /dev/null -w '%{http_code}' -X "$metodo" "$API$ruta")
	fi
	[ "$codigo" = "401" ] && verde "$desc" || rojo "$desc" "esperaba 401, recibió $codigo"
}

sin_sesion "GET /rufe/catalogos"        GET  /rufe/catalogos
sin_sesion "POST /rufe/cargas"          POST /rufe/cargas '{}'
sin_sesion "POST /rufe/reportes"        POST /rufe/reportes '{}'
sin_sesion "GET /rufe/reportes"         GET  /rufe/reportes
sin_sesion "GET /rufe/reportes/1"       GET  /rufe/reportes/1
sin_sesion "PUT estado"                 PUT  /rufe/reportes/1/estado '{"estado":"VALIDADO"}'
sin_sesion "POST anonimizar"            POST /rufe/reportes/1/anonimizar '{}'
sin_sesion "GET /rufe/borradores"       GET  /rufe/borradores
sin_sesion "GET /usuarios"              GET  /usuarios

titulo "El rol de solo visualización no captura"
prohibido() {
	local desc="$1" metodo="$2" ruta="$3" cuerpo="${4:-}" codigo
	codigo=$(curl -s -o /dev/null -w '%{http_code}' -X "$metodo" "$API$ruta" \
		-H "Authorization: Bearer $TOKEN_VISOR" -H 'Content-Type: application/json' -d "${cuerpo:-{\}}")
	[ "$codigo" = "403" ] && verde "$desc" || rojo "$desc" "esperaba 403, recibió $codigo"
}

prohibido "no abre los catálogos del formulario" GET  /rufe/catalogos
prohibido "no abre una carga de evidencias"      POST /rufe/cargas
prohibido "no registra un reporte"               POST /rufe/reportes
prohibido "no cambia el estado"                  PUT  /rufe/reportes/1/estado '{"estado":"VALIDADO"}'
prohibido "no anonimiza"                         POST /rufe/reportes/1/anonimizar

CODIGO=$(curl -s -o /dev/null -w '%{http_code}' "$API/rufe/reportes" -H "Authorization: Bearer $TOKEN_VISOR")
[ "$CODIGO" = "200" ] && verde "pero sí consulta la bandeja" || rojo "consulta la bandeja" "recibió $CODIGO"

titulo "El gestor sí captura"
espera "GET /rufe/catalogos con sesión de gestor" 200 GET /rufe/catalogos

titulo "Validación de la ficha"
# Las peticiones que fallan la validación también consumen cuota, así que se
# reinicia antes de cada bloque.
reset_limite
espera "cuerpo vacío devuelve 422" 422 POST /rufe/reportes '{}'
reset_limite
espera "sin personas devuelve 422" 422 POST /rufe/reportes "$(reporte 111 URBANO '[]')"
reset_limite
espera "fecha futura devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 112 URBANO '' true '' '2099-01-01')"
reset_limite
espera "parentesco fuera de 1..15 devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 113 URBANO '[{"nombres":"Ana","apellidos":"Mina","tipo_documento":3,"numero_documento":"31113","parentesco":99,"genero":2,"pertenencia_etnica":6,"telefono":"3105551234"}]')"
reset_limite
espera "sin jefe de hogar devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 114 URBANO '[{"nombres":"Ana","apellidos":"Mina","tipo_documento":3,"numero_documento":"31114","parentesco":3,"genero":2,"pertenencia_etnica":6,"telefono":"3105551234"}]')"
reset_limite
espera "cédula con letras devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 115 URBANO '[{"nombres":"Ana","apellidos":"Mina","tipo_documento":3,"numero_documento":"AB1234","parentesco":1,"genero":2,"pertenencia_etnica":6,"telefono":"3105551234"}]')"
reset_limite
espera "número con documento «sin identificación» devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 116 URBANO '[{"nombres":"Ana","apellidos":"Mina","tipo_documento":6,"numero_documento":"1234","parentesco":1,"genero":2,"pertenencia_etnica":6,"telefono":"3105551234"}]')"
reset_limite
espera "sin autorización devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 117 URBANO '' false)"
reset_limite
espera "corregimiento en zona urbana devuelve 422" 422 POST /rufe/reportes \
	"$(reporte 118 URBANO '' true ',"corregimiento":"Potrerito"')"
reset_limite
espera "once personas devuelven 422" 422 POST /rufe/reportes \
	"$(reporte 119 URBANO "[$(for i in $(seq 0 10); do
		printf '{"nombres":"Ana","apellidos":"Mina","tipo_documento":3,"numero_documento":"310000%02d","parentesco":%d,"genero":2,"pertenencia_etnica":6,"telefono":"3105551234"}' "$i" "$([ "$i" = 0 ] && echo 1 || echo 3)"
		[ "$i" -lt 10 ] && printf ','
	done)]")"

titulo "Inyección y XSS"
if hay_cuota; then
	reset_limite
	espera "una comilla SQL en la dirección no rompe nada" 201 POST /rufe/reportes \
		"$(reporte 201 URBANO '' true '' "$FECHA_OK" "Calle 5' OR 1=1 --")"
	reset_limite
	espera "HTML en las observaciones se acepta como texto plano" 201 POST /rufe/reportes \
		"$(reporte 202 URBANO '' true ',"observaciones":"<script>alert(1)</script> en el patio"')"
else
	omitida "inyección SQL"
	omitida "HTML en observaciones"
fi

titulo "Envío correcto"
reset_limite
RESPUESTA=$(curl -s -X POST "$API/rufe/reportes" -H "$AUTH" -H 'Content-Type: application/json' -d "$(reporte 300)")
RADICADO=$(printf '%s' "$RESPUESTA" | sed -n 's/.*"radicado":"\([^"]*\)".*/\1/p')

if printf '%s' "$RADICADO" | grep -Eq '^RUFE-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{8}$'; then
	verde "devuelve un radicado con el formato correcto ($RADICADO)"
else
	rojo "radicado con formato correcto" "$RESPUESTA"
fi

if printf '%s' "$RESPUESTA" | grep -q '"id"'; then
	rojo "la respuesta no expone el id interno" "$RESPUESTA"
else
	verde "la respuesta no expone el id interno"
fi

titulo "Duplicados"
if hay_cuota; then
	reset_limite
	espera "el mismo reporte dos veces devuelve 409" 409 POST /rufe/reportes "$(reporte 300)"
else
	omitida "detección de duplicados"
fi

titulo "Honeypot"
if hay_cuota; then
	reset_limite
	CODIGO=$(curl -s -o /tmp/sgr-hp.json -w '%{http_code}' -X POST "$API/rufe/reportes" \
		-H "$AUTH" -H 'Content-Type: application/json' \
		-d "$(reporte 400 URBANO '' true ',"sitio_web_relleno":1')")
	# El honeypot real: se sobreescribe el campo con contenido.
	CODIGO=$(curl -s -o /tmp/sgr-hp.json -w '%{http_code}' -X POST "$API/rufe/reportes" \
		-H "$AUTH" -H 'Content-Type: application/json' \
		-d "$(printf '%s' "$(reporte 401)" | sed 's/"sitio_web":""/"sitio_web":"http:\/\/spam.example"/')")
	RAD_FALSO=$(sed -n 's/.*"radicado":"\([^"]*\)".*/\1/p' /tmp/sgr-hp.json)

	if [ "$CODIGO" = "201" ] && [ -n "$RAD_FALSO" ]; then
		verde "el honeypot responde 201 con un radicado falso, sin delatarse"
	else
		rojo "el honeypot responde 201 falso" "recibió $CODIGO — $(head -c 200 /tmp/sgr-hp.json)"
	fi
else
	omitida "honeypot"
fi

titulo "Control de tasa"
# El tope por funcionario es holgado a propósito (una brigada levanta decenas de
# fichas al día), así que aquí solo se comprueba que una ráfaga normal no lo
# dispara. El corte en sí ya está cubierto por las pruebas de Limite.
reset_limite
CODIGOS=""
for _ in 1 2 3 4 5; do
	CODIGOS="$CODIGOS $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rufe/reportes" \
		-H "$AUTH" -H 'Content-Type: application/json' -d "$(reporte $RANDOM)")"
done

case "$CODIGOS" in
	*429*) rojo "cinco fichas seguidas no deben tocar el límite" "códigos:$CODIGOS" ;;
	*)     verde "una ráfaga de cinco fichas pasa sin tropezar con el límite" ;;
esac

titulo "Cargas de evidencias"
CARGA=$(curl -s -X POST "$API/rufe/cargas" -H "$AUTH" | sed -n 's/.*"carga":"\([^"]*\)".*/\1/p')
if [ ${#CARGA} -eq 64 ]; then
	verde "abre una carga con un token de 64 caracteres"
else
	rojo "abre una carga" "token de longitud ${#CARGA}"
fi

espera "un token con formato inválido devuelve 404" 404 GET /rufe/cargas/nope/archivos

# Un WebP real de 1x1 px: es lo que produce el navegador tras optimizar.
printf 'RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x02\x00\x34%%\xa4\x00\x03p\x00\xfe\xfb\xfd\x50\x00' > /tmp/sgr-prueba.webp

CODIGO=$(curl -s -o /tmp/sgr-up.json -w '%{http_code}' -X POST \
	"$API/rufe/cargas/$CARGA/archivos" -H "$AUTH" -F "archivo=@/tmp/sgr-prueba.webp")
[ "$CODIGO" = "201" ] && verde "acepta un WebP optimizado" \
	|| rojo "acepta un WebP optimizado" "recibió $CODIGO — $(head -c 200 /tmp/sgr-up.json)"

# PNG: era válido antes de que el navegador optimizara. Ya no, porque para una
# fotografía pesa varias veces más que WebP y nadie debería estar subiéndolo.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > /tmp/sgr-prueba.png
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
	"$API/rufe/cargas/$CARGA/archivos" -H "$AUTH" -F "archivo=@/tmp/sgr-prueba.png")
[ "$CODIGO" = "422" ] && verde "rechaza un PNG: solo entran WebP y JPEG" \
	|| rojo "rechaza un PNG" "recibió $CODIGO"

# Un archivo PHP disfrazado de imagen: la extensión dice .jpg, el contenido no.
printf '<?php system($_GET["c"]); ?>' > /tmp/sgr-malicioso.jpg
CODIGO=$(curl -s -o /tmp/sgr-mal.json -w '%{http_code}' -X POST \
	"$API/rufe/cargas/$CARGA/archivos" -H "$AUTH" -F "archivo=@/tmp/sgr-malicioso.jpg")
[ "$CODIGO" = "422" ] && verde "rechaza un PHP renombrado a .jpg" \
	|| rojo "rechaza un PHP renombrado a .jpg" "recibió $CODIGO"

printf 'no soy una imagen' > /tmp/sgr-prueba.exe
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
	"$API/rufe/cargas/$CARGA/archivos" -H "$AUTH" -F "archivo=@/tmp/sgr-prueba.exe")
[ "$CODIGO" = "422" ] && verde "rechaza una extensión fuera de la lista blanca" \
	|| rojo "rechaza una extensión fuera de la lista blanca" "recibió $CODIGO"

# La carga ajena no se puede listar sin su token.
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' \
	"$API/rufe/cargas/$(printf '0%.0s' $(seq 1 64))/archivos" -H "$AUTH")
[ "$CODIGO" = "200" ] && verde "una carga inexistente devuelve una lista vacía, no un error revelador" \
	|| rojo "carga inexistente" "recibió $CODIGO"

titulo "Tipos de evidencia"
CARGA2=$(curl -s -X POST "$API/rufe/cargas" -H "$AUTH" | sed -n 's/.*"carga":"\([^"]*\)".*/\1/p')
sube() { curl -s -o /tmp/sgr-t.json -w '%{http_code}' -X POST "$API/rufe/cargas/$CARGA2/archivos" -H "$AUTH" -F "tipo=$1" -F "archivo=@/tmp/sgr-prueba.webp"; }

[ "$(sube DOCUMENTO)" = "201" ] && verde "acepta la foto del documento" || rojo "acepta la foto del documento" ""
[ "$(sube DOCUMENTO)" = "422" ] && verde "el documento admite solo uno" || rojo "el documento admite solo uno" ""

CODIGOS=""
for _ in 1 2 3 4; do CODIGOS="$CODIGOS $(sube DANO)"; done
[ "$CODIGOS" = " 201 201 201 201" ] && verde "acepta cuatro fotos del daño" || rojo "acepta cuatro fotos del daño" "códigos:$CODIGOS"
[ "$(sube DANO)" = "422" ] && verde "la quinta foto del daño se rechaza" || rojo "la quinta foto del daño se rechaza" ""
[ "$(sube CUALQUIERA)" = "422" ] && verde "un tipo inventado se rechaza" || rojo "un tipo inventado se rechaza" ""

titulo "Reintento tras perder la señal"
if hay_cuota; then
	reset_limite
	ENVIO="aaaaaaaa-bbbb-4ccc-8ddd-$(printf '%012d' $RANDOM$RANDOM)"
	CUERPO=$(printf '%s' "$(reporte 700)" | sed "s/^{/{\"envio_id\":\"$ENVIO\",/")

	R1=$(curl -s -X POST "$API/rufe/reportes" -H "$AUTH" -H 'Content-Type: application/json' -d "$CUERPO")
	RAD1=$(printf '%s' "$R1" | sed -n 's/.*"radicado":"\([^"]*\)".*/\1/p')
	R2=$(curl -s -X POST "$API/rufe/reportes" -H "$AUTH" -H 'Content-Type: application/json' -d "$CUERPO")
	RAD2=$(printf '%s' "$R2" | sed -n 's/.*"radicado":"\([^"]*\)".*/\1/p')

	if [ -n "$RAD1" ] && [ "$RAD1" = "$RAD2" ]; then
		verde "reenviar el mismo envio_id devuelve el radicado original, sin duplicar"
	else
		rojo "reintento idempotente" "primero=$RAD1 segundo=$RAD2"
	fi

	printf '%s' "$R2" | grep -q '"reintento":true' \
		&& verde "el reintento se marca como tal en la respuesta" \
		|| rojo "el reintento se marca como tal" "$R2"
else
	omitida "reintento idempotente"
fi

printf '\n%s\n' "────────────────────────────────────────────────────────────"
if [ "$FALLOS" -eq 0 ]; then
	printf '\033[32m%s pruebas correctas' "$OK"
	[ "$OMITIDAS" -gt 0 ] && printf ', %s omitidas' "$OMITIDAS"
	printf '.\033[0m\n'
	exit 0
fi

printf '\033[31m%s fallo(s), %s correctas.\033[0m\n' "$FALLOS" "$OK"
exit 1
