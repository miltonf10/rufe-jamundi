-- Sistema de Gestión del Riesgo — Jamundí
-- Caché de direcciones ya convertidas en coordenadas.
--
-- Geocodificar es lento, tiene cupo y en algunos servicios cuesta dinero, así
-- que se hace UNA vez por dirección y se guarda. La clave es el sha256 de la
-- dirección normalizada, no la dirección literal: así «Cra 5 # 10-20» y
-- «carrera 5 #10 20» comparten resultado en vez de gastar dos consultas.
--
-- Guardar la precisión es tan importante como guardar el punto. Una dirección
-- que solo se pudo resolver hasta «Jamundí» tiene coordenadas válidas y
-- completamente inútiles: pintarla amontonaría medio censo sobre el parque
-- principal y el mapa de calor mentiría. Por eso se clasifica y se filtra.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS rufe_geocodificacion (
  clave           CHAR(64)      NOT NULL,
  direccion       VARCHAR(255)  NOT NULL,
  latitud         DECIMAL(10,7) NULL DEFAULT NULL,
  longitud        DECIMAL(10,7) NULL DEFAULT NULL,
  precision_geo   ENUM('EXACTA','CALLE','BARRIO','MUNICIPIO','FALLIDA') NOT NULL DEFAULT 'FALLIDA',
  fuente          ENUM('NOMINATIM','GOOGLE','MANUAL','GPS') NULL DEFAULT NULL,
  etiqueta        VARCHAR(255)  NULL DEFAULT NULL,
  intentos        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_intento  DATETIME      NULL DEFAULT NULL,
  creado_en       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave),
  KEY idx_geo_precision (precision_geo),
  KEY idx_geo_pendientes (ultimo_intento, intentos)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
