-- Sistema de Gestión del Riesgo — Jamundí
-- Registro Unifamiliar de Emergencias (RUFE), formato UNGRD FR-1703-SMD-69 v01.
-- Idempotente: se puede ejecutar varias veces sin efecto adicional.
--
-- Este archivo no modifica ninguna tabla previa (usuarios, sesiones, auditoria,
-- ajustes). Solo agrega. Para deshacerlo: database/rufe_revertir.sql

SET NAMES utf8mb4;

-- Cabecera del reporte: un registro por unidad familiar afectada.
--
-- Los códigos de documento, parentesco, género y etnia no viven en tablas de
-- catálogo porque son números impresos en un formato con versión controlada por
-- la UNGRD, no una lista que la Alcaldía administre. Guardarlos como código
-- (y no como etiqueta) mantiene la trazabilidad con el papel aunque la UNGRD
-- reformule un texto. La columna formato_version permite convivir con futuras
-- versiones del formato sin migrar los registros históricos.
CREATE TABLE IF NOT EXISTS rufe_reportes (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  radicado              CHAR(18)      NOT NULL,
  envio_id              CHAR(36)      NULL DEFAULT NULL,
  formato_version       VARCHAR(10)   NOT NULL DEFAULT '01',
  estado                ENUM('RECIBIDO','EN_VALIDACION','VALIDADO','RECHAZADO','ARCHIVADO')
                                      NOT NULL DEFAULT 'RECIBIDO',
  origen                ENUM('PUBLICO','INTERNO') NOT NULL DEFAULT 'PUBLICO',
  departamento          VARCHAR(80)   NOT NULL,
  municipio             VARCHAR(80)   NOT NULL,
  evento                VARCHAR(120)  NOT NULL,
  fecha_evento          DATE          NOT NULL,
  fecha_rufe            DATE          NOT NULL,
  zona                  ENUM('URBANO','RURAL') NOT NULL,
  corregimiento         VARCHAR(120)  NULL DEFAULT NULL,
  vereda_sector_barrio  VARCHAR(160)  NOT NULL,
  direccion             VARCHAR(200)  NOT NULL,
  latitud               DECIMAL(10,7) NULL DEFAULT NULL,
  longitud              DECIMAL(10,7) NULL DEFAULT NULL,
  precision_m           SMALLINT UNSIGNED NULL DEFAULT NULL,
  alojamiento           ENUM('LUGAR_HABITUAL','EVACUADO') NOT NULL,
  alojamiento_direccion VARCHAR(200)  NULL DEFAULT NULL,
  forma_tenencia        ENUM('ARRENDATARIO','OCUPANTE','POSEEDOR','PROPIETARIO','NO_INFORMA') NOT NULL,
  estado_bien           ENUM('HABITABLE','NO_HABITABLE','AVERIADO','DESTRUIDO','NO_INFORMA') NOT NULL,
  tipo_bien             ENUM('VIVIENDA','FINCA','LOCAL_COMERCIAL','FABRICA','BODEGA','LOTE','CENTRO_BIENESTAR','CENTRO_EDUCATIVO','CENTRO_ADULTO_MAYOR','HOSPITAL','ESTADIO','IGLESIA','ALCALDIA','ESTACION_POLICIA') NOT NULL,
  observaciones         TEXT          NULL DEFAULT NULL,
  contacto_telefono     VARCHAR(30)   NOT NULL,
  contacto_correo       VARCHAR(180)  NULL DEFAULT NULL,
  autoriza_datos        TINYINT(1)    NOT NULL DEFAULT 0,
  autoriza_sensibles    TINYINT(1)    NOT NULL DEFAULT 0,
  autorizacion_en       DATETIME      NULL DEFAULT NULL,
  autorizacion_texto    VARCHAR(40)   NULL DEFAULT NULL,
  revision_prioritaria  TINYINT(1)    NOT NULL DEFAULT 0,
  huella                CHAR(64)      NOT NULL,
  ip_hash               CHAR(64)      NULL DEFAULT NULL,
  user_agent            VARCHAR(255)  NULL DEFAULT NULL,
  creado_por_usuario_id INT UNSIGNED  NULL DEFAULT NULL,
  vobo_usuario_id       INT UNSIGNED  NULL DEFAULT NULL,
  vobo_en               DATETIME      NULL DEFAULT NULL,
  anonimizado_en        DATETIME      NULL DEFAULT NULL,
  creado_en             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rufe_reportes_radicado (radicado),
  UNIQUE KEY uq_rufe_reportes_envio (envio_id),
  KEY idx_rufe_reportes_estado (estado),
  KEY idx_rufe_reportes_fecha_evento (fecha_evento),
  KEY idx_rufe_reportes_zona (zona),
  KEY idx_rufe_reportes_creado (creado_en),
  KEY idx_rufe_reportes_huella (huella),
  CONSTRAINT fk_rufe_reportes_autor FOREIGN KEY (creado_por_usuario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_rufe_reportes_vobo FOREIGN KEY (vobo_usuario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Información demográfica: de 1 a 10 personas por reporte, tal como el formato.
-- El orden es el número de renglón impreso y debe ser contiguo desde 1.
CREATE TABLE IF NOT EXISTS rufe_personas (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  reporte_id         INT UNSIGNED     NOT NULL,
  orden              TINYINT UNSIGNED NOT NULL,
  nombres            VARCHAR(120)     NOT NULL,
  apellidos          VARCHAR(120)     NOT NULL,
  tipo_documento     TINYINT UNSIGNED NOT NULL,
  numero_documento   VARCHAR(30)      NULL DEFAULT NULL,
  documento_otro     VARCHAR(60)      NULL DEFAULT NULL,
  parentesco         TINYINT UNSIGNED NOT NULL,
  genero             TINYINT UNSIGNED NOT NULL,
  fecha_nacimiento   DATE             NULL DEFAULT NULL,
  pertenencia_etnica TINYINT UNSIGNED NOT NULL,
  telefono           VARCHAR(30)      NULL DEFAULT NULL,
  creado_en          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rufe_personas_orden (reporte_id, orden),
  KEY idx_rufe_personas_documento (tipo_documento, numero_documento),
  CONSTRAINT fk_rufe_personas_reporte FOREIGN KEY (reporte_id)
    REFERENCES rufe_reportes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sector agropecuario: de 0 a 4 renglones. Todas las columnas son opcionales
-- porque un renglón puede ser solo agrícola o solo pecuario; la regla de que
-- al menos uno de los dos exista se valida en PHP, no en la base, para poder
-- devolver un mensaje entendible al ciudadano.
CREATE TABLE IF NOT EXISTS rufe_agropecuario (
  id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  reporte_id        INT UNSIGNED     NOT NULL,
  orden             TINYINT UNSIGNED NOT NULL,
  tipo_cultivo      VARCHAR(120)     NULL DEFAULT NULL,
  unidad_medida     ENUM('HECTAREA','FANEGADA','METRO','CUADRA','UNIDADES') NULL DEFAULT NULL,
  area_cantidad     DECIMAL(12,2)    NULL DEFAULT NULL,
  especie_pecuaria  VARCHAR(120)     NULL DEFAULT NULL,
  cantidad_unidades INT UNSIGNED     NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rufe_agro_orden (reporte_id, orden),
  CONSTRAINT fk_rufe_agro_reporte FOREIGN KEY (reporte_id)
    REFERENCES rufe_reportes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Evidencias. Campo añadido, no está en el formato de papel.
--
-- Una fila nace con reporte_id NULL y carga_hash puesto: es un archivo subido
-- antes de que el reporte exista, para poder mostrar progreso y permitir
-- reintentos por archivo. Al enviar el reporte se adopta la carga (reporte_id
-- se llena, carga_hash y expira_en se vacían). Las cargas que nadie adopta
-- caducan y se purgan.
CREATE TABLE IF NOT EXISTS rufe_evidencias (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporte_id       INT UNSIGNED    NULL DEFAULT NULL,
  carga_hash       CHAR(64)        NULL DEFAULT NULL,
  tipo             ENUM('DOCUMENTO','DANO') NOT NULL DEFAULT 'DANO',
  nombre_original  VARCHAR(180)    NOT NULL,
  nombre_guardado  VARCHAR(80)     NOT NULL,
  ruta_relativa    VARCHAR(200)    NOT NULL,
  mime             VARCHAR(80)     NOT NULL,
  extension        VARCHAR(10)     NOT NULL,
  tamano_bytes     INT UNSIGNED    NOT NULL,
  hash_sha256      CHAR(64)        NOT NULL,
  expira_en        DATETIME        NULL DEFAULT NULL,
  creado_en        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rufe_evidencias_reporte (reporte_id),
  KEY idx_rufe_evidencias_carga (carga_hash),
  KEY idx_rufe_evidencias_expira (expira_en),
  CONSTRAINT fk_rufe_evidencias_reporte FOREIGN KEY (reporte_id)
    REFERENCES rufe_reportes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial de estados. El correo del funcionario se desnormaliza para que el
-- registro sobreviva al borrado del usuario, igual que en la tabla auditoria.
CREATE TABLE IF NOT EXISTS rufe_historial (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporte_id      INT UNSIGNED    NOT NULL,
  estado_anterior VARCHAR(20)     NULL DEFAULT NULL,
  estado_nuevo    VARCHAR(20)     NOT NULL,
  usuario_id      INT UNSIGNED    NULL DEFAULT NULL,
  usuario_email   VARCHAR(180)    NULL DEFAULT NULL,
  nota            VARCHAR(500)    NULL DEFAULT NULL,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rufe_historial_reporte (reporte_id),
  CONSTRAINT fk_rufe_historial_reporte FOREIGN KEY (reporte_id)
    REFERENCES rufe_reportes (id) ON DELETE CASCADE,
  CONSTRAINT fk_rufe_historial_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Borradores de funcionarios autenticados. El ciudadano anónimo NO usa esta
-- tabla: sus datos viven solo en su dispositivo hasta que pulsa Enviar, porque
-- guardar nombres, documentos y etnia de terceros antes de que exista la
-- autorización de tratamiento sería recolectar datos sensibles sin permiso.
CREATE TABLE IF NOT EXISTS rufe_borradores (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  clave          CHAR(36)        NOT NULL,
  usuario_id     INT UNSIGNED    NOT NULL,
  contenido      MEDIUMTEXT      NOT NULL,
  expira_en      DATETIME        NOT NULL,
  creado_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rufe_borradores_clave (clave, usuario_id),
  KEY idx_rufe_borradores_usuario (usuario_id),
  KEY idx_rufe_borradores_expira (expira_en),
  CONSTRAINT fk_rufe_borradores_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contadores de tasa por ventana. La clave es un SHA-256 de acción + IP + sal:
-- se necesita distinguir a quien abusa sin conservar su IP en claro, que es un
-- dato personal que no aporta nada al proceso de atención.
CREATE TABLE IF NOT EXISTS rufe_limite (
  clave         CHAR(64)     NOT NULL,
  contador      INT UNSIGNED NOT NULL DEFAULT 0,
  ventana_desde DATETIME     NOT NULL,
  PRIMARY KEY (clave),
  KEY idx_rufe_limite_ventana (ventana_desde)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
