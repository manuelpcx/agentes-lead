-- Correo gestionado: dominio propio de cada empresa, dado de alta en la
-- cuenta de Resend de la plataforma. Uno por empresa.
-- CreateTable
CREATE TABLE "EmailDomain" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "resendDomainId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "records" JSONB NOT NULL DEFAULT '[]',
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_companyId_key" ON "EmailDomain"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_domain_key" ON "EmailDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_resendDomainId_key" ON "EmailDomain"("resendDomainId");

-- AddForeignKey
ALTER TABLE "EmailDomain" ADD CONSTRAINT "EmailDomain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
