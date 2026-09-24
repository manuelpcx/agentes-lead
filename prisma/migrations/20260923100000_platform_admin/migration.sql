-- AlterTable
-- Administrador de la plataforma. Nadie lo es por defecto: se marca a
-- mano con
--   UPDATE "User" SET "isPlatformAdmin" = true WHERE email = '...';
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
