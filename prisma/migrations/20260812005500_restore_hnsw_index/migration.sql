-- Restaura el índice vectorial HNSW que la migración anterior eliminó por error.
-- Prisma no conoce este índice (está sobre una columna `Unsupported("vector")`),
-- por eso lo trata como "drift" y genera un DROP en cada `migrate dev`.
-- GOTCHA: al generar futuras migraciones con `--create-only`, ELIMINA la línea
-- `DROP INDEX "KnowledgeChunk_embedding_hnsw_idx"` del SQL antes de aplicarla.
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw_idx"
    ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
