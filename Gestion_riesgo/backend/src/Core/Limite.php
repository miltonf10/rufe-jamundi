<?php

declare(strict_types=1);

namespace App\Core;

/**
 * Control de tasa por ventana fija sobre la tabla `rufe_limite`.
 *
 * No se guarda la IP: la clave es un SHA-256 de acción + IP + sal + número de
 * ventana. Basta para contar a quien abusa y no conserva un dato personal que
 * el proceso de atención no necesita.
 *
 * Ventana fija y no deslizante porque una deslizante exige guardar una fila por
 * evento; con ventana fija basta un contador. El precio es que en el borde de
 * dos ventanas se puede llegar a 2x el límite, que para este caso es tolerable.
 */
final class Limite
{
    /** Probabilidad (1 en N) de purgar ventanas viejas en una petición dada. */
    private const PURGA_CADA = 100;

    /**
     * Suma uno al contador y falla con 429 si se pasó del máximo.
     *
     * @param  string  $accion      identificador corto, p. ej. 'rufe.enviar'
     * @param  int     $ventanaSeg  duración de la ventana en segundos
     */
    public static function consumir(
        string $accion,
        string $ip,
        int $maximo,
        int $ventanaSeg,
        string $mensaje = 'Ha realizado demasiadas solicitudes. Espere unos minutos e intente de nuevo.'
    ): void {
        $inicio = intdiv(time(), $ventanaSeg) * $ventanaSeg;
        $clave = self::clave($accion, $ip, $inicio);

        // LAST_INSERT_ID(expr) fija el valor que devolverá lastInsertId() en esta
        // conexión, así que el incremento y su lectura ocurren en una sola
        // sentencia y dos peticiones simultáneas no pueden leer el mismo total.
        Db::exec(
            'INSERT INTO rufe_limite (clave, contador, ventana_desde)
             VALUES (:c, 1, :v)
             ON DUPLICATE KEY UPDATE contador = LAST_INSERT_ID(contador + 1)',
            ['c' => $clave, 'v' => date('Y-m-d H:i:s', $inicio)]
        );

        // Sin columna AUTO_INCREMENT, un INSERT nuevo deja lastInsertId en 0:
        // ese caso es el primer uso de la ventana.
        $usos = Db::lastId();
        $usos = $usos === 0 ? 1 : $usos;

        self::purgarDeVezEnCuando();

        if ($usos > $maximo) {
            $restan = ($inicio + $ventanaSeg) - time();
            header('Retry-After: '.max(1, $restan));

            throw new HttpError($mensaje, 429);
        }
    }

    /** Cuántos usos lleva la ventana actual, sin consumir uno. */
    public static function usos(string $accion, string $ip, int $ventanaSeg): int
    {
        $inicio = intdiv(time(), $ventanaSeg) * $ventanaSeg;
        $fila = Db::first(
            'SELECT contador FROM rufe_limite WHERE clave = :c',
            ['c' => self::clave($accion, $ip, $inicio)]
        );

        return (int) ($fila['contador'] ?? 0);
    }

    private static function clave(string $accion, string $ip, int $ventanaInicio): string
    {
        return hash('sha256', $accion.'|'.$ip.'|'.$ventanaInicio.'|'.self::sal());
    }

    /**
     * Sin sal, quien conozca el esquema puede confirmar si una IP concreta envió
     * algo probando su hash contra la tabla.
     */
    private static function sal(): string
    {
        $sal = (string) Config::get('rufe.sal', '');

        return $sal !== '' ? $sal : (string) Config::get('db.password', 'sgr');
    }

    /**
     * No hay cron en el hosting, así que la limpieza va montada en el propio
     * tráfico. Una de cada cien peticiones limitadas paga el DELETE.
     */
    private static function purgarDeVezEnCuando(): void
    {
        if (random_int(1, self::PURGA_CADA) !== 1) {
            return;
        }

        Db::exec('DELETE FROM rufe_limite WHERE ventana_desde < (NOW() - INTERVAL 2 DAY)');
    }
}
