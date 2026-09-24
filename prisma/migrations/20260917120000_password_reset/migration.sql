-- Ciclo de vida de la contraseña: cambio/recuperación y revocación de sesiones.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetTokenHash_key" ON "User"("passwordResetTokenHash");
