-- Formato de Inspección de Viviendas Afectadas (NGRD).
--
-- El RUFE censa quién quedó afectado; esto evalúa la vivienda y determina qué
-- materiales le corresponden. Son documentos distintos con vidas distintas —de
-- una misma familia puede haber una ficha RUFE y ninguna inspección, o varias
-- inspecciones a lo largo del tiempo—, así que viven en sus propias tablas y se
-- enlazan por `rufe_reporte_id`, que puede quedar en nulo.
--
-- Idempotente, como todas: el Migrador no lleva registro de qué aplicó y esto
-- se ejecuta desde el navegador cada vez que se despliega.

CREATE TABLE IF NOT EXISTS inspeccion_viviendas (
  id                        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  numero                    CHAR(16)      NOT NULL,
  -- Lo genera el navegador ANTES de mandar. Es lo que hace seguro reintentar
  -- sin señal: si la inspección ya entró, el servidor devuelve el mismo número
  -- en vez de crear una segunda.
  envio_id                  CHAR(36)      NULL DEFAULT NULL,
  rufe_reporte_id           INT UNSIGNED  NULL DEFAULT NULL,
  estado                    ENUM('RECIBIDA','EN_VALIDACION','APROBADA','RECHAZADA','ARCHIVADA')
                                          NOT NULL DEFAULT 'RECIBIDA',

  -- 1. Información general
  fecha_evaluacion          DATE          NOT NULL,
  profesional_nombre        VARCHAR(160)  NOT NULL,
  profesional_tarjeta       VARCHAR(60)   NOT NULL,
  profesional_profesion     VARCHAR(120)  NOT NULL,
  profesional_documento     VARCHAR(20)   NOT NULL,
  profesional_documento_de  VARCHAR(120)  NULL DEFAULT NULL,
  profesional_telefono      VARCHAR(20)   NOT NULL,
  profesional_direccion     VARCHAR(200)  NULL DEFAULT NULL,
  -- El formato pide «Nombres y Apellidos» en un solo renglón; se respeta en vez
  -- de partirlo, para que el papel y el expediente digan lo mismo.
  propietario_nombres       VARCHAR(200)  NOT NULL,
  propietario_documento     VARCHAR(20)   NOT NULL,
  propietario_documento_de  VARCHAR(120)  NULL DEFAULT NULL,
  propietario_telefono      VARCHAR(20)   NULL DEFAULT NULL,
  propietario_direccion     VARCHAR(200)  NULL DEFAULT NULL,

  -- 2. Localización
  departamento              VARCHAR(80)   NOT NULL,
  municipio                 VARCHAR(80)   NOT NULL,
  direccion_cabecera        VARCHAR(200)  NULL DEFAULT NULL,
  corregimiento             VARCHAR(120)  NULL DEFAULT NULL,
  vereda                    VARCHAR(160)  NULL DEFAULT NULL,

  -- 3 y 4. Requisitos. Se guardan los tres por separado, no solo la conclusión:
  -- son las condiciones que la persona incumplió y de ellas depende que reciba
  -- o no los materiales; un «no cumple» a secas no sirve de constancia.
  req_no_beneficiario       TINYINT(1)    NULL DEFAULT NULL,
  req_propietario           TINYINT(1)    NULL DEFAULT NULL,
  req_no_alto_riesgo        TINYINT(1)    NULL DEFAULT NULL,
  cumple_requisitos         TINYINT(1)    NOT NULL,

  -- 5. Inspección. Todo esto queda en nulo cuando no se cumplen los requisitos:
  -- el formato ordena no continuar la inspección.
  evento                    VARCHAR(40)   NULL DEFAULT NULL,
  evento_otro               VARCHAR(120)  NULL DEFAULT NULL,
  sistema_constructivo      ENUM('MAMPOSTERIA','MADERA') NULL DEFAULT NULL,
  -- 5.3: la letra de la convención impresa, no la etiqueta. El papel dice «Bl»
  -- y el expediente tiene que poder cotejarse con el papel.
  material_muros            VARCHAR(4)    NULL DEFAULT NULL,
  material_pisos            VARCHAR(4)    NULL DEFAULT NULL,
  material_estructura       VARCHAR(4)    NULL DEFAULT NULL,
  material_cubierta         VARCHAR(4)    NULL DEFAULT NULL,
  colapso_total             TINYINT(1)    NOT NULL DEFAULT 0,
  requiere_evacuacion       TINYINT(1)    NULL DEFAULT NULL,

  -- 6. Banco de materiales. El combo y su lista se guardan CALCULADOS, no solo
  -- derivables: dentro de un año la norma puede haber cambiado y el expediente
  -- tiene que seguir diciendo qué se entregó y por qué se entregó.
  combo                     VARCHAR(30)   NULL DEFAULT NULL,
  combo_nivel               VARCHAR(20)   NULL DEFAULT NULL,
  combo_motivo              VARCHAR(255)  NULL DEFAULT NULL,
  kit_cubierta              VARCHAR(20)   NULL DEFAULT NULL,
  materiales_json           TEXT          NULL DEFAULT NULL,

  -- 7. Quién suministró la información
  informante_nombre         VARCHAR(160)  NULL DEFAULT NULL,
  informante_documento      VARCHAR(20)   NULL DEFAULT NULL,
  informante_parentesco     TINYINT UNSIGNED NULL DEFAULT NULL,
  informante_telefono       VARCHAR(20)   NULL DEFAULT NULL,

  -- 8. Acta de quien no cumple. Solo se llena en la otra rama.
  acta_modalidad            ENUM('REHABILITACION','CONSTRUCCION') NULL DEFAULT NULL,
  acta_nombre               VARCHAR(160)  NULL DEFAULT NULL,
  acta_documento            VARCHAR(20)   NULL DEFAULT NULL,
  acta_telefono             VARCHAR(20)   NULL DEFAULT NULL,

  -- 9. Aprobación. Sin firmas: se registran los nombres y el PDF sale con las
  -- líneas en blanco para firmar a mano.
  aprobacion_profesional    VARCHAR(160)  NOT NULL,
  aprobacion_coordinador    VARCHAR(160)  NULL DEFAULT NULL,

  huella                    CHAR(64)      NOT NULL,
  creado_por_usuario_id     INT UNSIGNED  NULL DEFAULT NULL,
  creado_en                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_inspeccion_numero (numero),
  UNIQUE KEY uq_inspeccion_envio (envio_id),
  KEY idx_inspeccion_estado (estado),
  KEY idx_inspeccion_fecha (fecha_evaluacion),
  KEY idx_inspeccion_documento (propietario_documento),
  KEY idx_inspeccion_combo (combo),
  KEY idx_inspeccion_huella (huella),
  KEY idx_inspeccion_rufe (rufe_reporte_id),
  CONSTRAINT fk_inspeccion_autor FOREIGN KEY (creado_por_usuario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL,
  -- El censo y la inspección son documentos independientes: borrar una ficha
  -- RUFE no puede llevarse por delante la evaluación técnica de la vivienda.
  CONSTRAINT fk_inspeccion_rufe FOREIGN KEY (rufe_reporte_id)
    REFERENCES rufe_reportes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La tabla del numeral 5.4, una fila por elemento evaluado.
--
-- En filas y no en columnas porque los elementos dependen del sistema
-- constructivo —mampostería tiene siete y madera seis, y no son los mismos—, y
-- porque así una revisión puede consultar «todas las viviendas con muros de
-- carga severos» sin recorrer un JSON.
CREATE TABLE IF NOT EXISTS inspeccion_danos (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inspeccion_id INT UNSIGNED    NOT NULL,
  elemento      VARCHAR(30)     NOT NULL,
  afectado      TINYINT(1)      NOT NULL,
  -- Nulo cuando el elemento no resultó afectado.
  nivel         VARCHAR(20)     NULL DEFAULT NULL,
  orden         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inspeccion_danos (inspeccion_id, elemento),
  KEY idx_inspeccion_danos_nivel (nivel),
  CONSTRAINT fk_inspeccion_danos FOREIGN KEY (inspeccion_id)
    REFERENCES inspeccion_viviendas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial de estados, igual que en el RUFE: el correo se desnormaliza para
-- que el registro sobreviva al borrado del usuario.
CREATE TABLE IF NOT EXISTS inspeccion_historial (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inspeccion_id  INT UNSIGNED    NOT NULL,
  estado         VARCHAR(20)     NOT NULL,
  nota           VARCHAR(500)    NULL DEFAULT NULL,
  usuario_id     INT UNSIGNED    NULL DEFAULT NULL,
  usuario_email  VARCHAR(180)    NULL DEFAULT NULL,
  creado_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inspeccion_historial (inspeccion_id),
  CONSTRAINT fk_inspeccion_historial FOREIGN KEY (inspeccion_id)
    REFERENCES inspeccion_viviendas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El registro fotográfico del numeral 11 reutiliza `rufe_evidencias`, que ya
-- sabe subir, validar, comprimir, adoptar y purgar. Se le añaden dos columnas
-- nulas: a qué inspección pertenece la foto y el «FOTOGRAFIA DE:» que el
-- formato imprime bajo cada recuadro, que en el RUFE queda vacío.
--
-- Duplicar todo ese módulo para tener dos copias que mantener sería peor que un
-- nombre de tabla que ya no describe del todo su contenido.
SET @falta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'rufe_evidencias'
     AND COLUMN_NAME = 'inspeccion_id'
);

SET @sql := IF(@falta,
  'ALTER TABLE rufe_evidencias
     ADD COLUMN inspeccion_id INT UNSIGNED NULL DEFAULT NULL AFTER reporte_id,
     ADD COLUMN descripcion VARCHAR(160) NULL DEFAULT NULL AFTER tipo,
     ADD KEY idx_rufe_evidencias_inspeccion (inspeccion_id),
     ADD CONSTRAINT fk_rufe_evidencias_inspeccion FOREIGN KEY (inspeccion_id)
       REFERENCES inspeccion_viviendas (id) ON DELETE CASCADE',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
