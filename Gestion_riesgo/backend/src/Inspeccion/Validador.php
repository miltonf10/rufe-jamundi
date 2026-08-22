<?php

declare(strict_types=1);

namespace App\Inspeccion;

use App\Rufe\Catalogos as Rufe;

/**
 * Valida y normaliza una inspección de vivienda completa.
 *
 * Manda sobre el validador del navegador. Y aquí manda más que en el RUFE: lo
 * que sale de esto no es un censo, es la determinación de qué materiales
 * públicos recibe una familia. El combo NO se acepta del cliente — se calcula
 * aquí a partir de la evaluación técnica, aunque el navegador ya lo haya
 * mostrado en pantalla.
 *
 * Dos reglas gobiernan el archivo:
 *
 *  1. Un campo de la rama que no se recorrió no se ignora: se rechaza. Si
 *     llegara una evaluación técnica en una ficha donde el afectado no cumple
 *     los requisitos, aceptarla en silencio dejaría en el expediente un dato
 *     que el formulario nunca volverá a mostrar y que nadie podrá corregir.
 *  2. Los mensajes van dirigidos a quien está en la puerta de la casa, no al
 *     programador: dicen qué hacer.
 */
final class Validador
{
    /** @var array<string,string> */
    private array $errores = [];

    /** @var array<string,mixed> */
    private array $datos = [];

    /**
     * @param  array<string,mixed>  $entrada
     * @return array{errores: array<string,string>, datos: array<string,mixed>}
     */
    public static function inspeccion(array $entrada): array
    {
        $v = new self;
        $v->general($entrada);
        $v->localizacion($entrada);

        $cumple = $v->requisitos($entrada);

        if ($cumple === true) {
            $v->evento($entrada);
            $v->sistema($entrada);
            $v->evaluacion($entrada);
            $v->informante($entrada);
            $v->rechazarActa($entrada);
        } elseif ($cumple === false) {
            $v->acta($entrada);
            $v->rechazarInspeccion($entrada);
        }

        $v->aprobacion($entrada);

        return ['errores' => $v->errores, 'datos' => $v->datos];
    }

    // ── 1. Información general ───────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function general(array $e): void
    {
        $this->datos['departamento'] = Catalogos::DEPARTAMENTO;
        $this->datos['municipio'] = Catalogos::MUNICIPIO;

        $fecha = $this->fecha($e, 'fecha_evaluacion');
        if ($fecha === null) {
            $this->errores['fecha_evaluacion'] = 'Indique la fecha de la evaluación.';
        } elseif ($fecha > date('Y-m-d')) {
            $this->errores['fecha_evaluacion'] = 'La fecha de la evaluación no puede ser posterior a hoy.';
        } elseif ($fecha < date('Y-m-d', strtotime('-'.Catalogos::ANOS_ATRAS.' years'))) {
            $this->errores['fecha_evaluacion'] = 'La fecha es demasiado antigua. Verifíquela.';
        } else {
            $this->datos['fecha_evaluacion'] = $fecha;
        }

        $this->exigir($e, 'profesional_nombre', 'Escriba el nombre del profesional responsable.', 3);
        $this->exigir($e, 'profesional_tarjeta', 'Indique la tarjeta profesional.', 3);
        $this->profesion($e);
        $this->documento($e, 'profesional_documento', 'Indique la cédula del profesional.');
        $this->opcional($e, 'profesional_documento_de');
        $this->tel($e, 'profesional_telefono', true);
        $this->opcional($e, 'profesional_direccion');

        $this->exigir($e, 'propietario_nombres', 'Escriba los nombres y apellidos del propietario.', 3);
        $this->documento($e, 'propietario_documento', 'Indique la cédula del propietario.');
        $this->opcional($e, 'propietario_documento_de');
        $this->tel($e, 'propietario_telefono', false);
        $this->opcional($e, 'propietario_direccion');

        $rufe = $e['rufe_reporte_id'] ?? null;
        $this->datos['rufe_reporte_id'] = is_numeric($rufe) && (int) $rufe > 0 ? (int) $rufe : null;
    }

    /**
     * La profesión de quien inspecciona.
     *
     * Se guarda ya resuelta —la etiqueta de la lista, o lo que se escribió en
     * «Otra»—, igual que hace el RUFE con el evento. Lo que va al papel y al
     * expediente es el nombre de la profesión, y no hay nada que filtrar por
     * código que justifique una columna más.
     *
     * @param  array<string,mixed>  $e
     */
    private function profesion(array $e): void
    {
        $codigo = $this->texto($e, 'profesional_profesion');
        $otra = $this->texto($e, 'profesional_profesion_otra');

        if ($codigo === '') {
            $this->errores['profesional_profesion'] = 'Indique la profesión.';

            return;
        }

        if (! Catalogos::esProfesionValida($codigo)) {
            $this->errores['profesional_profesion'] = 'Seleccione una profesión de la lista.';

            return;
        }

        if ($codigo === Catalogos::PROFESION_OTRA) {
            if (mb_strlen($otra) < 3 || mb_strlen($otra) > 120) {
                $this->errores['profesional_profesion_otra'] = 'Escriba la profesión, entre 3 y 120 caracteres.';

                return;
            }

            $this->datos['profesional_profesion'] = $otra;

            return;
        }

        // Un texto libre con una profesión de la lista elegida significa que el
        // formulario y el servidor no están de acuerdo: se rechaza en vez de
        // guardar en silencio un dato que nadie podrá volver a ver ni corregir.
        if ($otra !== '') {
            $this->errores['profesional_profesion_otra'] = 'Este campo solo aplica cuando elige "Otra".';

            return;
        }

        $this->datos['profesional_profesion'] = Catalogos::PROFESIONES[$codigo];
    }

    // ── 2. Localización ──────────────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function localizacion(array $e): void
    {
        $direccion = $this->texto($e, 'direccion_cabecera');
        $corregimiento = $this->texto($e, 'corregimiento');
        $vereda = $this->texto($e, 'vereda');

        // El formato tiene tres casillas —dirección en cabecera, corregimiento y
        // vereda— y una vivienda rural llena las dos últimas, una urbana la
        // primera. Exigir las tres dejaría fuera a media zona rural; no exigir
        // ninguna dejaría una inspección que no se puede ubicar en el terreno.
        if ($direccion === '' && $corregimiento === '' && $vereda === '') {
            $this->errores['direccion_cabecera'] = 'Indique al menos la dirección, el corregimiento o la vereda.';
        }

        if ($corregimiento !== '' && ! in_array($corregimiento, Rufe::CORREGIMIENTOS, true)) {
            $this->errores['corregimiento'] = 'Seleccione un corregimiento de la lista.';
        }

        $this->datos['direccion_cabecera'] = $this->recortar($direccion);
        $this->datos['corregimiento'] = $corregimiento;
        $this->datos['vereda'] = $this->recortar($vereda);

        $this->coordenadas($e);
    }

    /**
     * El punto GPS de la vivienda. Opcional, como en el censo.
     *
     * Es la misma regla que `Rufe\Validador::coordenadas()` y por el mismo
     * motivo: unas coordenadas ilegibles o de otro país no valen nada, pero
     * tampoco pueden tumbar la inspección entera. Se descartan y la visita
     * sigue, que es lo que hace falta cuando el GPS no engancha bajo un techo
     * de zinc en una casa entre montañas.
     *
     * @param  array<string,mixed>  $e
     */
    private function coordenadas(array $e): void
    {
        $this->datos['latitud'] = null;
        $this->datos['longitud'] = null;
        $this->datos['precision_m'] = null;

        $lat = $e['latitud'] ?? null;
        $lon = $e['longitud'] ?? null;

        if ($lat === null && $lon === null) {
            return;
        }

        if (! is_numeric($lat) || ! is_numeric($lon)) {
            $this->errores['latitud'] = 'No se pudo leer la ubicación. Continúe sin ella.';

            return;
        }

        $lat = (float) $lat;
        $lon = (float) $lon;

        // La misma caja que el RUFE: territorio continental e insular colombiano.
        if ($lat < -4.5 || $lat > 13.5 || $lon < -82.0 || $lon > -66.0) {
            $this->errores['latitud'] = 'La ubicación detectada está fuera de Colombia. Continúe sin ella.';

            return;
        }

        $this->datos['latitud'] = round($lat, 7);
        $this->datos['longitud'] = round($lon, 7);

        $precision = $e['precision_m'] ?? null;
        if (is_numeric($precision) && $precision >= 0 && $precision <= 10000) {
            $this->datos['precision_m'] = (int) $precision;
        }
    }

    // ── 3 y 4. Requisitos ────────────────────────────────────────────────────

    /**
     * Los tres requisitos y, derivado de ellos, el numeral 4.
     *
     * El numeral 4 NO se acepta del cliente. En el papel se puede marcar
     * «cumple» habiendo contestado que la persona no es propietaria; ese defecto
     * produce fichas que se contradicen a sí mismas y que después hay que
     * devolver.
     *
     * @param  array<string,mixed>  $e
     */
    private function requisitos(array $e): ?bool
    {
        $entrada = is_array($e['requisitos'] ?? null) ? $e['requisitos'] : [];
        $limpios = [];
        $faltan = false;

        foreach (array_keys(Catalogos::REQUISITOS) as $codigo) {
            $valor = $entrada[$codigo] ?? null;

            if (! is_bool($valor)) {
                $this->errores["requisitos.{$codigo}"] = 'Conteste sí o no.';
                $faltan = true;

                continue;
            }

            $limpios[$codigo] = $valor;
        }

        $this->datos['requisitos'] = $limpios;

        if ($faltan) {
            return null;
        }

        $cumple = ! in_array(false, $limpios, true);
        $this->datos['cumple_requisitos'] = $cumple;

        return $cumple;
    }

    // ── 5.1 Evento ───────────────────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function evento(array $e): void
    {
        $evento = $this->texto($e, 'evento');
        $otro = $this->texto($e, 'evento_otro');

        if ($evento === '') {
            $this->errores['evento'] = 'Indique qué evento afectó la vivienda.';

            return;
        }

        if (! Catalogos::esEventoValido($evento)) {
            $this->errores['evento'] = 'Seleccione uno de los eventos del formato.';

            return;
        }

        if ($evento === Catalogos::EVENTO_OTRO) {
            if (mb_strlen($otro) < 3 || mb_strlen($otro) > 120) {
                $this->errores['evento_otro'] = 'Describa el evento en un mínimo de 3 y un máximo de 120 caracteres.';

                return;
            }
            $this->datos['evento'] = Catalogos::EVENTO_OTRO;
            $this->datos['evento_otro'] = $otro;

            return;
        }

        if ($otro !== '') {
            $this->errores['evento_otro'] = 'Este campo solo aplica cuando elige "Otro".';

            return;
        }

        $this->datos['evento'] = $evento;
        $this->datos['evento_otro'] = null;
    }

    // ── 5.2 y 5.3 Sistema constructivo e infraestructura ─────────────────────

    /** @param array<string,mixed> $e */
    private function sistema(array $e): void
    {
        $sistema = $this->texto($e, 'sistema_constructivo');

        if (! in_array($sistema, NivelDano::SISTEMAS, true)) {
            $this->errores['sistema_constructivo'] = 'Indique si la vivienda es en mampostería o en madera.';

            return;
        }

        $this->datos['sistema_constructivo'] = $sistema;

        $entrada = is_array($e['infraestructura'] ?? null) ? $e['infraestructura'] : [];
        $limpia = [];

        foreach (Catalogos::CONVENCIONES as $categoria => $conv) {
            $letra = is_scalar($entrada[$categoria] ?? null) ? trim((string) $entrada[$categoria]) : '';

            if ($letra === '') {
                $this->errores["infraestructura.{$categoria}"] = 'Indique el material encontrado.';

                continue;
            }

            if (! Catalogos::esMaterialValido($categoria, $letra)) {
                $this->errores["infraestructura.{$categoria}"] = 'Use una de las convenciones del formato.';

                continue;
            }

            $limpia[$categoria] = $letra;
        }

        $this->datos['infraestructura'] = $limpia;
    }

    // ── 5.4 y 6. Evaluación técnica y banco de materiales ────────────────────

    /** @param array<string,mixed> $e */
    private function evaluacion(array $e): void
    {
        $sistema = $this->datos['sistema_constructivo'] ?? null;
        $colapso = ($e['colapso_total'] ?? false) === true;

        $this->datos['colapso_total'] = $colapso;

        $evacuacion = $e['requiere_evacuacion'] ?? null;
        if (! is_bool($evacuacion)) {
            $this->errores['requiere_evacuacion'] = 'Indique si la vivienda requiere evacuación.';
        } else {
            $this->datos['requiere_evacuacion'] = $evacuacion;
        }

        if ($sistema === null) {
            return;
        }

        $entrada = is_array($e['danos'] ?? null) ? $e['danos'] : [];
        $limpios = [];
        $niveles = [];

        if ($colapso) {
            // «Marque solo esta casilla». Una tabla llena junto al colapso no es
            // un exceso de celo: significa que alguien entendió mal el formato, y
            // hay que decírselo antes de que el expediente salga firmado.
            if ($entrada !== []) {
                $this->errores['danos'] = 'Con colapso estructural total no se llena la tabla por elementos.';
            }
        } else {
            foreach (NivelDano::elementos($sistema) as $codigo) {
                $fila = is_array($entrada[$codigo] ?? null) ? $entrada[$codigo] : [];
                $afectado = $fila['afectado'] ?? null;

                if (! is_bool($afectado)) {
                    $this->errores["danos.{$codigo}.afectado"] = 'Indique si este elemento resultó afectado.';

                    continue;
                }

                if (! $afectado) {
                    $limpios[$codigo] = ['afectado' => false, 'nivel' => null];
                    $niveles[$codigo] = null;

                    continue;
                }

                $nivel = is_scalar($fila['nivel'] ?? null) ? (string) $fila['nivel'] : '';

                if ($nivel === '') {
                    $this->errores["danos.{$codigo}.nivel"] = 'Elija el nivel de daño.';

                    continue;
                }

                if (! NivelDano::permite($sistema, $codigo, $nivel)) {
                    // Aquí se cierra el círculo del Anexo 1: un nivel que el
                    // anexo no describe para este elemento no puede entrar,
                    // aunque alguien lo mande a mano saltándose la pantalla.
                    $this->errores["danos.{$codigo}.nivel"] = 'El Anexo 1 no define ese nivel para este elemento.';

                    continue;
                }

                $limpios[$codigo] = ['afectado' => true, 'nivel' => $nivel];
                $niveles[$codigo] = $nivel;
            }

            // Un elemento que no pertenece a este sistema es señal de que la
            // ficha se llenó con la tabla equivocada.
            foreach (array_keys($entrada) as $codigo) {
                if (! in_array($codigo, NivelDano::elementos($sistema), true)) {
                    $this->errores['danos'] = 'La evaluación trae elementos que no corresponden al sistema constructivo.';
                    break;
                }
            }
        }

        $this->datos['danos'] = $limpios;

        // El combo se CALCULA, nunca se acepta del cliente: de él depende la
        // entrega de materiales.
        $combo = BancoMateriales::determinar($sistema, $niveles, $colapso);
        $this->datos['combo'] = $combo['combo'];
        $this->datos['combo_nivel'] = $combo['nivel'];
        $this->datos['combo_motivo'] = $combo['motivo'];

        $kit = $this->texto($e, 'kit_cubierta');

        if ($kit !== '' && ! isset(BancoMateriales::KITS_CUBIERTA[$sistema][$kit])) {
            $this->errores['kit_cubierta'] = 'Ese kit de cubierta no aplica a este sistema constructivo.';
            $kit = '';
        }

        $this->datos['kit_cubierta'] = $kit === '' ? null : $kit;

        // La lista de materiales se guarda resuelta y no solo derivable: dentro
        // de un año la norma puede haber cambiado, y el expediente tiene que
        // seguir diciendo qué se entregó y por qué.
        $this->datos['materiales'] = BancoMateriales::materiales(
            $sistema,
            $combo['nivel'],
            $kit === '' ? null : $kit
        );
    }

    // ── 7. Quién informa ─────────────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function informante(array $e): void
    {
        $this->exigir($e, 'informante_nombre', 'Escriba el nombre de quien atendió la visita.', 3);
        $this->documento($e, 'informante_documento', 'Indique la cédula de quien atendió la visita.');
        $this->tel($e, 'informante_telefono', false);

        $parentesco = $e['informante_parentesco'] ?? null;

        if (! is_numeric($parentesco) || ! isset(Rufe::PARENTESCOS[(int) $parentesco])) {
            $this->errores['informante_parentesco'] = 'Indique el parentesco con el propietario.';

            return;
        }

        $this->datos['informante_parentesco'] = (int) $parentesco;
    }

    // ── 8. Acta de quien no cumple ───────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function acta(array $e): void
    {
        $modalidad = $this->texto($e, 'acta_modalidad');

        if (! in_array($modalidad, ['REHABILITACION', 'CONSTRUCCION'], true)) {
            $this->errores['acta_modalidad'] = 'Indique si el apoyo era para rehabilitación o para construcción.';
        } else {
            $this->datos['acta_modalidad'] = $modalidad;
        }

        $this->exigir($e, 'acta_nombre', 'Escriba el nombre de quien queda enterado.', 3);
        $this->documento($e, 'acta_documento', 'Indique la cédula de quien queda enterado.');
        $this->tel($e, 'acta_telefono', false);
    }

    // ── 9. Aprobación ────────────────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function aprobacion(array $e): void
    {
        // El numeral 9 ya no se diligencia en campo. Quien levanta la ficha no
        // puede aprobarla en el mismo acto: de ella depende una entrega de
        // materiales públicos, y se llena de pie en la puerta de una casa. La
        // decisión se toma después, sobre la ficha guardada, con el mismo
        // mecanismo de estados del censo.
        //
        // Los dos campos siguen aceptándose —vacíos en las fichas nuevas— porque
        // las inspecciones ya levantadas los traen y el PDF los imprime.
        $this->opcional($e, 'aprobacion_profesional');
        $this->opcional($e, 'aprobacion_coordinador');
    }

    // ── Rechazo cruzado de ramas ─────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function rechazarActa(array $e): void
    {
        foreach (['acta_modalidad', 'acta_nombre', 'acta_documento', 'acta_telefono'] as $campo) {
            if ($this->texto($e, $campo) !== '') {
                $this->errores[$campo] = 'El acta solo aplica cuando el afectado no cumple los requisitos.';
            }
        }
    }

    /** @param array<string,mixed> $e */
    private function rechazarInspeccion(array $e): void
    {
        // El formato es tajante: «no se continúa con la inspección de la
        // vivienda, pasar al numeral 8».
        $sospechosos = ['evento', 'sistema_constructivo', 'kit_cubierta', 'informante_nombre'];

        foreach ($sospechosos as $campo) {
            if ($this->texto($e, $campo) !== '') {
                $this->errores[$campo] = 'No se continúa con la inspección cuando no se cumplen los requisitos.';
            }
        }

        if (($e['danos'] ?? []) !== [] || ($e['colapso_total'] ?? false) === true) {
            $this->errores['danos'] = 'No se continúa con la inspección cuando no se cumplen los requisitos.';
        }
    }

    // ── Utilidades ───────────────────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function exigir(array $e, string $clave, string $mensaje, int $minimo): void
    {
        $valor = $this->texto($e, $clave);

        if (mb_strlen($valor) < $minimo) {
            $this->errores[$clave] = $mensaje;

            return;
        }

        $this->datos[$clave] = $this->recortar($valor);
    }

    /** @param array<string,mixed> $e */
    private function opcional(array $e, string $clave): void
    {
        $valor = $this->texto($e, $clave);
        $this->datos[$clave] = $valor === '' ? null : $this->recortar($valor);
    }

    /** @param array<string,mixed> $e */
    private function documento(array $e, string $clave, string $mensaje): void
    {
        $digitos = preg_replace('/\D+/', '', $this->texto($e, $clave)) ?? '';

        if (strlen($digitos) < 5 || strlen($digitos) > 15) {
            $this->errores[$clave] = $mensaje;

            return;
        }

        $this->datos[$clave] = $digitos;
    }

    /** @param array<string,mixed> $e */
    private function tel(array $e, string $clave, bool $obligatorio): void
    {
        $valor = $this->texto($e, $clave);

        if ($valor === '') {
            if ($obligatorio) {
                $this->errores[$clave] = 'Indique un teléfono de contacto.';
            } else {
                $this->datos[$clave] = null;
            }

            return;
        }

        $digitos = preg_replace('/\D+/', '', $valor) ?? '';

        if (strlen($digitos) < 7 || strlen($digitos) > 15) {
            $this->errores[$clave] = 'Revise el teléfono: debe tener entre 7 y 15 dígitos.';

            return;
        }

        $this->datos[$clave] = $digitos;
    }

    /** @param array<string,mixed> $origen */
    private function texto(array $origen, string $clave): string
    {
        $valor = $origen[$clave] ?? '';

        if (! is_scalar($valor)) {
            return '';
        }

        return trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string) $valor) ?? '');
    }

    private function recortar(string $valor): string
    {
        return mb_substr($valor, 0, Catalogos::MAX_TEXTO);
    }

    /** @param array<string,mixed> $origen */
    private function fecha(array $origen, string $clave): ?string
    {
        $valor = $this->texto($origen, $clave);

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $valor, $m) !== 1) {
            return null;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $valor : null;
    }
}
