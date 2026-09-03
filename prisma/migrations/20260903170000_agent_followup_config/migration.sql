-- AlterTable: config de seguimiento por agente (escalera, espaciado, plantillas).
ALTER TABLE "Agent" ADD COLUMN "followupConfig" JSONB NOT NULL DEFAULT '{}';
