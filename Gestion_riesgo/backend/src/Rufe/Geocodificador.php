<?php

declare(strict_types=1);

namespace App\Rufe;

use App\Core\Config;

/**
 * Convierte una dirección del censo en coordenadas.
 *
 * Todo el municipio es Jamundí, así que a cada dirección se le añade
 * «Jamundí, Valle del Cauca, Colombia» antes de consultar. Sin ese sufijo, una
 * «Carrera 11 # 8 26» existe en media Colombia y el servicio devuelve cualquier
 * cosa.
 *
 * Se consulta primero OpenStreetMap, que es gratuito, y solo lo que falla se
 * manda a Google, que cobra. Mientras no haya clave de Google configurada, el
 * sistema funciona igual con lo que resuelva OpenStreetMap.
 *
 * La parte que decide qué tan buena es una respuesta —`clasificar()`— es la más
 * importante de este archivo, y es pura: se puede comprobar sin red. Una
 * dirección que solo se resuelve hasta el municipio devuelve coordenadas
 * perfectamente válidas y del todo inútiles; pintarlas amontonaría medio censo
 * sobre el parque principal y el mapa de calor mentiría.
 */
final class Geocodificador
{
    /** Lo que se le añade a toda dirección: el censo entero es de Jamundí. */
    public const SUFIJO = 'Jamundí, Valle del Cauca, Colombia';

    /**
     * Caja donde debe caer un punto para darlo por bueno.
     *
     * Jamundí va aproximadamente de 3,05 a 3,40 de latitud y de −76,80 a −76,45
     * de longitud. Un resultado fuera de aquí es del servicio equivocándose de
     * lugar, no de un predio del municipio.
     */
    public const CAJA = ['lat_min' => 3.00, 'lat_max' => 3.45, 'lon_min' => -76.85, 'lon_max' => -76.40];

    /** Centro del casco urbano, para detectar el centroide del municipio. */
    private const CENTRO = ['lat' => 3.2611, 'lon' => -76.5423];

    /** A menos de estos grados del centro sin más detalle, es el centroide. */
    private const RADIO_CENTROIDE = 0.004;

    /** Nominatim exige una petición por segundo como máximo. */
    public const PAUSA_SEGUNDOS = 1;

    /** Cuántas veces se reintenta una dirección que no se pudo resolver. */
    public const MAX_INTENTOS = 3;

    /**
     * Normaliza una dirección para poder reconocerla escrita de otra forma.
     *
     * «Cra 5 # 10-20» y «CARRERA 5 No 10 20» son la misma casa y deben gastar
     * una sola consulta al servicio.
     */
    public static function normalizar(string $direccion): string
    {
        $texto = mb_strtolower(trim($direccion), 'UTF-8');

        // Los separadores de número se unifican en '#'.
        $texto = preg_replace('/\bn(o|ro|º|°)?\.?\s*(?=\d)/u', '# ', $texto) ?? $texto;
        $texto = str_replace(['nº', 'n°', '№'], '#', $texto);

        $abreviaturas = [
            '/\b(cra|kra|kr|cr|carr)\b\.?/u' => 'carrera',
            '/\b(cll|cl|calle)\b\.?/u' => 'calle',
            '/\b(av|avda)\b\.?/u' => 'avenida',
            '/\b(dg|diag)\b\.?/u' => 'diagonal',
            '/\b(tv|trans|transv)\b\.?/u' => 'transversal',
            '/\b(mz|mza)\b\.?/u' => 'manzana',
            '/\b(bl|blq|bloq)\b\.?/u' => 'bloque',
            '/\b(apto|apt)\b\.?/u' => 'apartamento',
            '/\b(urb)\b\.?/u' => 'urbanizacion',
            '/\b(brr|brio|b°)\b\.?/u' => 'barrio',
        ];

        foreach ($abreviaturas as $patron => $reemplazo) {
            $texto = preg_replace($patron, $reemplazo, $texto) ?? $texto;
        }

        // Guiones y comas entre números son ruido para el geocodificador.
        $texto = preg_replace('/(?<=\d)\s*-\s*(?=\d)/u', ' ', $texto) ?? $texto;
        $texto = preg_replace('/[^\p{L}\p{N}#\s]/u', ' ', $texto) ?? $texto;

        // El almohadilla queda siempre igual de separado. Sin esto «#10» y
        // «# 10» darían claves distintas y gastarían dos consultas por la misma
        // casa, que es justo lo que la caché intenta evitar.
        $texto = preg_replace('/\s*#\s*/u', ' # ', $texto) ?? $texto;
        $texto = preg_replace('/\s+/u', ' ', $texto) ?? $texto;

        return trim($texto);
    }

    /** La clave de caché: misma dirección normalizada, mismo resultado. */
    public static function clave(string $direccion): string
    {
        return hash('sha256', self::normalizar($direccion));
    }

    /** El texto que se le manda al servicio, ya con el municipio. */
    public static function consulta(string $direccion): string
    {
        return self::normalizar($direccion).', '.self::SUFIJO;
    }

    /**
     * Lo que la gente escribe cuando no hay dirección. Gastar una consulta en
     * esto es tirar cupo, y el servicio contestaría el centro del municipio.
     */
    private const NO_SON_DIRECCION = [
        'na', 'nn', 'no aplica', 'no informa', 'no informo', 'sin direccion',
        'sin dato', 'sin datos', 'no reporta', 'ninguna', 'ninguno', 'no tiene',
    ];

    /**
     * ¿Vale la pena siquiera intentar geocodificar esto?
     *
     * No se exige que traiga número: «Juan de Ampudia» es una vía real y se
     * resuelve a precisión de calle, que para el mapa de calor ya sirve. Lo que
     * se descarta es lo que no es una dirección en absoluto.
     */
    public static function utilizable(string $direccion): bool
    {
        $normal = self::normalizar($direccion);

        if (mb_strlen($normal) < 5 || in_array($normal, self::NO_SON_DIRECCION, true)) {
            return false;
        }

        // O trae un número, o son al menos dos palabras: «casa» sola no ubica.
        return preg_match('/\d/u', $normal) === 1 || count(explode(' ', $normal)) >= 2;
    }

    /**
     * ¿El resultado está de verdad en Jamundí?
     *
     * Se comprueba por el nombre del municipio que devuelve el servicio, no solo
     * por coordenadas. La caja de coordenadas es un rectángulo y Jamundí no lo
     * es: roza Cali por el norte y Villa Rica y Puerto Tejada por el sur, así que
     * por caja sola se colaban aciertos de municipios vecinos y se pintaban como
     * propios.
     *
     * @param  array<string,mixed>  $candidato  Respuesta de Nominatim
     */
    public static function esDeJamundi(array $candidato): bool
    {
        $lat = isset($candidato['lat']) ? (float) $candidato['lat'] : null;
        $lon = isset($candidato['lon']) ? (float) $candidato['lon'] : null;

        if ($lat === null || $lon === null || ! self::dentroDeJamundi($lat, $lon)) {
            return false;
        }

        $direccion = $candidato['address'] ?? null;
        if (! is_array($direccion)) {
            // Sin detalle no se puede comprobar el nombre; queda la caja, que ya
            // se comprobó arriba.
            return true;
        }

        // Nominatim mete el municipio en una clave u otra según el tipo de lugar.
        foreach (['county', 'city', 'town', 'municipality', 'village', 'city_district'] as $clave) {
            $valor = $direccion[$clave] ?? null;
            if (is_string($valor) && self::esNombreDeJamundi($valor)) {
                return true;
            }
        }

        return false;
    }

    /** Compara sin tildes ni mayúsculas: llega «Jamundí» y también «Jamundi». */
    private static function esNombreDeJamundi(string $valor): bool
    {
        $sinTildes = strtr(mb_strtolower($valor, 'UTF-8'), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u']);

        return str_contains($sinTildes, 'jamundi');
    }

    /** ¿Cae el punto dentro del municipio? */
    public static function dentroDeJamundi(float $lat, float $lon): bool
    {
        return $lat >= self::CAJA['lat_min'] && $lat <= self::CAJA['lat_max']
            && $lon >= self::CAJA['lon_min'] && $lon <= self::CAJA['lon_max'];
    }

    /**
     * Qué tan fino es el resultado que devolvió el servicio.
     *
     * @param  array<string,mixed>  $r  Respuesta ya homogeneizada: lat, lon, tipo
     */
    public static function clasificar(array $r): string
    {
        $lat = isset($r['lat']) ? (float) $r['lat'] : null;
        $lon = isset($r['lon']) ? (float) $r['lon'] : null;

        if ($lat === null || $lon === null || ! self::dentroDeJamundi($lat, $lon)) {
            return 'FALLIDA';
        }

        // Un punto pegado al centro y sin detalle de calle es el centroide del
        // municipio: el servicio contestó «Jamundí», no la dirección pedida.
        $tipo = mb_strtolower((string) ($r['tipo'] ?? ''), 'UTF-8');
        $cercaDelCentro = abs($lat - self::CENTRO['lat']) < self::RADIO_CENTROIDE
            && abs($lon - self::CENTRO['lon']) < self::RADIO_CENTROIDE;

        $deMunicipio = ['administrative', 'city', 'town', 'municipality', 'locality', 'boundary'];
        if (in_array($tipo, $deMunicipio, true) || ($cercaDelCentro && $tipo === '')) {
            return 'MUNICIPIO';
        }

        $deDireccion = ['house', 'building', 'street_address', 'premise', 'rooftop', 'house_number'];
        if (in_array($tipo, $deDireccion, true)) {
            return 'EXACTA';
        }

        $deCalle = ['road', 'residential', 'route', 'highway', 'tertiary', 'secondary', 'primary'];
        if (in_array($tipo, $deCalle, true)) {
            return 'CALLE';
        }

        return 'BARRIO';
    }

    /** ¿Se puede dibujar un punto con esta precisión? */
    public static function pintable(string $precision): bool
    {
        return in_array($precision, ['EXACTA', 'CALLE', 'BARRIO'], true);
    }

    /**
     * ¿Hay clave de Google configurada? Si no, solo se usa OpenStreetMap.
     *
     * Sin configuración cargada la respuesta es «no», que es lo correcto: no
     * hay clave, luego no se puede llamar a un servicio de pago. Así la clase
     * también se puede comprobar fuera de la aplicación.
     */
    public static function hayGoogle(): bool
    {
        try {
            return (string) Config::get('geocodificacion.google_key', '') !== '';
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Resuelve una dirección. Devuelve null si ningún servicio la ubicó.
     *
     * @return array{lat: float, lon: float, precision: string, fuente: string, etiqueta: string}|null
     */
    public static function resolver(string $direccion): ?array
    {
        if (! self::utilizable($direccion)) {
            return null;
        }

        $consulta = self::consulta($direccion);

        $resultado = self::enOpenStreetMap($consulta);
        if ($resultado !== null && self::pintable($resultado['precision'])) {
            return $resultado;
        }

        // A Google solo va lo que OpenStreetMap no supo ubicar bien: es lo que
        // cuesta dinero.
        if (self::hayGoogle()) {
            $deGoogle = self::enGoogle($consulta);
            if ($deGoogle !== null && self::pintable($deGoogle['precision'])) {
                return $deGoogle;
            }
        }

        return $resultado;
    }

    /** @return array{lat: float, lon: float, precision: string, fuente: string, etiqueta: string}|null */
    private static function enOpenStreetMap(string $consulta): ?array
    {
        // Tres cosas que hacen la diferencia entre ubicar bien y ubicar en otro
        // municipio:
        //
        //   viewbox + bounded=1  Restringen la BÚSQUEDA a Jamundí. Sin esto,
        //     «Carrera 11 # 8 26» se busca en toda Colombia —esa dirección existe
        //     en cientos de pueblos— y el servicio devuelve la que le parece
        //     mejor, que suele estar a cientos de kilómetros.
        //   addressdetails=1     Permite comprobar que el resultado está de
        //     verdad en Jamundí. La caja de coordenadas sola no basta: roza Cali,
        //     Villa Rica y Puerto Tejada, así que un acierto en el sur de Cali la
        //     pasaría y se pintaría como si fuera de aquí.
        //   limit=5              El primer resultado no siempre es el bueno. Se
        //     piden varios y se escoge el primero que esté realmente en Jamundí.
        $url = 'https://nominatim.openstreetmap.org/search?'.http_build_query([
            'q' => $consulta,
            'format' => 'jsonv2',
            'limit' => 5,
            'countrycodes' => 'co',
            'addressdetails' => 1,
            'viewbox' => self::CAJA['lon_min'].','.self::CAJA['lat_max']
                .','.self::CAJA['lon_max'].','.self::CAJA['lat_min'],
            'bounded' => 1,
        ]);

        // La política de Nominatim exige identificarse con algo que permita
        // contactar al responsable. Un User-Agent genérico se bloquea.
        $cuerpo = self::pedir($url, [
            'Accept: application/json',
            'User-Agent: SGR-Jamundi/1.0 (Alcaldia de Jamundi; oticjamundi.com)',
        ]);

        if ($cuerpo === null) {
            return null;
        }

        $datos = json_decode($cuerpo, true);
        if (! is_array($datos) || $datos === []) {
            return null;
        }

        // Se recorren los candidatos y se escoge el primero que esté de verdad en
        // Jamundí y que además sirva para pintar. Quedarse con el primero sin
        // mirar era lo que traía predios de otros municipios.
        $mejor = null;

        foreach ($datos as $candidato) {
            if (! isset($candidato['lat'], $candidato['lon'])) {
                continue;
            }
            if (! self::esDeJamundi($candidato)) {
                continue;
            }

            $crudo = [
                'lat' => (float) $candidato['lat'],
                'lon' => (float) $candidato['lon'],
                'tipo' => (string) ($candidato['type'] ?? $candidato['category'] ?? ''),
            ];

            $resultado = [
                'lat' => $crudo['lat'],
                'lon' => $crudo['lon'],
                'precision' => self::clasificar($crudo),
                'fuente' => 'NOMINATIM',
                'etiqueta' => mb_substr((string) ($candidato['display_name'] ?? ''), 0, 255),
            ];

            // El primero que sirva para pintar gana; si ninguno sirve, se guarda
            // el primero válido para poder informar de por qué no se pudo.
            if (self::pintable($resultado['precision'])) {
                return $resultado;
            }

            $mejor ??= $resultado;
        }

        return $mejor;
    }

    /** @return array{lat: float, lon: float, precision: string, fuente: string, etiqueta: string}|null */
    private static function enGoogle(string $consulta): ?array
    {
        $url = 'https://maps.googleapis.com/maps/api/geocode/json?'.http_build_query([
            'address' => $consulta,
            'region' => 'co',
            'key' => (string) Config::get('geocodificacion.google_key', ''),
        ]);

        $cuerpo = self::pedir($url, ['Accept: application/json', 'User-Agent: SGR-Jamundi/1.0']);
        if ($cuerpo === null) {
            return null;
        }

        $datos = json_decode($cuerpo, true);
        if (! is_array($datos) || ($datos['status'] ?? '') !== 'OK' || ! isset($datos['results'][0])) {
            return null;
        }

        $primero = $datos['results'][0];
        $punto = $primero['geometry']['location'] ?? null;
        if (! isset($punto['lat'], $punto['lng'])) {
            return null;
        }

        // Google dice en `location_type` qué tan fino es el punto; ROOFTOP es una
        // casa concreta y APPROXIMATE suele ser el centro de una zona.
        $tipoGoogle = (string) ($primero['geometry']['location_type'] ?? '');
        $tipo = match ($tipoGoogle) {
            'ROOFTOP' => 'rooftop',
            'RANGE_INTERPOLATED' => 'house_number',
            'GEOMETRIC_CENTER' => 'road',
            default => (string) ($primero['types'][0] ?? ''),
        };

        $crudo = ['lat' => (float) $punto['lat'], 'lon' => (float) $punto['lng'], 'tipo' => $tipo];

        return [
            'lat' => $crudo['lat'],
            'lon' => $crudo['lon'],
            'precision' => self::clasificar($crudo),
            'fuente' => 'GOOGLE',
            'etiqueta' => mb_substr((string) ($primero['formatted_address'] ?? ''), 0, 255),
        ];
    }

    /**
     * @param  list<string>  $cabeceras
     */
    private static function pedir(string $url, array $cabeceras, int $segundos = 12): ?string
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $cabeceras,
                CURLOPT_TIMEOUT => $segundos,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $cuerpo = curl_exec($ch);
            $estado = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

            return is_string($cuerpo) && $estado >= 200 && $estado < 300 ? $cuerpo : null;
        }

        $contexto = stream_context_create([
            'http' => ['header' => implode("\r\n", $cabeceras), 'timeout' => $segundos],
        ]);

        $cuerpo = @file_get_contents($url, false, $contexto);

        return is_string($cuerpo) ? $cuerpo : null;
    }
}
