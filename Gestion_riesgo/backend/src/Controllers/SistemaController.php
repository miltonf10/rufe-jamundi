<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auditoria;
use App\Core\Auth;
use App\Core\Request;
use App\Core\Response;
use App\Sistema\Actualizador;

/**
 * Actualización del sistema desde GitHub.
 *
 * Solo Administrador: aplicar una versión nueva reescribe el código del sitio y
 * corre migraciones. Es la acción de mayor privilegio del sistema, por encima
 * incluso de gestionar usuarios.
 */
final class SistemaController
{
    public function estado(Request $req): void
    {
        Response::ok((new Actualizador)->estado());
    }

    public function actualizar(Request $req): void
    {
        $actor = Auth::exigirUsuario($req);

        // Correr migraciones es lo correcto por omisión: el código nuevo suele
        // dar por hecho el esquema nuevo, y saltárselas deja el sitio en pie
        // pero roto. Se puede desactivar para separar los dos pasos cuando un
        // cambio de esquema es delicado.
        $migrar = $req->input('migrar', true) !== false;

        Auditoria::registrar($req, 'sistema.actualizacion_iniciada', $actor, 'despliegues', null, null);

        $resultado = (new Actualizador)->aplicar($actor, $migrar);

        $estados = array_map(
            static fn (array $r): string => $r['destino'].'='.$r['estado'],
            $resultado['resultados']
        );

        Auditoria::registrar(
            $req,
            'sistema.actualizacion_aplicada',
            $actor,
            'despliegues',
            $resultado['commit']['corto'],
            implode(' ', $estados)
        );

        Response::ok($resultado);
    }
}
