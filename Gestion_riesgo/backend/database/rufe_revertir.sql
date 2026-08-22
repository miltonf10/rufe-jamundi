-- Reversión del módulo RUFE. Borra únicamente lo que creó rufe.sql.
-- Las tablas previas (usuarios, sesiones, auditoria, ajustes) no se tocan.
--
-- ATENCIÓN: esto elimina todos los reportes ciudadanos. Exporte antes.
-- Los archivos de evidencia en disco NO se borran con este script: hay que
-- eliminar a mano la carpeta de almacenamiento configurada.
--
-- El orden es el inverso al de creación para no chocar con las claves foráneas.
-- No hace falta deshacer rufe_02_evidencias_y_envio.sql: sus columnas viven
-- dentro de estas tablas y desaparecen con ellas.

SET NAMES utf8mb4;

DROP TABLE IF EXISTS rufe_limite;
DROP TABLE IF EXISTS rufe_borradores;
DROP TABLE IF EXISTS rufe_historial;
DROP TABLE IF EXISTS rufe_evidencias;
DROP TABLE IF EXISTS rufe_agropecuario;
DROP TABLE IF EXISTS rufe_personas;
DROP TABLE IF EXISTS rufe_reportes;
