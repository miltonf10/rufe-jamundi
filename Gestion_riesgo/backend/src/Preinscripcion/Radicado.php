<?php

declare(strict_types=1);

namespace App\Preinscripcion;

use App\Core\Db;
use RuntimeException;

/**
 * El radicado que se le entrega al ciudadano.
 *
 * Formato: PRE-AAAA-XXXXXXXX, calcado de `Rufe\Radicado` y por las mismas
 * razones: los caracteres finales son aleatorios y no correlativos —un
 * consecutivo diría cuánta gente se ha pre-inscrito y dejaría adivinar el
 * radicado del vecino— y el alfabeto es Crockford Base32, sin I, L, O ni U,
 * para que nadie confunda un 1 con una I al dictarlo por teléfono.
 *
 * El prefijo lo distingue de un radicado del censo y de una ficha de
 * inspección: los tres van a convivir en la misma carpeta.
 */
final class Radicado
{
    private const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const LONGITUD = 8;

    private const INTENTOS = 8;

    public static function generar(): string
    {
        for ($i = 0; $i < self::INTENTOS; $i++) {
            $candidato = self::componer();

            $existe = Db::first(
                'SELECT id FROM preinscripciones WHERE radicado = :r LIMIT 1',
                ['r' => $candidato]
            );

            if ($existe === null) {
                return $candidato;
            }
        }

        // Con 32^8 combinaciones esto solo pasa si algo va muy mal. Preferimos
        // fallar a entregarle el mismo radicado a dos familias.
        throw new RuntimeException('No se pudo generar un radicado único.');
    }

    public static function componer(?int $ano = null): string
    {
        $sufijo = '';

        for ($i = 0; $i < self::LONGITUD; $i++) {
            $sufijo .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
        }

        return sprintf('PRE-%04d-%s', $ano ?? (int) date('Y'), $sufijo);
    }

    public static function esValido(string $radicado): bool
    {
        return preg_match('/^PRE-\d{4}-['.self::ALFABETO.']{'.self::LONGITUD.'}$/', $radicado) === 1;
    }

    /**
     * Huella anti-duplicado: la misma vivienda, del mismo solicitante.
     *
     * No lleva la fecha, al revés que la de la inspección: dos pre-inscripciones
     * del mismo hogar en días distintos siguen siendo la misma solicitud, y lo
     * que hay que evitar es que la familia se inscriba tres veces por nervios y
     * ocupe tres turnos.
     */
    public static function huella(string $direccion, string $documento): string
    {
        $normalizada = preg_replace('/\s+/u', ' ', mb_strtolower(trim($direccion))) ?? '';

        return hash('sha256', $normalizada.'|'.trim($documento));
    }
}
