-- AlterTable
-- Los usuarios que ya existen quedan en NULL a proposito: el panel cambio
-- bastante, asi que ven el tour una vez y lo saltan con un clic.
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
