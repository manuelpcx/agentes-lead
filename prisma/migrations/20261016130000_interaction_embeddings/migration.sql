-- Embeddings de las interacciones de conversación, para recuperar mensajes
-- antiguos por relevancia. Sin índice vectorial (HNSW): la búsqueda es siempre
-- dentro de un solo lead, y el índice (companyId, leadId) basta.

-- CreateTable
CREATE TABLE "InteractionEmbedding" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "interactionId" UUID NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InteractionEmbedding_interactionId_key" ON "InteractionEmbedding"("interactionId");

-- CreateIndex
CREATE INDEX "InteractionEmbedding_companyId_leadId_idx" ON "InteractionEmbedding"("companyId", "leadId");

-- AddForeignKey
ALTER TABLE "InteractionEmbedding" ADD CONSTRAINT "InteractionEmbedding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionEmbedding" ADD CONSTRAINT "InteractionEmbedding_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionEmbedding" ADD CONSTRAINT "InteractionEmbedding_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
