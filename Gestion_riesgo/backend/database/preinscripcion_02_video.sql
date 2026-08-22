-- Sistema de Gestión del Riesgo — Jamundí
-- Catálogo de categorías de video, administrable, y los videos que se graban.
--
-- Las categorías NO se escriben en el código. El administrador las crea, edita,
-- reordena y desactiva desde su panel, sin que nadie toque un archivo: qué hay
-- que grabar de una vivienda depende del evento y de lo que el Consejo
-- Territorial necesite ver, y eso cambia entre una emergencia y la siguiente.
--
-- Dos decisiones que explican la forma de estas tablas:
--
-- 1. `categoria_nombre` se copia en cada video al momento de grabarlo. Si el
--    administrador renombra «Cocina» a «Área de cocina» seis meses después, el
--    expediente tiene que seguir diciendo qué se grabó entonces, no lo que hoy
--    se llame esa categoría.
--
-- 2. Una categoría con videos asociados NO se puede borrar, solo desactivar. Es
--    la misma regla que protege las migraciones de este proyecto: lo que tiene
--    datos detrás no desaparece.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS categorias_video (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(80)     NOT NULL COMMENT 'Ej.: Fachada, Cocina, Cubierta',
  instruccion     VARCHAR(300)    NULL DEFAULT NULL COMMENT 'Lo que se le dice al ciudadano: «grabe recorriendo las cuatro paredes»',
  orden           SMALLINT        NOT NULL DEFAULT 0,
  obligatoria     TINYINT(1)      NOT NULL DEFAULT 1,
  -- Techos de grabación, por categoría. El valor por omisión sale de lo que
  -- aguanta una conexión rural: 30 segundos a 480p son unos 3 MB.
  segundos_min    SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  segundos_max    SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  activa          TINYINT(1)      NOT NULL DEFAULT 1,
  creada_por      INT UNSIGNED    NULL DEFAULT NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_categorias_video_orden (activa, orden),
  CONSTRAINT fk_categorias_video_usuario FOREIGN KEY (creada_por)
    REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quién cambió qué en el catálogo. Sin esto, un video de hace tres meses
-- grabado con una instrucción que ya nadie recuerda no se puede interpretar.
CREATE TABLE IF NOT EXISTS categorias_video_historial (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  categoria_id   INT UNSIGNED    NOT NULL,
  accion         ENUM('creada','editada','reordenada','desactivada','reactivada') NOT NULL,
  antes          JSON            NULL DEFAULT NULL,
  despues        JSON            NULL DEFAULT NULL,
  usuario_id     INT UNSIGNED    NULL DEFAULT NULL,
  usuario_email  VARCHAR(180)    NULL DEFAULT NULL,
  creado_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_categorias_video_historial (categoria_id),
  CONSTRAINT fk_categorias_video_historial FOREIGN KEY (categoria_id)
    REFERENCES categorias_video (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los videos van en su propia tabla y no en `rufe_evidencias`: se suben por
-- trozos, pesan cien veces más que una foto y se borran cuando la solicitud se
-- decide. Meterlos en la tabla de evidencias mezclaría dos ciclos de vida
-- distintos en las mismas consultas.
CREATE TABLE IF NOT EXISTS preinscripcion_videos (
  id                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  preinscripcion_id INT UNSIGNED    NULL DEFAULT NULL,
  -- Mientras se está grabando, el video pertenece a una carga, no a una
  -- solicitud: es el mismo mecanismo que las fotos y por el mismo motivo.
  carga_hash        CHAR(64)        NOT NULL,
  categoria_id      INT UNSIGNED    NULL DEFAULT NULL,
  categoria_nombre  VARCHAR(80)     NOT NULL COMMENT 'Copia al momento de grabar: la categoría puede renombrarse después',
  nombre_guardado   VARCHAR(80)     NOT NULL,
  ruta_relativa     VARCHAR(300)    NOT NULL,
  mime              VARCHAR(60)     NOT NULL,
  extension         VARCHAR(10)     NOT NULL,
  tamano_bytes      INT UNSIGNED    NOT NULL DEFAULT 0,
  segundos          SMALLINT UNSIGNED NULL DEFAULT NULL,
  -- Los trozos llegan de uno en uno; el video no existe hasta que están todos.
  trozos_esperados  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  trozos_recibidos  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  completo          TINYINT(1)      NOT NULL DEFAULT 0,
  expira_en         DATETIME        NOT NULL,
  creado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_preinscripcion_videos_carga (carga_hash),
  KEY idx_preinscripcion_videos_duena (preinscripcion_id),
  KEY idx_preinscripcion_videos_expira (expira_en),
  CONSTRAINT fk_preinscripcion_videos_duena FOREIGN KEY (preinscripcion_id)
    REFERENCES preinscripciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_preinscripcion_videos_categoria FOREIGN KEY (categoria_id)
    REFERENCES categorias_video (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
