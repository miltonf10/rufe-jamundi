<?php

/**
 * Copiar como `config.php` y completar. `config.php` NO se versiona.
 *
 * Vive fuera de public/ para que el servidor web no lo pueda servir aunque
 * PHP deje de interpretarse por un error de configuración.
 */

return [
    'app' => [
        'nombre'   => 'Sistema de Gestión del Riesgo — Jamundí',
        'version'  => '1.0.0',
        'entorno'  => 'produccion',   // 'local' habilita mensajes de error detallados
        'zona'     => 'America/Bogota',
    ],

    // Los nombres reales de la base y del usuario van en config.php, que no se
    // versiona: este archivo es público y no debe revelar a qué apunta el
    // sistema en producción.
    'db' => [
        'host'     => 'localhost',
        'puerto'   => 3306,
        'nombre'   => 'CUENTA_sgr',
        'usuario'  => 'CUENTA_sgr',
        'password' => '',
        'charset'  => 'utf8mb4',
    ],

    // Orígenes autorizados para CORS. El frontend es estático y se sirve desde
    // otro host, así que sin esto el navegador bloquea toda llamada a la API.
    'cors' => [
        // En producción la API se sirve bajo /api del mismo dominio que la
        // aplicación, así que no hay petición entre orígenes y esta lista no
        // llega a usarse. Solo hace falta en desarrollo, donde el frontend
        // (5173) y la API (8000) sí son orígenes distintos.
        'origenes' => [
            'http://localhost:5173',
        ],
    ],

    'auth' => [
        // Duración de la sesión en horas.
        //
        // 24 y no 12 para que cubra una jornada de campo completa: un censador
        // que sale a las 7 de la mañana no debería tener que volver a entrar a
        // media tarde con el teléfono sin señal. No se amplía más: el token vive
        // en un teléfono que puede perderse, y las fichas encoladas no dependen
        // de que siga vigente — el envío diferido toma el token del momento de
        // enviar, no el de cuando se guardó la ficha.
        'duracion_horas' => 24,
    ],

    // Evidencias del formulario RUFE. Ruta ABSOLUTA y FUERA del document root:
    // si Apache no puede alcanzarla, da igual que alguien logre subir un archivo
    // ejecutable, porque no existe URL que lo dispare.
    //
    // En cPanel, si el sitio está en /home1/CUENTA/grj.oticjamundi.com, una ruta
    // correcta es /home1/CUENTA/sgr_almacen (hermana, no hija).
    'almacenamiento' => [
        'ruta' => '',
    ],

    'rufe' => [
        // Sal para derivar el hash de la IP del ciudadano y las claves del
        // control de tasa. Debe ser larga y aleatoria, y no debe cambiar: si
        // cambia, los contadores de tasa en curso se reinician y los reportes
        // anteriores dejan de poder correlacionarse por origen.
        //
        // Generar con:  php -r "echo bin2hex(random_bytes(32));"
        'sal' => '',
    ],

    'geocodificacion' => [
        // Clave de la API de Geocoding de Google. VACÍA por omisión: mientras lo
        // esté, el sistema ubica las direcciones solo con OpenStreetMap, que es
        // gratuito y no pide cuenta.
        //
        // Poner una clave aquí hace que las direcciones que OpenStreetMap no
        // logre ubicar se reintenten con Google, que acierta más con direcciones
        // desordenadas pero cobra por consulta. Nunca viaja al navegador: la
        // geocodificación ocurre entera en el servidor.
        'google_key' => '',
    ],

    'github' => [
        // Token de solo lectura. Se usa desde el servidor para que nunca viaje
        // al navegador. Un repositorio público funciona sin token, pero con él
        // el límite de peticiones sube de 60 a 5000 por hora.
        'token' => '',

        // El sistema se desarrolla en dos frentes y cada uno vive en su propia
        // rama. Se leen ambas y se funden en una sola línea de tiempo: con una
        // sola, media historia del sistema quedaría invisible.
        'fuentes' => [
            [
                'owner' => 'miltonf10',
                'repo' => 'rufe-jamundi',
                'branch' => 'main',
                'etiqueta' => 'Tablero RUFE',
            ],
            [
                'owner' => 'miltonf10',
                'repo' => 'rufe-jamundi',
                'branch' => 'sistema-gestion-riesgo',
                'etiqueta' => 'Plataforma',
            ],
        ],
    ],

    // Actualización del sistema desde GitHub (Acerca de → Actualizaciones).
    //
    // Viene deshabilitada a propósito: darle a un sitio en producción la
    // capacidad de sobrescribirse a sí mismo es algo que se enciende a
    // conciencia, no algo que quede puesto por venir en la plantilla.
    'actualizaciones' => [
        'habilitado' => false,

        'owner' => 'miltonf10',
        'repo'  => 'rufe-jamundi',
        'rama'  => 'sistema-gestion-riesgo',

        // Rutas ABSOLUTAS en el servidor. Vacías = ese destino se omite.
        'raiz_api'      => '',   // .../grj.oticjamundi.com/api
        'raiz_frontend' => '',   // .../grj.oticjamundi.com

        // Respaldos previos a sobrescribir. FUERA del document root, y con
        // espacio: se guarda una copia completa por despliegue.
        'respaldos' => '',       // .../sgr_respaldos

        // Tras escribir se comprueba que el sitio siga en pie; si no responde,
        // se restaura el respaldo automáticamente. Vacío = no se comprueba.
        'url_salud'    => 'https://grj.oticjamundi.com/api/health',
        'url_frontend' => 'https://grj.oticjamundi.com/',

        // Pausa entre archivos, en milisegundos. En hosting compartido, escribir
        // cientos de archivos de golpe dispara los límites de CPU y el proceso
        // muere a mitad del despliegue.
        'pausa_ms' => 40,
    ],

    // Clave de un solo uso para ejecutar bin/install.php. Vaciar tras instalar.
    'install_key' => '',
];
