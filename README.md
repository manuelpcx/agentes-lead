# Agentes Lead — Backend (NestJS)

Agente autónomo de captación y seguimiento de leads, **multi-tenant** (Chile /
LATAM). Este repositorio contiene el backend (cerebro del agente). Construido
por fases; esta es la **Fase 1 — Cimientos**.

## Qué incluye la Fase 1

- Proyecto NestJS modular: `companies`, `agents`, `leads`, `interactions`,
  `webhooks`, `health` + `common` (config, prisma, tenant, crypto, filtros).
- Esquema Prisma con `Company`, `Agent`, `Lead`, `Interaction`, `Conversation`
  y **pgvector habilitado** (aún sin uso, listo para Fase 2).
- **Aislamiento multi-tenant forzado** a nivel de extensión de Prisma +
  `AsyncLocalStorage` (ninguna query puede olvidarse del `companyId`).
- Ingesta `POST /webhooks/lead`: autenticación por **firma HMAC** por empresa,
  responde **202** de inmediato y encola en **BullMQ**; el worker crea/actualiza
  el lead (idempotente por `(companyId, externalId)`) en estado `NUEVO`, **sin
  LLM**.
- `GET /health` verificando **PostgreSQL** y **Redis**.
- Cifrado en reposo (AES-256-GCM) del secreto de webhook por empresa.
- Tests unitarios: aislamiento de tenant, idempotencia de leads y cifrado.

## Requisitos

- Node.js 20+ (probado con 22)
- pnpm 9+
- Docker (para Postgres con pgvector + Redis)

## Puesta en marcha local

1. **Infraestructura** (Postgres con pgvector + Redis):

   ```bash
   docker compose up -d
   ```

2. **Variables de entorno**: copia el ejemplo y genera la clave de cifrado.

   ```bash
   cp .env.example .env
   node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
   ```

   Pega el valor en `ENCRYPTION_KEY` dentro de `.env`.

3. **Dependencias**:

   ```bash
   pnpm install
   ```

4. **Base de datos** (genera el cliente y aplica la migración inicial):

   ```bash
   pnpm prisma:generate
   pnpm prisma migrate dev --name init
   ```

5. **Arrancar** en modo desarrollo:

   ```bash
   pnpm start:dev
   ```

   La API queda en `http://localhost:3000`.

## Probar el flujo de ingesta

1. **Crear una empresa** (devuelve el `webhookSecret` en claro, una sola vez):

   ```bash
   curl -s -X POST http://localhost:3000/companies \
     -H 'Content-Type: application/json' \
     -d '{"name":"Clínica Demo","rut":"76.123.456-7"}'
   ```

   Guarda `company.id` y `webhookSecret`.

2. **Enviar un lead firmado**. La firma es el HMAC-SHA256 (hex) del cuerpo
   crudo con el `webhookSecret`. Helper en Node:

   ```bash
   COMPANY_ID="<id-de-la-empresa>"
   SECRET="<webhookSecret>"
   BODY='{"externalId":"lead-001","name":"Ana","phone":"+56912345678","source":"landing"}'
   SIG=$(node -e "console.log(require('crypto').createHmac('sha256', process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$BODY")

   curl -s -X POST http://localhost:3000/webhooks/lead \
     -H 'Content-Type: application/json' \
     -H "X-Company-Id: $COMPANY_ID" \
     -H "X-Signature: $SIG" \
     -d "$BODY"
   ```

   Responde `202 Accepted`. Reenviar el mismo `externalId` **actualiza** el
   lead y registra una nueva interacción, sin duplicarlo.

3. **Verificar salud**:

   ```bash
   curl -s http://localhost:3000/health
   ```

## Comandos

```bash
pnpm start:dev      # desarrollo con hot reload
pnpm build          # compilación a dist/
pnpm start:prod     # node dist/main
pnpm lint           # eslint
pnpm test           # tests unitarios (jest)
pnpm prisma:studio  # explorar la BD
```

## Notas de deploy en Railway

- Provisiona **PostgreSQL** (con la imagen/plugin que soporte `pgvector`) y
  **Redis** como servicios; Railway inyecta `DATABASE_URL` y una URL de Redis
  (mapéala a `REDIS_URL`).
- Define `ENCRYPTION_KEY`, `JWT_*` (fases posteriores) y `NODE_ENV=production`
  en las variables del servicio.
- Comando de release: `pnpm prisma migrate deploy` (aplica migraciones contra
  la BD de producción sin `synchronize`).
- Comando de arranque: `pnpm start:prod`.
- El arranque hace **fail-fast** si falta cualquier variable requerida.

## Arquitectura y decisiones

Ver la sección de decisiones de diseño en el historial del proyecto. Puntos
clave de esta fase:

- **Tenant por contexto**: un middleware abre `TenantContext`
  (`AsyncLocalStorage`) por request; el `CompanyAuthGuard` fija el `companyId`
  tras validar la firma; la extensión de Prisma lo inyecta/filtra en cada query.
- **Webhook desacoplado**: 202 inmediato + cola; el trabajo real vive en el
  worker (`LeadIngestionProcessor`), con reintentos y backoff exponencial.
- **Idempotencia** en la base de datos por `(companyId, externalId)`.
