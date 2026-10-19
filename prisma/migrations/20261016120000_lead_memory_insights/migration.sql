-- Conclusiones (reflexiones) del lead, cada una con las interacciones que la respaldan.
ALTER TABLE "LeadMemory" ADD COLUMN "insights" JSONB NOT NULL DEFAULT '[]';
