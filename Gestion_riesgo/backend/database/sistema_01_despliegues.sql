-- Sistema de Gestión del Riesgo — Jamundí
-- Bitácora de despliegues aplicados desde GitHub.
--
-- Sin esta tabla el sistema no sabría qué versión tiene puesta: el código en
-- disco no lleva su propio número, y preguntárselo a GitHub solo dice cuál es la
-- última, no cuál se aplicó. También es lo que permite deshacer: guarda dónde
-- quedó el respaldo de cada despliegue.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS despliegues (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  destino           ENUM('BACKEND','FRONTEND') NOT NULL,
  commit_sha        CHAR(40)     NOT NULL,
  commit_mensaje    VARCHAR(300) NULL DEFAULT NULL,
  commit_autor      VARCHAR(180) NULL DEFAULT NULL,
  rama              VARCHAR(120) NOT NULL,
  estado            ENUM('EXITOSO','FALLIDO','REVERTIDO','OMITIDO') NOT NULL,
  archivos          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  respaldo_ruta     VARCHAR(255) NULL DEFAULT NULL,
  version_anterior  CHAR(40)     NULL DEFAULT NULL,
  migraciones       TINYINT(1)   NOT NULL DEFAULT 0,
  detalle           TEXT         NULL DEFAULT NULL,
  usuario_id        INT UNSIGNED NULL DEFAULT NULL,
  usuario_email     VARCHAR(180) NULL DEFAULT NULL,
  duracion_ms       INT UNSIGNED NULL DEFAULT NULL,
  creado_en         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_despliegues_destino (destino, creado_en),
  KEY idx_despliegues_estado (estado),
  CONSTRAINT fk_despliegues_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
