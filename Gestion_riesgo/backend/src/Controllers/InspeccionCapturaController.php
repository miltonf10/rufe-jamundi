<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpError;
use App\Core\Request;
use App\Core\Response;
use App\Inspeccion\Catalogos;
use App\Inspeccion\NivelDano;
use App\Inspeccion\Numero;
use App\Inspeccion\Validador;
use App\Rufe\Archivos;
use Throwable;

/**
 * Captura del formato de inspección de viviendas.
 *
 * Es hermano de `RufeCapturaController` y repite sus decisiones donde se
 * ganaron con dolor: el `envio_id` que hace seguro reintentar sin señal, la
 * transacción que impide dejar media ficha escrita y la adopción de las fotos
 * que se subieron antes del envío.
 *
 * No repite el control de tasa ni la trampa para robots: aquel formulario llegó
 * a ser público y esto nunca lo será — lo llena un profesional con sesión
 * iniciada.
 */
final class InspeccionCapturaController
{
    public function catalogos(Request $req): void
    {
        Response::ok(Catalogos::paraApi());
    }

    /**
     * Registra una inspección.
     *
     * El combo de materiales NO se toma de lo que mande el navegador: lo calcula
     * el validador a partir de la evaluación técnica. De ese número depende
     * cuántos materiales recibe una familia.
     */
    public function crear(Request $req): void
    {
        // Reintento de un envío que ya entró: la inspección llegó pero la
        // respuesta se perdió por falta de cobertura, y el teléfono lo vuelve a
        // mandar. Se devuelve el número original en vez de abrir dos
        // expedientes de la misma vivienda.
        $envioId = $this->envioId($req);

        if ($envioId !== null) {
            $previo = Db::first(
                'SELECT numero, creado_en FROM inspeccion_viviendas WHERE envio_id = :e',
                ['e' => $envioId]
            );

            if ($previo !== null) {
                Response::ok([
                    'numero' => $previo['numero'],
                    'recibido_en' => date('c', strtotime((string) $previo['creado_en'])),
                    'reintento' => true,
                ]);

                return;
            }
        }

        ['errores' => $errores, 'datos' => $datos] = Validador::inspeccion($req->todo());

        if ($errores !== []) {
            throw HttpError::validacion($errores, 'Revise los datos marcados y vuelva a intentarlo.');
        }

        $actor = Auth::exigirUsuario($req);
        $huella = Numero::huella(
            $datos['fecha_evaluacion'],
            $this->direccionDe($datos),
            $datos['propietario_documento']
        );

        $carga = $req->texto('carga');

        // La solicitud ciudadana de la que nació esta inspección, si nació de
        // una. Se lee de la petición pero NO se cree a ciegas: se comprueba que
        // exista antes de marcarla como atendida.
        $preinscripcion = (int) $req->texto('preinscripcion_id');
        if ($preinscripcion > 0) {
            $existe = Db::first(
                'SELECT id FROM preinscripciones WHERE id = :i',
                ['i' => $preinscripcion]
            );

            if ($existe === null) {
                $preinscripcion = 0;
            }
        }

        $numero = $this->guardar(
            $datos,
            $huella,
            $envioId,
            $actor,
            $carga === '' ? null : $carga,
            $preinscripcion > 0 ? $preinscripcion : null
        );

        Auditoria::registrar(
            $req,
            'inspeccion.registrada',
            $actor,
            'inspeccion_viviendas',
            $numero,
            $datos['cumple_requisitos']
                ? sprintf('%s (%s)', $datos['combo'] ?? 'sin combo', $datos['combo_nivel'] ?? 'sin daño estructural')
                : 'no cumple requisitos'
        );

        Response::json([
            'ok' => true,
            'data' => [
                'numero' => $numero,
                'recibido_en' => date('c'),
                // El combo viaja de vuelta: el profesional acaba de verlo en
                // pantalla calculado por el navegador y tiene derecho a saber si
                // el servidor concluyó lo mismo.
                'combo' => $datos['combo'] ?? null,
                'combo_motivo' => $datos['combo_motivo'] ?? null,
            ],
        ], 201);
    }

    /** ¿Ya hay una inspección de esta vivienda? Avisa, no impide. */
    public function duplicados(Request $req): void
    {
        $documento = preg_replace('/\D+/', '', $req->query('documento') ?? '') ?? '';

        if (strlen($documento) < 5) {
            Response::ok(['inspecciones' => []]);

            return;
        }

        $filas = Db::all(
            'SELECT numero, fecha_evaluacion, combo, cumple_requisitos
               FROM inspeccion_viviendas
              WHERE propietario_documento = :d
              ORDER BY fecha_evaluacion DESC
              LIMIT 5',
            ['d' => $documento]
        );

        Response::ok(['inspecciones' => $filas]);
    }

    // ── Apoyo ────────────────────────────────────────────────────────────────

    private function envioId(Request $req): ?string
    {
        $valor = $req->texto('envio_id');

        return preg_match('/^[0-9a-f-]{36}$/i', $valor) === 1 ? $valor : null;
    }

    /** @param array<string,mixed> $datos */
    private function direccionDe(array $datos): string
    {
        // Una vivienda rural no tiene dirección de cabecera; se identifica por
        // vereda y corregimiento. La huella tiene que servir para las dos.
        return trim(implode(' ', array_filter([
            $datos['direccion_cabecera'] ?? '',
            $datos['vereda'] ?? '',
            $datos['corregimiento'] ?? '',
        ])));
    }

    /**
     * @param  array<string,mixed>  $datos
     * @param  array<string,mixed>  $actor
     */
    private function guardar(
        array $datos,
        string $huella,
        ?string $envioId,
        array $actor,
        ?string $carga,
        ?int $preinscripcionId = null
    ): string {
        $pdo = Db::conn();
        $pdo->beginTransaction();

        try {
            $numero = Numero::generar();
            $infra = $datos['infraestructura'] ?? [];
            $requisitos = $datos['requisitos'] ?? [];

            Db::exec(
                'INSERT INTO inspeccion_viviendas
                    (numero, envio_id, rufe_reporte_id, estado, fecha_evaluacion,
                     profesional_nombre, profesional_tarjeta, profesional_profesion,
                     profesional_documento, profesional_documento_de, profesional_telefono,
                     profesional_direccion, propietario_nombres, propietario_documento,
                     propietario_documento_de, propietario_telefono, propietario_direccion,
                     departamento, municipio, direccion_cabecera, corregimiento, vereda,
                     latitud, longitud, precision_m,
                     req_no_beneficiario, req_propietario, req_no_alto_riesgo, cumple_requisitos,
                     evento, evento_otro, sistema_constructivo,
                     material_muros, material_pisos, material_estructura, material_cubierta,
                     colapso_total, requiere_evacuacion,
                     combo, combo_nivel, combo_motivo, kit_cubierta, materiales_json,
                     informante_nombre, informante_documento, informante_parentesco, informante_telefono,
                     acta_modalidad, acta_nombre, acta_documento, acta_telefono,
                     aprobacion_profesional, aprobacion_coordinador, huella, creado_por_usuario_id)
                 VALUES
                    (:numero, :envio_id, :rufe_reporte_id, :estado, :fecha_evaluacion,
                     :profesional_nombre, :profesional_tarjeta, :profesional_profesion,
                     :profesional_documento, :profesional_documento_de, :profesional_telefono,
                     :profesional_direccion, :propietario_nombres, :propietario_documento,
                     :propietario_documento_de, :propietario_telefono, :propietario_direccion,
                     :departamento, :municipio, :direccion_cabecera, :corregimiento, :vereda,
                     :latitud, :longitud, :precision_m,
                     :req_no_beneficiario, :req_propietario, :req_no_alto_riesgo, :cumple_requisitos,
                     :evento, :evento_otro, :sistema_constructivo,
                     :material_muros, :material_pisos, :material_estructura, :material_cubierta,
                     :colapso_total, :requiere_evacuacion,
                     :combo, :combo_nivel, :combo_motivo, :kit_cubierta, :materiales_json,
                     :informante_nombre, :informante_documento, :informante_parentesco, :informante_telefono,
                     :acta_modalidad, :acta_nombre, :acta_documento, :acta_telefono,
                     :aprobacion_profesional, :aprobacion_coordinador, :huella, :creado_por)',
                [
                    'numero' => $numero,
                    'envio_id' => $envioId,
                    'rufe_reporte_id' => $datos['rufe_reporte_id'] ?? null,
                    'estado' => 'RECIBIDA',
                    'fecha_evaluacion' => $datos['fecha_evaluacion'],
                    'profesional_nombre' => $datos['profesional_nombre'],
                    'profesional_tarjeta' => $datos['profesional_tarjeta'],
                    'profesional_profesion' => $datos['profesional_profesion'],
                    'profesional_documento' => $datos['profesional_documento'],
                    'profesional_documento_de' => $datos['profesional_documento_de'] ?? null,
                    'profesional_telefono' => $datos['profesional_telefono'],
                    'profesional_direccion' => $datos['profesional_direccion'] ?? null,
                    'propietario_nombres' => $datos['propietario_nombres'],
                    'propietario_documento' => $datos['propietario_documento'],
                    'propietario_documento_de' => $datos['propietario_documento_de'] ?? null,
                    'propietario_telefono' => $datos['propietario_telefono'] ?? null,
                    'propietario_direccion' => $datos['propietario_direccion'] ?? null,
                    'departamento' => $datos['departamento'],
                    'municipio' => $datos['municipio'],
                    'direccion_cabecera' => $datos['direccion_cabecera'] ?: null,
                    'corregimiento' => $datos['corregimiento'] ?: null,
                    'vereda' => $datos['vereda'] ?: null,
                    'latitud' => $datos['latitud'] ?? null,
                    'longitud' => $datos['longitud'] ?? null,
                    'precision_m' => $datos['precision_m'] ?? null,
                    'req_no_beneficiario' => $this->tiny($requisitos['NO_BENEFICIARIO'] ?? null),
                    'req_propietario' => $this->tiny($requisitos['PROPIETARIO'] ?? null),
                    'req_no_alto_riesgo' => $this->tiny($requisitos['NO_ALTO_RIESGO'] ?? null),
                    'cumple_requisitos' => $datos['cumple_requisitos'] ? 1 : 0,
                    'evento' => $datos['evento'] ?? null,
                    'evento_otro' => $datos['evento_otro'] ?? null,
                    'sistema_constructivo' => $datos['sistema_constructivo'] ?? null,
                    'material_muros' => $infra['MUROS_DIVISORIOS'] ?? null,
                    'material_pisos' => $infra['PISOS'] ?? null,
                    'material_estructura' => $infra['ESTRUCTURA'] ?? null,
                    'material_cubierta' => $infra['CUBIERTA'] ?? null,
                    'colapso_total' => ($datos['colapso_total'] ?? false) ? 1 : 0,
                    'requiere_evacuacion' => $this->tiny($datos['requiere_evacuacion'] ?? null),
                    'combo' => $datos['combo'] ?? null,
                    'combo_nivel' => $datos['combo_nivel'] ?? null,
                    'combo_motivo' => $datos['combo_motivo'] ?? null,
                    'kit_cubierta' => $datos['kit_cubierta'] ?? null,
                    // La lista se guarda resuelta: dentro de un año la norma
                    // puede haber cambiado y el expediente tiene que seguir
                    // diciendo qué se entregó.
                    'materiales_json' => isset($datos['materiales'])
                        ? json_encode($datos['materiales'], JSON_UNESCAPED_UNICODE)
                        : null,
                    'informante_nombre' => $datos['informante_nombre'] ?? null,
                    'informante_documento' => $datos['informante_documento'] ?? null,
                    'informante_parentesco' => $datos['informante_parentesco'] ?? null,
                    'informante_telefono' => $datos['informante_telefono'] ?? null,
                    'acta_modalidad' => $datos['acta_modalidad'] ?? null,
                    'acta_nombre' => $datos['acta_nombre'] ?? null,
                    'acta_documento' => $datos['acta_documento'] ?? null,
                    'acta_telefono' => $datos['acta_telefono'] ?? null,
                    // La columna es NOT NULL y viene de cuando el numeral 9 se
                    // diligenciaba en campo. Las fichas nuevas entran con cadena
                    // vacía; las ya levantadas conservan lo que se escribió.
                    'aprobacion_profesional' => $datos['aprobacion_profesional'] ?? '',
                    'aprobacion_coordinador' => $datos['aprobacion_coordinador'] ?? null,
                    'huella' => $huella,
                    'creado_por' => $actor['id'],
                ]
            );

            $id = Db::lastId();

            // La tabla del 5.4, una fila por elemento, en el orden del formato.
            $sistema = $datos['sistema_constructivo'] ?? null;

            if ($sistema !== null) {
                $orden = 0;

                foreach (NivelDano::elementos($sistema) as $elemento) {
                    if (! isset($datos['danos'][$elemento])) {
                        continue;
                    }

                    $orden++;
                    Db::exec(
                        'INSERT INTO inspeccion_danos (inspeccion_id, elemento, afectado, nivel, orden)
                         VALUES (:i, :e, :a, :n, :o)',
                        [
                            'i' => $id,
                            'e' => $elemento,
                            'a' => $datos['danos'][$elemento]['afectado'] ? 1 : 0,
                            'n' => $datos['danos'][$elemento]['nivel'],
                            'o' => $orden,
                        ]
                    );
                }
            }

            Db::exec(
                'INSERT INTO inspeccion_historial (inspeccion_id, estado, nota, usuario_id, usuario_email)
                 VALUES (:i, :e, :n, :u, :m)',
                [
                    'i' => $id,
                    'e' => 'RECIBIDA',
                    'n' => 'Inspección registrada en campo.',
                    'u' => $actor['id'],
                    'm' => $actor['email'],
                ]
            );

            if ($carga !== null) {
                Archivos::adoptarInspeccion(Archivos::hashDeCarga($carga), $id);
            }

            // La solicitud queda atendida y apuntando a su inspección. Se marca
            // AQUÍ, dentro de la misma transacción, y no con una llamada aparte
            // desde el navegador: si se hiciera fuera, una solicitud podría
            // quedar marcada como convertida sin que existiera la ficha.
            if ($preinscripcionId !== null) {
                Db::exec(
                    'UPDATE preinscripciones
                        SET estado = :e, inspeccion_id = :ins
                      WHERE id = :i',
                    ['e' => 'CONVERTIDA', 'ins' => $id, 'i' => $preinscripcionId]
                );

                // El video ya cumplió su función: sirvió para decidir la visita.
                // Conservarlo llenaría el disco de un hosting compartido.
                \App\Preinscripcion\Videos::purgarDeSolicitud($preinscripcionId);

                Db::exec(
                    'INSERT INTO preinscripcion_historial
                        (preinscripcion_id, estado, nota, usuario_id, usuario_email)
                     VALUES (:i, :e, :n, :u, :m)',
                    [
                        'i' => $preinscripcionId,
                        'e' => 'CONVERTIDA',
                        'n' => 'Se levantó la inspección '.$numero.'.',
                        'u' => $actor['id'],
                        'm' => $actor['email'],
                    ]
                );
            }

            $pdo->commit();

            return $numero;
        } catch (Throwable $e) {
            $pdo->rollBack();

            throw $e;
        }
    }

    private function tiny(?bool $valor): ?int
    {
        return $valor === null ? null : ($valor ? 1 : 0);
    }
}
