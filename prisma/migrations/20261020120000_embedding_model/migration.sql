-- Qué modelo produjo cada vector. Dos embedders distintos no son comparables:
-- las búsquedas solo miran los vectores del modelo activo y el resto se
-- reindexa en segundo plano (EmbeddingsReindexService).
--
-- Todo lo que existe hoy salió del embedder local de 1024 dimensiones (el
-- único configurado hasta ahora), así que se marca como tal. El valor por
-- defecto se quita después: cada inserción nueva tiene que decir su modelo.

ALTER TABLE "KnowledgeChunk" ADD COLUMN "embeddingModel" TEXT NOT NULL DEFAULT 'local:1024';
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "embeddingModel" DROP DEFAULT;

ALTER TABLE "ExampleLibrary" ADD COLUMN "embeddingModel" TEXT NOT NULL DEFAULT 'local:1024';
ALTER TABLE "ExampleLibrary" ALTER COLUMN "embeddingModel" DROP DEFAULT;

ALTER TABLE "InteractionEmbedding" ADD COLUMN "embeddingModel" TEXT NOT NULL DEFAULT 'local:1024';
ALTER TABLE "InteractionEmbedding" ALTER COLUMN "embeddingModel" DROP DEFAULT;

-- Para encontrar rápido lo que hay que reindexar.
CREATE INDEX "KnowledgeChunk_embeddingModel_idx" ON "KnowledgeChunk"("embeddingModel");
CREATE INDEX "ExampleLibrary_embeddingModel_idx" ON "ExampleLibrary"("embeddingModel");
CREATE INDEX "InteractionEmbedding_embeddingModel_idx" ON "InteractionEmbedding"("embeddingModel");
