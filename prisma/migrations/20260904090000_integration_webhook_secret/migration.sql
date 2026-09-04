-- AlterTable: secreto de firma de webhooks, separado del secreto de API (p. ej. YCloud).
ALTER TABLE "Integration" ADD COLUMN "webhookSecretEnc" TEXT;
