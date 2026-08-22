-- Sistema de Gestión del Riesgo — Jamundí
-- La inspección también guarda dónde queda la vivienda.
--
-- El RUFE ya toma el punto GPS estando frente al inmueble, y el mapa se dibuja
-- con eso. La inspección visita EXACTAMENTE las mismas casas y no lo guardaba:
-- solo la dirección escrita, que en zona rural muchas veces es «finca La
-- Esperanza, vía a Potrerito», imposible de encontrar dos semanas después con
-- un camión de materiales.
--
-- Las tres columnas son nulas y siempre lo serán: tomar la ubicación es
-- opcional, igual que en el censo. Sin señal de GPS —bajo techo, en una casa
-- entre montañas— la visita tiene que poder continuar.
--
-- `precision_m` se guarda junto al punto por la misma razón que en
-- `rufe_geocodificacion`: unas coordenadas con 2 km de incertidumbre son
-- válidas y completamente inútiles, y sin el dato no hay forma de distinguirlas
-- de unas buenas al pintarlas en el mapa.
--
-- Migración puramente aditiva: no toca ninguna columna existente ni ninguna
-- fila. Las inspecciones ya levantadas quedan con los tres campos en NULL, que
-- es exactamente lo que significan: no se tomó la ubicación.

SET NAMES utf8mb4;

SET @falta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'inspeccion_viviendas'
     AND COLUMN_NAME = 'latitud'
);

SET @sql := IF(@falta,
  'ALTER TABLE inspeccion_viviendas
     ADD COLUMN latitud     DECIMAL(10,7)    NULL DEFAULT NULL AFTER vereda,
     ADD COLUMN longitud    DECIMAL(10,7)    NULL DEFAULT NULL AFTER latitud,
     ADD COLUMN precision_m SMALLINT UNSIGNED NULL DEFAULT NULL AFTER longitud',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
