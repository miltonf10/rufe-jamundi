-- Sistema de Gestión del Riesgo — Jamundí
-- El rol del profesional que inspecciona viviendas, y sus datos.
--
-- Hasta ahora, para que un ingeniero pudiera diligenciar el formato había que
-- darle «Gestor», que además le abría el censo entero, el mapa y la bandeja del
-- RUFE — fichas con nombres, cédulas y direcciones de hogares damnificados que
-- su trabajo no necesita. Suele ser además personal contratado para la
-- emergencia.
--
-- ── Sobre el ALTER de `rol` ──────────────────────────────────────────────────
--
-- Esta es la ÚNICA sentencia de todo el proyecto que modifica una columna
-- existente, y hay que decir por qué es segura: MySQL no tiene forma de añadir
-- un valor a un ENUM que no sea redefinirlo entero. La lista nueva contiene los
-- tres valores anteriores en el mismo orden y añade uno al final, así que
-- ninguna fila cambia de valor ni queda fuera de rango.
--
-- La prueba «ninguna migración puede borrar datos» comprueba exactamente eso:
-- permite un MODIFY de un ENUM solo si la lista nueva es un superconjunto de la
-- anterior. Un MODIFY que quitara un rol sigue haciéndola fallar.
--
-- Es idempotente: mira si el tipo de la columna ya menciona el valor nuevo.

SET NAMES utf8mb4;

SET @faltaRol := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'usuarios'
     AND COLUMN_NAME = 'rol'
     AND COLUMN_TYPE LIKE '%INSPECTOR%'
);

SET @sql := IF(@faltaRol,
  'ALTER TABLE usuarios
     MODIFY COLUMN rol ENUM(''ADMINISTRADOR'',''GESTOR'',''VISUALIZACION'',''INSPECTOR'')
       NOT NULL DEFAULT ''VISUALIZACION''',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Los datos propios del profesional, que hoy se reescriben a mano en el numeral
-- 1 en cada visita. Son suyos, no de la vivienda: pertenecen a su usuario.
--
-- Todas nulas: los usuarios que ya existen no son inspectores y no tienen por
-- qué llevarlas, y un inspector puede crearse antes de tener todos sus datos.

SET @faltaPerfil := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'usuarios'
     AND COLUMN_NAME = 'profesion'
);

SET @sql := IF(@faltaPerfil,
  'ALTER TABLE usuarios
     ADD COLUMN profesion           VARCHAR(60)  NULL DEFAULT NULL AFTER rol,
     ADD COLUMN tarjeta_profesional VARCHAR(40)  NULL DEFAULT NULL AFTER profesion,
     ADD COLUMN documento           VARCHAR(20)  NULL DEFAULT NULL AFTER tarjeta_profesional,
     ADD COLUMN documento_de        VARCHAR(80)  NULL DEFAULT NULL AFTER documento,
     ADD COLUMN telefono            VARCHAR(20)  NULL DEFAULT NULL AFTER documento_de,
     ADD COLUMN direccion           VARCHAR(160) NULL DEFAULT NULL AFTER telefono',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
