# Imagen del backend NestJS + Prisma para Railway.
# Un solo stage (robustez sobre tamaño): instala, genera el cliente Prisma,
# compila y, al arrancar, aplica migraciones antes de servir.
# Node 22: pnpm 11.5.1 (packageManager) requiere Node >=22.13.
FROM node:22-bookworm-slim

WORKDIR /app

# openssl: Prisma lo necesita para sus engines en Debian.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm vía corepack (misma versión que packageManager en package.json).
RUN corepack enable

# Dependencias (capa cacheable). El schema se copia antes para `prisma generate`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# Código y build. El frontend queda fuera vía .dockerignore.
COPY . .
RUN pnpm prisma generate && pnpm build

ENV NODE_ENV=production
# Railway inyecta PORT; la app lo lee de env. Se expone 3000 por defecto.
EXPOSE 3000

# Aplica migraciones y arranca. `migrate deploy` es idempotente.
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/main"]
