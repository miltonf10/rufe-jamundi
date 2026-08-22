-- Sistema de Gestión del Riesgo — Jamundí
-- Los tipos de evidencia que de verdad existen.
--
-- `rufe_evidencias.tipo` se creó como ENUM('DOCUMENTO','DANO') cuando el censo
-- era el único formato que subía fotos. Desde entonces se añadieron en el código
-- `INSPECCION` —el registro fotográfico del numeral 11— y los dos de la
-- pre-inscripción ciudadana, pero NADIE amplió la columna.
--
-- El efecto: cualquier foto de una inspección era rechazada por la base con
-- «Data truncated for column 'tipo'». Estuvo así desde que se desplegó el
-- registro fotográfico. No se detectó porque las pruebas del proyecto corren sin
-- base de datos y ninguna subida real llegó a ejecutarse contra MySQL.
--
-- ── Sobre este ALTER ─────────────────────────────────────────────────────────
--
-- Es la segunda sentencia del proyecto que modifica una columna existente, y por
-- el mismo motivo que la primera: MySQL no sabe añadir valores a un ENUM sin
-- redefinirlo entero. La lista nueva CONTIENE los dos valores anteriores en el
-- mismo orden, así que ninguna fila cambia de valor ni queda fuera de rango.
--
-- La prueba «ninguna migración puede borrar datos» lo verifica: solo admite un
-- MODIFY de un ENUM cuando la lista nueva es un superconjunto de la anterior.

SET NAMES utf8mb4;

SET @faltaTipo := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'rufe_evidencias'
     AND COLUMN_NAME = 'tipo'
     AND COLUMN_TYPE LIKE '%PRE_DANO%'
);

SET @sql := IF(@faltaTipo,
  'ALTER TABLE rufe_evidencias
     MODIFY COLUMN tipo ENUM(''DOCUMENTO'',''DANO'',''INSPECCION'',''PRE_CEDULA'',''PRE_DANO'')
       NOT NULL DEFAULT ''DANO''',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
