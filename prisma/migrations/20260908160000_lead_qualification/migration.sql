-- CreateEnum
CREATE TYPE "LeadQualification" AS ENUM ('FRIO', 'TIBIO', 'CALIENTE');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "qualification" "LeadQualification";
ALTER TABLE "Lead" ADD COLUMN "qualificationReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "qualifiedAt" TIMESTAMP(3);
