-- Alertas de proveedores: un incidente por cuenta (de una empresa o de la
-- plataforma) con problemas, abierto hasta el primer envío exitoso.
-- CreateTable
CREATE TABLE "ProviderIncident" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "scope" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "hint" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 1,
    "affectedCompanyIds" UUID[],
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "openNotifiedAt" TIMESTAMP(3),
    "key" TEXT NOT NULL,
    "openKey" TEXT,

    CONSTRAINT "ProviderIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderIncident_openKey_key" ON "ProviderIncident"("openKey");

-- CreateIndex
CREATE INDEX "ProviderIncident_companyId_resolvedAt_idx" ON "ProviderIncident"("companyId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ProviderIncident_resolvedAt_idx" ON "ProviderIncident"("resolvedAt");

-- CreateIndex
CREATE INDEX "ProviderIncident_key_openedAt_idx" ON "ProviderIncident"("key", "openedAt");

-- AddForeignKey
ALTER TABLE "ProviderIncident" ADD CONSTRAINT "ProviderIncident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

