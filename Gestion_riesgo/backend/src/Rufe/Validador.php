<?php

declare(strict_types=1);

namespace App\Rufe;

/**
 * Valida y normaliza un reporte RUFE completo.
 *
 * Devuelve errores por campo con ruta con puntos (`personas.2.numero_documento`)
 * para que el formulario pueda llevar al ciudadano al control exacto.
 *
 * Regla que gobierna todo el archivo: un campo condicional apagado no se ignora,
 * se rechaza. Si llegara `corregimiento` con `zona = URBANO`, aceptarlo en
 * silencio dejaría en la base un dato que el formulario nunca mostrará y que
 * nadie podrá corregir. Es la única forma de que la lógica del navegador y la
 * del servidor no puedan divergir sin que se note.
 *
 * Los mensajes van dirigidos al ciudadano, no al programador: dicen qué hacer.
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
    public static function reporte(array $entrada): array
    {
        $v = new self;
        $v->evento($entrada);
        $v->ubicacion($entrada);
        $v->bien($entrada);
        $v->personas($entrada);
        $v->agropecuario($entrada);
        $v->cierre($entrada);

        return ['errores' => $v->errores, 'datos' => $v->datos];
    }

    // ── Secciones ────────────────────────────────────────────────────────────

    /** @param array<string,mixed> $e */
    private function evento(array $e): void
    {
        $this->datos['departamento'] = Catalogos::DEPARTAMENTO;
        $this->datos['municipio'] = Catalogos::MUNICIPIO;
        $this->datos['formato_version'] = Catalogos::FORMATO_VERSION;
        $this->datos['fecha_rufe'] = date('Y-m-d');

        $evento = $this->texto($e, 'evento');
        $otro = $this->texto($e, 'evento_otro');

        if ($evento === '') {
            $this->errores['evento'] = 'Indique qué ocurrió.';
        } elseif ($evento === 'OTRO') {
            // C1: el texto libre solo existe cuando se eligió "Otro".
            if (mb_strlen($otro) < 3 || mb_strlen($otro) > 120) {
                $this->errores['evento_otro'] = 'Describa el evento en un mínimo de 3 y un máximo de 120 caracteres.';
            } else {
                $this->datos['evento'] = $otro;
            }
        } elseif (! in_array($evento, Catalogos::EVENTOS_SUGERIDOS, true)) {
            $this->errores['evento'] = 'Seleccione uno de los eventos de la lista.';
        } else {
            if ($otro !== '') {
                $this->errores['evento_otro'] = 'Este campo solo aplica cuando elige "Otro".';
            }
            $this->datos['evento'] = $evento;
        }

        $fecha = $this->fecha($e, 'fecha_evento');
        if ($fecha === null) {
            $this->errores['fecha_evento'] = 'Indique la fecha en que ocurrió el evento.';
        } elseif ($fecha > date('Y-m-d')) {
            $this->errores['fecha_evento'] = 'La fecha del evento no puede ser posterior a hoy.';
        } elseif ($fecha < date('Y-m-d', strtotime('-'.Catalogos::ANOS_ATRAS_EVENTO.' years'))) {
            $this->errores['fecha_evento'] = 'Solo se registran eventos ocurridos en los últimos '
                .Catalogos::ANOS_ATRAS_EVENTO.' años. Si es más antiguo, acérquese a la Secretaría.';
        } else {
            $this->datos['fecha_evento'] = $fecha;
        }
    }

    /** @param array<string,mixed> $e */
    private function ubicacion(array $e): void
    {
        $zona = $this->opcion($e, 'zona', Catalogos::ZONAS, 'Indique si el inmueble está en zona urbana o rural.');
        $corregimiento = $this->texto($e, 'corregimiento');

        // C2 y C3: el corregimiento solo existe en zona rural.
        if ($zona === 'RURAL') {
            if (mb_strlen($corregimiento) < 3 || mb_strlen($corregimiento) > 120) {
                $this->errores['corregimiento'] = 'Indique el corregimiento donde está el inmueble.';
            } else {
                $this->datos['corregimiento'] = $corregimiento;
            }
        } else {
            if ($corregimiento !== '') {
                $this->errores['corregimiento'] = 'El corregimiento solo aplica a inmuebles en zona rural.';
            }
            $this->datos['corregimiento'] = null;
        }

        $lugar = $this->texto($e, 'vereda_sector_barrio');
        if (mb_strlen($lugar) < 3 || mb_strlen($lugar) > 160) {
            $this->errores['vereda_sector_barrio'] = $zona === 'RURAL'
                ? 'Indique la vereda o sector.'
                : 'Indique el barrio.';
        } else {
            $this->datos['vereda_sector_barrio'] = $lugar;
        }

        $direccion = $this->texto($e, 'direccion');
        if (mb_strlen($direccion) < 5 || mb_strlen($direccion) > 200) {
            $this->errores['direccion'] = 'Escriba la dirección del inmueble, con un mínimo de 5 caracteres.';
        } else {
            $this->datos['direccion'] = $direccion;
        }

        $this->coordenadas($e);
    }

    /**
     * C12: las coordenadas son opcionales y van juntas o no van. Media coordenada
     * no ubica nada y ensuciaría cualquier mapa que las consuma.
     *
     * @param array<string,mixed> $e
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

        // Caja que cubre el territorio continental e insular colombiano.
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

    /** @param array<string,mixed> $e */
    private function bien(array $e): void
    {
        $alojamiento = $this->opcion(
            $e, 'alojamiento', Catalogos::ALOJAMIENTOS,
            'Indique dónde se está alojando actualmente.'
        );
        $direccionAlojamiento = $this->texto($e, 'alojamiento_direccion');

        // C4
        if ($alojamiento === 'EVACUADO') {
            if (mb_strlen($direccionAlojamiento) < 5 || mb_strlen($direccionAlojamiento) > 200) {
                $this->errores['alojamiento_direccion'] = 'Indique dónde se está alojando ahora.';
            } else {
                $this->datos['alojamiento_direccion'] = $direccionAlojamiento;
            }
        } else {
            if ($direccionAlojamiento !== '') {
                $this->errores['alojamiento_direccion'] = 'Este campo solo aplica si tuvo que evacuar.';
            }
            $this->datos['alojamiento_direccion'] = null;
        }

        $this->opcion(
            $e, 'forma_tenencia', Catalogos::FORMAS_TENENCIA,
            'Indique qué relación tiene con el inmueble.'
        );
        $this->opcion(
            $e, 'estado_bien', Catalogos::ESTADOS_BIEN,
            'Indique cómo quedó el inmueble.'
        );
        $this->opcion(
            $e, 'tipo_bien', Catalogos::TIPOS_BIEN,
            'Indique qué tipo de inmueble es.'
        );
    }

    /** @param array<string,mixed> $e */
    private function personas(array $e): void
    {
        $lista = is_array($e['personas'] ?? null) ? array_values($e['personas']) : [];

        if ($lista === []) {
            $this->errores['personas'] = 'Registre al menos a una persona del hogar.';
            $this->datos['personas'] = [];

            return;
        }

        if (count($lista) > Catalogos::MAX_PERSONAS) {
            $this->errores['personas'] = 'El formato oficial admite hasta '.Catalogos::MAX_PERSONAS
                .' personas. Si su hogar es más numeroso, comuníquese con la Secretaría de Gestión del Riesgo.';

            return;
        }

        $normalizadas = [];
        $jefes = 0;
        $documentosVistos = [];

        foreach ($lista as $i => $cruda) {
            if (! is_array($cruda)) {
                $this->errores["personas.{$i}"] = 'Los datos de esta persona no se pudieron leer.';

                continue;
            }

            // El orden se reasigna aquí y no se toma del cliente: el formato exige
            // renglones contiguos desde 1 y el cliente pudo borrar personas.
            $persona = $this->persona($cruda, (string) $i);
            $persona['orden'] = $i + 1;

            if (($persona['parentesco'] ?? null) === Catalogos::PARENTESCO_JEFE) {
                $jefes++;
            }

            $numero = $persona['numero_documento'] ?? null;
            if (is_string($numero) && $numero !== '') {
                $llave = $persona['tipo_documento'].':'.mb_strtoupper($numero);
                if (isset($documentosVistos[$llave])) {
                    $this->errores["personas.{$i}.numero_documento"] =
                        'Este documento ya fue registrado en otra persona del hogar.';
                } else {
                    $documentosVistos[$llave] = true;
                }
            }

            $normalizadas[] = $persona;
        }

        if ($jefes === 0) {
            $this->errores['personas'] = 'Señale quién es el jefe o cabeza de hogar.';
        } elseif ($jefes > 1) {
            $this->errores['personas'] = 'Solo una persona puede figurar como jefe o cabeza de hogar.';
        }

        $this->datos['personas'] = $normalizadas;
    }

    /**
     * @param  array<string,mixed>  $p
     * @return array<string,mixed>
     */
    private function persona(array $p, string $i): array
    {
        $out = [];
        $base = "personas.{$i}.";

        foreach (['nombres' => 'Escriba el nombre.', 'apellidos' => 'Escriba los apellidos.'] as $campo => $mensaje) {
            $valor = $this->texto($p, $campo);
            if (mb_strlen($valor) < 2 || mb_strlen($valor) > 120) {
                $this->errores[$base.$campo] = $mensaje;
            } elseif (preg_match("/^[\p{L}\p{M}\s'.\-]+$/u", $valor) !== 1) {
                $this->errores[$base.$campo] = 'Use solo letras, espacios, apóstrofos, puntos o guiones.';
            } else {
                $out[$campo] = $valor;
            }
        }

        $tipo = $this->codigo($p, 'tipo_documento', Catalogos::TIPOS_DOCUMENTO);
        if ($tipo === null) {
            $this->errores[$base.'tipo_documento'] = 'Seleccione el tipo de documento.';
        } else {
            $out['tipo_documento'] = $tipo;
        }

        $numero = $this->texto($p, 'numero_documento');
        $out['numero_documento'] = null;

        if ($tipo !== null && Catalogos::exigeNumeroDocumento($tipo)) {
            // C6
            $patron = in_array($tipo, Catalogos::DOCUMENTOS_ALFANUMERICOS, true)
                ? '/^[A-Za-z0-9\-]{4,30}$/'
                : '/^\d{4,30}$/';

            if ($numero === '') {
                $this->errores[$base.'numero_documento'] = 'Escriba el número de documento.';
            } elseif (preg_match($patron, $numero) !== 1) {
                $this->errores[$base.'numero_documento'] = in_array($tipo, Catalogos::DOCUMENTOS_ALFANUMERICOS, true)
                    ? 'El número debe tener entre 4 y 30 caracteres, sin espacios ni símbolos.'
                    : 'El número debe tener entre 4 y 30 dígitos, sin puntos ni espacios.';
            } else {
                $out['numero_documento'] = mb_strtoupper($numero);
            }
        } elseif ($numero !== '') {
            // C5: los códigos "sin identificación" no llevan número.
            $this->errores[$base.'numero_documento'] =
                'Con el tipo de documento seleccionado no debe registrarse un número.';
        }

        // C7
        $documentoOtro = $this->texto($p, 'documento_otro');
        $out['documento_otro'] = null;
        if ($tipo === Catalogos::DOCUMENTO_OTRO) {
            if (mb_strlen($documentoOtro) < 2 || mb_strlen($documentoOtro) > 60) {
                $this->errores[$base.'documento_otro'] = 'Indique cuál es el documento.';
            } else {
                $out['documento_otro'] = $documentoOtro;
            }
        } elseif ($documentoOtro !== '') {
            $this->errores[$base.'documento_otro'] = 'Este campo solo aplica cuando el documento es "Otro".';
        }

        $parentesco = $this->codigo($p, 'parentesco', Catalogos::PARENTESCOS);
        if ($parentesco === null) {
            $this->errores[$base.'parentesco'] = 'Seleccione el parentesco con el jefe de hogar.';
        } else {
            $out['parentesco'] = $parentesco;
        }

        $genero = $this->codigo($p, 'genero', Catalogos::GENEROS);
        if ($genero === null) {
            $this->errores[$base.'genero'] = 'Seleccione la identidad de género.';
        } else {
            $out['genero'] = $genero;
        }

        $etnia = $this->codigo($p, 'pertenencia_etnica', Catalogos::ETNIAS);
        if ($etnia === null) {
            $this->errores[$base.'pertenencia_etnica'] = 'Seleccione la pertenencia étnica, o "No aplica".';
        } else {
            $out['pertenencia_etnica'] = $etnia;
        }

        // Opcional a propósito: para el tablero basta el rango etario, y exigir la
        // fecha exacta de cada integrante frena el diligenciamiento en campo.
        $out['fecha_nacimiento'] = null;
        $nacimiento = $this->fecha($p, 'fecha_nacimiento');
        if (($p['fecha_nacimiento'] ?? '') !== '' && $nacimiento === null) {
            $this->errores[$base.'fecha_nacimiento'] = 'La fecha de nacimiento no es válida.';
        } elseif ($nacimiento !== null) {
            if ($nacimiento > date('Y-m-d')) {
                $this->errores[$base.'fecha_nacimiento'] = 'La fecha de nacimiento no puede ser futura.';
            } elseif ($nacimiento < date('Y-m-d', strtotime('-120 years'))) {
                $this->errores[$base.'fecha_nacimiento'] = 'Revise la fecha de nacimiento.';
            } else {
                $out['fecha_nacimiento'] = $nacimiento;
            }
        }

        // C8: hace falta un teléfono al que llamar, y el del jefe de hogar es el
        // que el proceso de atención usa.
        $telefono = $this->telefono($p, 'telefono');
        $out['telefono'] = $telefono;
        if ($telefono === null && $parentesco === Catalogos::PARENTESCO_JEFE) {
            $this->errores[$base.'telefono'] = 'Escriba un teléfono de contacto del jefe de hogar (entre 7 y 15 dígitos).';
        } elseif ($telefono === null && $this->texto($p, 'telefono') !== '') {
            $this->errores[$base.'telefono'] = 'El teléfono debe tener entre 7 y 15 dígitos.';
        }

        return $out;
    }

    /** @param array<string,mixed> $e */
    private function agropecuario(array $e): void
    {
        $tiene = ($e['tiene_afectacion_agro'] ?? false) === true;
        $lista = is_array($e['agropecuario'] ?? null) ? array_values($e['agropecuario']) : [];

        // C9
        if (! $tiene) {
            if ($lista !== []) {
                $this->errores['agropecuario'] = 'Indicó que no hubo afectación de cultivos o animales.';
            }
            $this->datos['agropecuario'] = [];

            return;
        }

        if ($lista === []) {
            $this->errores['agropecuario'] = 'Registre al menos un cultivo o especie afectada, o indique que no hubo afectación.';
            $this->datos['agropecuario'] = [];

            return;
        }

        if (count($lista) > Catalogos::MAX_AGROPECUARIO) {
            $this->errores['agropecuario'] = 'El formato oficial admite hasta '
                .Catalogos::MAX_AGROPECUARIO.' renglones agropecuarios.';

            return;
        }

        $normalizados = [];

        foreach ($lista as $i => $cruda) {
            if (! is_array($cruda)) {
                continue;
            }

            $base = "agropecuario.{$i}.";
            $fila = ['orden' => $i + 1];

            $cultivo = $this->texto($cruda, 'tipo_cultivo');
            $especie = $this->texto($cruda, 'especie_pecuaria');

            if ($cultivo === '' && $especie === '') {
                $this->errores["agropecuario.{$i}"] = 'Escriba el cultivo o la especie afectada, o elimine este renglón.';

                continue;
            }

            $fila['tipo_cultivo'] = null;
            $fila['unidad_medida'] = null;
            $fila['area_cantidad'] = null;
            $fila['especie_pecuaria'] = null;
            $fila['cantidad_unidades'] = null;

            // C10
            if ($cultivo !== '') {
                if (mb_strlen($cultivo) > 120) {
                    $this->errores[$base.'tipo_cultivo'] = 'El nombre del cultivo es demasiado largo.';
                } else {
                    $fila['tipo_cultivo'] = $cultivo;
                }

                $unidad = $this->texto($cruda, 'unidad_medida');
                if (! isset(Catalogos::UNIDADES_MEDIDA[$unidad])) {
                    $this->errores[$base.'unidad_medida'] = 'Seleccione la unidad de medida del área afectada.';
                } else {
                    $fila['unidad_medida'] = $unidad;
                }

                $area = $cruda['area_cantidad'] ?? null;
                if (! is_numeric($area) || (float) $area <= 0 || (float) $area > 99999999.99) {
                    $this->errores[$base.'area_cantidad'] = 'Escriba el área afectada como un número mayor que cero.';
                } else {
                    $fila['area_cantidad'] = round((float) $area, 2);
                }
            }

            // C11
            if ($especie !== '') {
                if (mb_strlen($especie) > 120) {
                    $this->errores[$base.'especie_pecuaria'] = 'El nombre de la especie es demasiado largo.';
                } else {
                    $fila['especie_pecuaria'] = $especie;
                }

                $cantidad = $cruda['cantidad_unidades'] ?? null;
                if (! is_numeric($cantidad) || (int) $cantidad < 1 || (int) $cantidad > 1000000) {
                    $this->errores[$base.'cantidad_unidades'] = 'Escriba cuántos animales resultaron afectados.';
                } else {
                    $fila['cantidad_unidades'] = (int) $cantidad;
                }
            }

            $normalizados[] = $fila;
        }

        $this->datos['agropecuario'] = $normalizados;
    }

    /** @param array<string,mixed> $e */
    private function cierre(array $e): void
    {
        $observaciones = $this->texto($e, 'observaciones', true);
        if (mb_strlen($observaciones) > 2000) {
            $this->errores['observaciones'] = 'Las observaciones no pueden superar los 2000 caracteres.';
        } else {
            $this->datos['observaciones'] = $observaciones === '' ? null : $observaciones;
        }

        $telefono = $this->telefono($e, 'contacto_telefono');
        if ($telefono === null) {
            $this->errores['contacto_telefono'] = 'Escriba un teléfono de contacto de entre 7 y 15 dígitos.';
        } else {
            $this->datos['contacto_telefono'] = $telefono;
        }

        $correo = $this->texto($e, 'contacto_correo');
        $this->datos['contacto_correo'] = null;
        if ($correo !== '') {
            if (filter_var($correo, FILTER_VALIDATE_EMAIL) === false || mb_strlen($correo) > 180) {
                $this->errores['contacto_correo'] = 'El correo electrónico no es válido.';
            } else {
                $this->datos['contacto_correo'] = mb_strtolower($correo);
            }
        }

        // El consentimiento es la base legal del tratamiento: sin él no hay ficha
        // que guardar, así que se valida como cualquier campo obligatorio.
        //
        // Es UNA sola casilla, pero su texto tiene que decirlo todo. La Ley 1581
        // exige que la autorización sea informada, y para los datos sensibles
        // —identidad de género y pertenencia étnica— exige además que se advierta
        // que responder es voluntario. Reducir el número de casillas no puede
        // reducir lo que se informa: por eso el aviso cambia de versión, y esa
        // versión queda guardada con cada ficha. Ante un reclamo, lo que prueba
        // qué aceptó el ciudadano es ese número, no lo que hoy diga la pantalla.
        if (($e['autoriza_tratamiento'] ?? false) !== true) {
            $this->errores['autoriza_tratamiento'] =
                'Debe confirmar la declaración y la autorización del ciudadano para poder registrar la ficha.';
        }

        // Se siguen guardando por separado aunque la casilla sea una: la ley
        // distingue los datos sensibles del resto, y fundir las dos columnas
        // impediría responder más adelante qué autorizó exactamente el ciudadano.
        $this->datos['autoriza_datos'] = 1;
        $this->datos['autoriza_sensibles'] = 1;

        // La ficha dice qué aviso se le mostró al ciudadano. Se acepta solo si es
        // uno que existió de verdad; si no viene ninguno, es de antes de que se
        // enviara y se asume el vigente.
        $aviso = $e['aviso_version'] ?? null;
        $this->datos['autorizacion_texto'] = is_string($aviso)
            && in_array($aviso, Catalogos::AVISOS_CONOCIDOS, true)
                ? $aviso
                : Catalogos::AVISO_VERSION;
        $this->datos['autorizacion_en'] = date('Y-m-d H:i:s');
    }

    // ── Ayudas ───────────────────────────────────────────────────────────────

    /**
     * Recorta y quita caracteres de control. No escapa HTML: el valor se guarda
     * tal como lo escribió el ciudadano y quien lo muestre es responsable de
     * escaparlo (Svelte lo hace por omisión). Escapar aquí guardaría `&amp;` en
     * la base y rompería las exportaciones.
     *
     * @param array<string,mixed> $origen
     */
    private function texto(array $origen, string $clave, bool $multilinea = false): string
    {
        $valor = $origen[$clave] ?? '';
        if (! is_scalar($valor)) {
            return '';
        }

        $valor = (string) $valor;
        $patron = $multilinea ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u' : '/[\x00-\x1F\x7F]/u';
        $valor = preg_replace($patron, '', $valor) ?? $valor;

        return trim($valor);
    }

    /**
     * @param  array<string,mixed>  $origen
     * @param  array<int,string>    $catalogo
     */
    private function codigo(array $origen, string $clave, array $catalogo): ?int
    {
        $valor = $origen[$clave] ?? null;
        if (! is_numeric($valor)) {
            return null;
        }

        $codigo = (int) $valor;

        return isset($catalogo[$codigo]) ? $codigo : null;
    }

    /**
     * Valida contra un catálogo de clave textual y guarda el valor en `datos`.
     *
     * @param  array<string,mixed>  $origen
     * @param  array<string,mixed>  $catalogo
     */
    private function opcion(array $origen, string $clave, array $catalogo, string $mensaje): ?string
    {
        $valor = $this->texto($origen, $clave);

        if (! isset($catalogo[$valor])) {
            $this->errores[$clave] = $mensaje;

            return null;
        }

        $this->datos[$clave] = $valor;

        return $valor;
    }

    /**
     * Fecha en formato Y-m-d que además exista de verdad: checkdate descarta
     * cosas como 2026-02-31, que strtotime aceptaría corriéndola a marzo.
     *
     * @param array<string,mixed> $origen
     */
    private function fecha(array $origen, string $clave): ?string
    {
        $valor = $this->texto($origen, $clave);
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $valor, $m) !== 1) {
            return null;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $valor : null;
    }

    /**
     * Deja solo dígitos y exige entre 7 y 15. Se aceptan espacios, guiones,
     * paréntesis y prefijo internacional porque la gente los escribe.
     *
     * @param array<string,mixed> $origen
     */
    private function telefono(array $origen, string $clave): ?string
    {
        $valor = $this->texto($origen, $clave);
        if ($valor === '') {
            return null;
        }

        $digitos = preg_replace('/\D+/', '', $valor) ?? '';

        return strlen($digitos) >= 7 && strlen($digitos) <= 15 ? $digitos : null;
    }
}
