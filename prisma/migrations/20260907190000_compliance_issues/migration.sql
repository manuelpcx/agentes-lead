-- CreateEnum
CREATE TYPE "ComplianceIssueStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "ComplianceIssue" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "conversationId" UUID,
    "issue" TEXT NOT NULL,
    "evidence" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "status" "ComplianceIssueStatus" NOT NULL DEFAULT 'PENDIENTE',
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceIssue_companyId_agentId_status_frequency_idx" ON "ComplianceIssue"("companyId", "agentId", "status", "frequency");

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
