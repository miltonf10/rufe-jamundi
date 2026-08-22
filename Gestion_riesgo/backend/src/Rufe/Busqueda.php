<?php

declare(strict_types=1);

namespace App\Rufe;

/**
 * Construye la condición SQL del buscador de la bandeja.
 *
 * Vive aparte del controlador por una razón concreta: la versión anterior
 * repetía el marcador `:q` cuatro veces en la misma consulta. Con
 * `ATTR_EMULATE_PREPARES => false` las preparadas son nativas de MySQL, y ahí
 * un marcador con el mismo nombre NO se puede reutilizar — el servidor
 * respondía `SQLSTATE[HY093] Invalid parameter number` y el buscador devolvía
 * error 500 con cualquier texto. Nunca funcionó, y no había forma de detectarlo
 * sin base de datos porque el fallo solo aparece al preparar la consulta.
 *
 * Aquí se puede comprobar sin MySQL que cada marcador aparece exactamente una
 * vez y que hay un parámetro para cada uno.
 */
final class Busqueda
{
    /** Cuántas palabras del nombre se tienen en cuenta. */
    public const MAX_PALABRAS = 4;

    /** Longitud mínima de una palabra para buscar por nombre. */
    private const MIN_LETRAS = 2;

    /**
     * Devuelve `[condicionSql, parametros]` para el texto buscado.
     *
     * Si no hay nada que buscar devuelve `['', []]`, y quien llama debe omitir
     * la condición.
     *
     * @return array{0: string, 1: array<string, string>}
     */
    public static function condicion(string $texto): array
    {
        $texto = trim($texto);
        if ($texto === '') {
            return ['', []];
        }

        $partes = [];
        $params = [];

        // Campos del hogar. Van con LIKE por ambos lados para que sirva escribir
        // solo un trozo del radicado o de la dirección.
        $comodin = '%'.self::escaparLike($texto).'%';

        foreach (['r.radicado', 'r.direccion', 'r.vereda_sector_barrio', 'r.evento'] as $i => $columna) {
            $clave = 'q'.$i;
            $partes[] = "{$columna} LIKE :{$clave}";
            $params[$clave] = $comodin;
        }

        // Cédula. Se compara exacta, no por trozos: un documento parcial
        // devolvería decenas de hogares ajenos y convertiría el buscador en una
        // forma de pasear por el censo. Se limpian puntos, comas y espacios
        // porque la gente escribe «1.113.456.789».
        $documento = preg_replace('/[.,\s-]/', '', $texto) ?? '';
        if ($documento !== '' && preg_match('/^\d{4,20}$/', $documento) === 1) {
            $partes[] = 'EXISTS (SELECT 1 FROM rufe_personas pd
                                  WHERE pd.reporte_id = r.id AND pd.numero_documento = :doc)';
            $params['doc'] = $documento;
        }

        // Nombre completo. Se exige que TODAS las palabras aparezcan en el nombre
        // y apellido concatenados, así que el orden da igual: «garcía juan»
        // encuentra a «Juan Pérez García». La intercalación de acentos y
        // mayúsculas la resuelve sola la colación utf8mb4_unicode_ci de la tabla.
        $palabras = self::palabras($texto);
        if ($palabras !== []) {
            $condicionesNombre = [];

            foreach ($palabras as $i => $palabra) {
                $clave = 'n'.$i;
                $condicionesNombre[] = "CONCAT(pn.nombres, ' ', pn.apellidos) LIKE :{$clave}";
                $params[$clave] = '%'.self::escaparLike($palabra).'%';
            }

            $partes[] = 'EXISTS (SELECT 1 FROM rufe_personas pn
                                  WHERE pn.reporte_id = r.id AND '
                                  .implode(' AND ', $condicionesNombre).')';
        }

        return ['('.implode(' OR ', $partes).')', $params];
    }

    /**
     * ¿Este texto busca a una persona concreta?
     *
     * Sirve para dejar constancia en la auditoría de que alguien buscó por
     * cédula o por nombre, que es un acceso dirigido a datos personales y no
     * lo mismo que listar la bandeja.
     */
    public static function buscaPersona(string $texto): bool
    {
        [, $params] = self::condicion($texto);

        foreach (array_keys($params) as $clave) {
            if ($clave === 'doc' || str_starts_with($clave, 'n')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Palabras utilizables del nombre.
     *
     * Se descartan las de una sola letra —una «y» o una inicial suelta harían
     * coincidir a media base— y los trozos que son solo dígitos, que ya se
     * intentaron como documento.
     *
     * @return list<string>
     */
    private static function palabras(string $texto): array
    {
        $crudas = preg_split('/\s+/u', $texto) ?: [];
        $utiles = [];

        foreach ($crudas as $palabra) {
            if (preg_match('/^\d+$/', $palabra) === 1) {
                continue;
            }
            if (mb_strlen($palabra) < self::MIN_LETRAS) {
                continue;
            }

            $utiles[] = $palabra;

            if (count($utiles) === self::MAX_PALABRAS) {
                break;
            }
        }

        return $utiles;
    }

    /**
     * Neutraliza los comodines del propio LIKE.
     *
     * Sin esto, buscar «%» devolvería la base entera y «_» casaría con
     * cualquier carácter.
     */
    private static function escaparLike(string $valor): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $valor);
    }
}
