-- Sistema de Gestión del Riesgo — Jamundí
-- Cambios sobre el módulo RUFE posteriores a rufe.sql.
--
-- rufe.sql ya crea las dos columnas para una instalación nueva; este archivo las
-- añade a una instalación que se creó antes. Ejecutarlo sobre una base al día no
-- hace nada.
--
-- MySQL 8 no admite ALTER TABLE ... ADD COLUMN IF NOT EXISTS, así que se
-- consulta information_schema y se arma la sentencia solo si falta. No se usa un
-- procedimiento almacenado porque el migrador parte los archivos por ';' y un
-- BEGIN ... END quedaría cortado por la mitad.

SET NAMES utf8mb4;

-- 1. Tipo de evidencia: distingue la foto del documento de identidad de las
--    fotos del daño. El funcionario necesita saber cuál es cuál, y cada tipo
--    tiene su propio límite de cantidad.
SET @falta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'rufe_evidencias'
     AND COLUMN_NAME = 'tipo'
);

SET @sql := IF(@falta,
  'ALTER TABLE rufe_evidencias ADD COLUMN tipo ENUM(''DOCUMENTO'',''DANO'') NOT NULL DEFAULT ''DANO'' AFTER carga_hash',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Identificador de envío que genera el navegador antes de mandar el reporte.
--    Es lo que hace seguro reintentar cuando vuelve la señal: si el reporte ya
--    entró, el servidor devuelve el mismo radicado en vez de crear un duplicado.
--    Sin esto, un envío que llega al servidor pero cuya respuesta se pierde por
--    falta de cobertura acabaría registrando dos veces al mismo hogar.
SET @falta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'rufe_reportes'
     AND COLUMN_NAME = 'envio_id'
);

SET @sql := IF(@falta,
  'ALTER TABLE rufe_reportes ADD COLUMN envio_id CHAR(36) NULL DEFAULT NULL AFTER radicado, ADD UNIQUE KEY uq_rufe_reportes_envio (envio_id)',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
