-- CreateTable
CREATE TABLE "LeadMemory" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "summary" TEXT,
    "summarizedUpto" TIMESTAMP(3),
    "facts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadMemory_leadId_key" ON "LeadMemory"("leadId");

-- CreateIndex
CREATE INDEX "LeadMemory_companyId_leadId_idx" ON "LeadMemory"("companyId", "leadId");

-- AddForeignKey
ALTER TABLE "LeadMemory" ADD CONSTRAINT "LeadMemory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMemory" ADD CONSTRAINT "LeadMemory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
