<?php

declare(strict_types=1);

namespace App\Rufe;

use App\Core\Db;
use RuntimeException;

/**
 * Número de radicado con el que el ciudadano queda con constancia del envío.
 *
 * Formato: RUFE-AAAA-XXXXXXXX (18 caracteres).
 *
 * Los ocho caracteres finales son aleatorios, no correlativos. Un consecutivo
 * revelaría cuántos reportes lleva el municipio y permitiría adivinar radicados
 * ajenos, que es justo lo que un identificador entregado al ciudadano no debe
 * permitir.
 */
final class Radicado
{
    /**
     * Crockford Base32: sin I, L, O ni U, para que nadie confunda un 1 con una I
     * ni un 0 con una O al dictarlo por teléfono, y para que no salgan palabras.
     */
    private const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const LONGITUD = 8;

    private const INTENTOS = 8;

    /** Genera uno que no exista todavía. */
    public static function generar(): string
    {
        for ($i = 0; $i < self::INTENTOS; $i++) {
            $candidato = self::componer();

            $existe = Db::first(
                'SELECT id FROM rufe_reportes WHERE radicado = :r LIMIT 1',
                ['r' => $candidato]
            );

            if ($existe === null) {
                return $candidato;
            }
        }

        // Con 32^8 combinaciones esto solo puede pasar si algo va muy mal;
        // preferimos fallar a entregar un radicado repetido.
        throw new RuntimeException('No se pudo generar un número de radicado único.');
    }

    public static function componer(?int $ano = null): string
    {
        $sufijo = '';
        for ($i = 0; $i < self::LONGITUD; $i++) {
            $sufijo .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
        }

        return sprintf('RUFE-%04d-%s', $ano ?? (int) date('Y'), $sufijo);
    }

    public static function esValido(string $radicado): bool
    {
        return preg_match('/^RUFE-\d{4}-['.self::ALFABETO.']{'.self::LONGITUD.'}$/', $radicado) === 1;
    }

    /**
     * Huella anti-duplicado: identifica el mismo hogar, en el mismo sitio, por el
     * mismo evento. No es una restricción UNIQUE porque el mismo predio sí puede
     * tener dos reportes legítimos en eventos distintos.
     */
    public static function huella(string $fechaEvento, string $direccion, ?string $documentoJefe): string
    {
        $normalizada = preg_replace('/\s+/u', ' ', mb_strtolower(trim($direccion))) ?? '';

        return hash('sha256', $fechaEvento.'|'.$normalizada.'|'.($documentoJefe ?? ''));
    }
}
