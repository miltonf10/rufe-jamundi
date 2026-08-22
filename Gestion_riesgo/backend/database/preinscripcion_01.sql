-- Sistema de Gestión del Riesgo — Jamundí
-- Pre-inscripción ciudadana para la inspección de viviendas afectadas.
--
-- Hasta ahora una vivienda solo entraba al sistema si un funcionario la
-- visitaba. Esto abre la otra puerta: quien quedó afectado dice «aquí estoy» y
-- espera turno, y la Alcaldía puede priorizar por demanda real.
--
-- Una pre-inscripción NO es una inspección: es una solicitud. La evaluación del
-- daño, el combo de materiales y la aprobación siguen siendo del profesional con
-- tarjeta. Por eso vive en su propia tabla y solo se conecta con
-- `inspeccion_viviendas` cuando alguien la convierte a mano.
--
-- Solo tablas nuevas: ninguna existente se modifica salvo por dos columnas
-- nulas en `rufe_evidencias`, que quedan vacías en todo lo que ya existe.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS preinscripciones (
  id                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  radicado          VARCHAR(20)     NOT NULL,
  -- Lo que hace seguro reintentar sin señal: si la solicitud ya entró pero la
  -- respuesta se perdió, se devuelve el radicado original en vez de duplicar.
  envio_id          CHAR(36)        NOT NULL,

  nombre_completo   VARCHAR(200)    NOT NULL,
  documento         VARCHAR(20)     NOT NULL,
  telefono          VARCHAR(20)     NOT NULL,
  correo            VARCHAR(150)    NULL DEFAULT NULL,

  direccion         VARCHAR(200)    NOT NULL,
  corregimiento     VARCHAR(120)    NULL DEFAULT NULL,
  vereda            VARCHAR(120)    NULL DEFAULT NULL,
  latitud           DECIMAL(10,7)   NULL DEFAULT NULL,
  longitud          DECIMAL(10,7)   NULL DEFAULT NULL,
  precision_m       SMALLINT UNSIGNED NULL DEFAULT NULL,

  descripcion_dano  TEXT            NULL DEFAULT NULL,

  -- La Ley 1581 exige que la autorización sea informada, y aquí no hay un
  -- funcionario delante que la explique: se guarda QUÉ versión del aviso aceptó
  -- y cuándo, porque eso es lo que prueba el consentimiento, no lo que hoy diga
  -- la pantalla.
  autoriza_datos    TINYINT(1)      NOT NULL DEFAULT 0,
  aviso_version     VARCHAR(40)     NOT NULL,
  autorizacion_en   DATETIME        NOT NULL,

  -- Misma vivienda, mismo solicitante: sirve para avisar de un duplicado, no
  -- para impedirlo. Una casa puede pre-inscribirse otra vez tras otro evento.
  huella            CHAR(64)        NOT NULL,

  estado            ENUM('RECIBIDA','EN_REVISION','CONVERTIDA','DESCARTADA')
                    NOT NULL DEFAULT 'RECIBIDA',
  -- La inspección que nació de esta solicitud, si ya se convirtió.
  inspeccion_id     INT UNSIGNED    NULL DEFAULT NULL,

  origen_hash       CHAR(64)        NULL DEFAULT NULL COMMENT 'SHA-256 de la IP con sal: cuenta abusos sin guardar la IP',
  creado_en         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_preinscripciones_radicado (radicado),
  UNIQUE KEY uq_preinscripciones_envio (envio_id),
  KEY idx_preinscripciones_estado (estado),
  KEY idx_preinscripciones_documento (documento),
  KEY idx_preinscripciones_huella (huella),
  CONSTRAINT fk_preinscripciones_inspeccion FOREIGN KEY (inspeccion_id)
    REFERENCES inspeccion_viviendas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preinscripcion_historial (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  preinscripcion_id INT UNSIGNED  NOT NULL,
  estado          VARCHAR(20)     NOT NULL,
  nota            VARCHAR(500)    NULL DEFAULT NULL,
  usuario_id      INT UNSIGNED    NULL DEFAULT NULL,
  usuario_email   VARCHAR(180)    NULL DEFAULT NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_preinscripcion_historial (preinscripcion_id),
  CONSTRAINT fk_preinscripcion_historial FOREIGN KEY (preinscripcion_id)
    REFERENCES preinscripciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Las fotos reutilizan la maquinaria de `rufe_evidencias` —cargas, adopción,
-- purga, verificación del MIME por contenido— en vez de duplicarla. Dos copias
-- de ese módulo serían dos sitios donde arreglar el mismo fallo.

SET @falta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'rufe_evidencias'
     AND COLUMN_NAME = 'preinscripcion_id'
);

SET @sql := IF(@falta,
  'ALTER TABLE rufe_evidencias
     ADD COLUMN preinscripcion_id INT UNSIGNED NULL DEFAULT NULL AFTER inspeccion_id,
     ADD KEY idx_rufe_evidencias_preinscripcion (preinscripcion_id),
     ADD CONSTRAINT fk_rufe_evidencias_preinscripcion FOREIGN KEY (preinscripcion_id)
       REFERENCES preinscripciones (id) ON DELETE CASCADE',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
