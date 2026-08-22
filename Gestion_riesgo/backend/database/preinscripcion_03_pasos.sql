-- Sistema de Gestión del Riesgo — Jamundí
-- Pre-inscripción por pasos: zona de la vivienda y señales de daño marcadas.
--
-- Dos cosas que el formulario de una sola página no preguntaba:
--
--  • `zona` — urbana o rural. Antes se deducía de si venía corregimiento, y esa
--    deducción es falsa: hay quien vive en zona rural y no sabe en qué
--    corregimiento queda su vereda, y su solicitud entraba como urbana.
--  • Las señales de daño, en su propia tabla porque son varias por solicitud.
--
-- Nada existente se modifica salvo la columna nueva, que queda NULL en todo lo
-- que ya está guardado. NULL aquí significa «se registró antes de que se
-- preguntara», que es distinto de urbana: no se rellena con un valor inventado.

SET NAMES utf8mb4;

SET @falta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'preinscripciones'
     AND COLUMN_NAME = 'zona'
);

SET @sql := IF(@falta,
  'ALTER TABLE preinscripciones
     ADD COLUMN zona ENUM(''URBANA'',''RURAL'') NULL DEFAULT NULL AFTER direccion',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Una fila por señal marcada.
--
-- `etiqueta` guarda el texto tal como se le mostró a la persona, igual que hace
-- el video con el nombre de su categoría: si mañana se reescribe un criterio en
-- `Senales::CATALOGO`, el expediente tiene que seguir diciendo qué fue lo que
-- se marcó, no lo que hoy diría la pantalla.
CREATE TABLE IF NOT EXISTS preinscripcion_senales (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  preinscripcion_id INT UNSIGNED    NOT NULL,
  codigo            VARCHAR(40)     NOT NULL,
  etiqueta          VARCHAR(160)    NOT NULL,
  creado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- La misma señal dos veces en la misma solicitud no significa nada, y sin
  -- esto un envío repetido las duplicaría.
  UNIQUE KEY uq_preinscripcion_senal (preinscripcion_id, codigo),
  CONSTRAINT fk_preinscripcion_senales FOREIGN KEY (preinscripcion_id)
    REFERENCES preinscripciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
