-- Voz gestionada: registro de cada llamada (minutos del mes y llamadas en
-- curso por empresa) y tope mensual de minutos, que solo cambia la plataforma.
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "voiceMinutesLimit" INTEGER;

-- CreateTable
CREATE TABLE "VoiceCall" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "managed" BOOLEAN NOT NULL DEFAULT false,
    "callId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "durationSecs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceCall_companyId_startedAt_idx" ON "VoiceCall"("companyId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCall_provider_callId_key" ON "VoiceCall"("provider", "callId");

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
