-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');


-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID,
    "question" TEXT NOT NULL,
    "suggestedAnswer" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'PENDIENTE',
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExampleLibrary" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "situation" TEXT NOT NULL,
    "agentResponse" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExampleLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMetric" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "agentId" UUID,
    "date" DATE NOT NULL,
    "metricType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeGap_companyId_status_frequency_idx" ON "KnowledgeGap"("companyId", "status", "frequency");

-- CreateIndex
CREATE INDEX "ExampleLibrary_companyId_isApproved_idx" ON "ExampleLibrary"("companyId", "isApproved");

-- CreateIndex
CREATE INDEX "AgentMetric_companyId_date_idx" ON "AgentMetric"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetric_companyId_metricType_date_key" ON "AgentMetric"("companyId", "metricType", "date");

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExampleLibrary" ADD CONSTRAINT "ExampleLibrary_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMetric" ADD CONSTRAINT "AgentMetric_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
