# Guía de uso — Agentes Lead

Agente autónomo, **multi-tenant**, que capta leads y les da seguimiento por
WhatsApp, correo y llamada. Responde con **tu** conocimiento (nunca inventa
precios ni disponibilidad) y escala a un humano cuando corresponde.

Esta guía va de cero a operando: levantar el entorno, registrar tu empresa,
cargar conocimiento, configurar agentes, conectar la entrada de leads y operar
el panel.

---

## 1. Requisitos

- **Node.js 20+** y **pnpm** (`npm i -g pnpm`).
- **PostgreSQL 15+** con la extensión `pgvector`.
- **Redis 6+** (colas de trabajo).
- Docker es la vía más simple para Postgres + Redis (hay `docker-compose.yml`).
- Opcionales (para producción): `ANTHROPIC_API_KEY` (el cerebro del agente),
  credenciales de WhatsApp/SMTP/voz (Retell, Vapi o ElevenLabs) y de Voyage AI
  (embeddings).

> Sin `ANTHROPIC_API_KEY` la app **igual arranca y es navegable**: el agente
> degrada a "escalar a humano" y la mejora continua queda en pausa. Ideal para
> probar el panel sin gastar tokens.

---

## 2. Puesta en marcha (desarrollo)

```bash
# 1) Infra local (Postgres + Redis)
docker compose up -d

# 2) Backend
pnpm install
cp .env.example .env          # edítalo (ver más abajo)
pnpm prisma migrate deploy    # aplica el esquema
pnpm prisma generate
pnpm build && node dist/main  # o: pnpm start:dev

# 3) Frontend (otra terminal)
cd frontend
pnpm install
pnpm dev                      # http://localhost:5173
```

Variables mínimas en `.env` (el resto tiene defaults sanos):

| Variable | Para qué | En dev |
|---|---|---|
| `DATABASE_URL` | Postgres | `postgresql://user:pass@localhost:5432/agentes_lead` |
| `REDIS_URL` | Colas | `redis://localhost:6380` |
| `ENCRYPTION_KEY` | Cifra secretos en reposo (**arranque falla si falta**) | 32 bytes hex |
| `JWT_SECRET` | Sesiones del panel | cualquier string largo |
| `EMBEDDINGS_PROVIDER` | Búsqueda semántica | `local` (sin API key) |
| `ANTHROPIC_API_KEY` | El agente responde de verdad | opcional en dev |

> El backend corre en `http://localhost:3000` (Swagger en `/api/docs`). En dev,
> Vite hace **proxy** de `/auth` y `/panel` hacia el backend, así que no hay CORS.

---

## 3. Primeros pasos en el panel

### 3.1 Registrar tu empresa

1. Abre `http://localhost:5173` → **Regístrate**.
2. Completa nombre de empresa, RUT, tu nombre, email y contraseña.
3. Al crear, se muestra **una sola vez** el `webhookSecret`. **Guárdalo ahora**:
   es la llave para firmar la entrada de leads. Si lo pierdes, hay que rotarlo.

Esto crea tu empresa, tu usuario **OWNER** y un **Agente de Ventas** por defecto.

### 3.2 Conocer el panel

El recorrido completo, menú por menú, está en **[`PANEL.md`](PANEL.md)**: qué
hace cada pantalla, cómo cargar conocimiento, configurar agentes, importar
leads desde otro CRM, revisar métricas y conectar integraciones. Es la misma
guía que se ve en la pestaña **Ayuda** de la aplicación.

Lo mínimo para tener un agente respondiendo:

1. **Conocimiento** → carga al menos un documento y los datos exactos (precios,
   horarios). El agente no dice nada que no esté ahí.
2. **Agentes** → revisa el agente de ventas que se creó solo, o crea el que
   necesites (el asistente de la pantalla de inicio te guía).
3. **Integraciones** → conecta WhatsApp y pega el **secreto de firma del
   webhook**. Sin ese secreto, los mensajes entrantes se rechazan.
4. **Configuración** → zona horaria, horario hábil y tu número de WhatsApp.

### 3.3 Conectar la entrada de leads (webhook firmado)

Envía cada lead nuevo a `POST /webhooks/lead` con **firma HMAC-SHA256** usando
tu `webhookSecret`:

- Header `X-Company-Id`: el id de tu empresa.
- Header `X-Timestamp`: la hora actual en **milisegundos Unix** (`Date.now()`).
- Header `X-Signature`: `hmacSHA256("<X-Timestamp>." + rawBody, webhookSecret)`
  en hex — el timestamp entra en la firma, y el servidor lo exige dentro de
  **±5 minutos**. Así una petición capturada no sirve para siempre.

Ejemplo (Node):

```js
import crypto from 'node:crypto';

const body = JSON.stringify({
  externalId: 'crm-123',        // idempotencia por empresa
  name: 'Juan Pérez',
  phone: '+56911111111',
  email: 'juan@example.com',
  source: 'landing-web',
  preferredChannel: 'whatsapp',
});
const timestamp = String(Date.now());
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(`${timestamp}.`)
  .update(body)
  .digest('hex');

await fetch('http://localhost:3000/webhooks/lead', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Company-Id': COMPANY_ID,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  },
  body,
});
```

En **n8n**: un nodo *Code* que arme `timestamp = String(Date.now())` y firme
`` `${timestamp}.${JSON.stringify(body)}` `` con HMAC-SHA256 (hex), y un
*HTTP Request* con los tres headers.

> **Migración desde el esquema anterior** (firma solo del cuerpo, sin
> `X-Timestamp`): sigue aceptándose con un aviso en los logs del servidor
> mientras `WEBHOOK_REQUIRE_TIMESTAMP=false`. Cuando todos tus flujos manden
> el timestamp, ponlo en `true` y el esquema viejo queda rechazado. La ingesta es **idempotente** por `(empresa, externalId)`: si
reenvías el mismo lead, se actualiza en vez de duplicarse.

### 3.4 Simular una conversación (dev)

Para probar sin WhatsApp real, usa `POST /whatsapp/simulate` (también firmado con
HMAC). Simula un mensaje entrante de un número; el agente responde por el proveedor
`log` (verás la respuesta en la consola del backend). En producción, el webhook de
Meta (`/whatsapp/webhook`) reemplaza a la simulación.

> El agente espera unos segundos antes de responder (`AGENT_TURN_DEBOUNCE_MS`,
> 8 s por defecto). Es a propósito: si el cliente manda tres mensajes seguidos,
> los contesta todos juntos en vez de responder tres veces.

---

## 4. Notas de producción

- Define proveedores reales por variables de entorno: `WHATSAPP_PROVIDER=meta`,
  `EMAIL_PROVIDER=smtp`, `VAPI_PROVIDER=vapi`, `EMBEDDINGS_PROVIDER=voyage`.
- Genera una `ENCRYPTION_KEY` fuerte y **no la rotes** sin plan (cifra secretos
  en reposo).
- El seguimiento proactivo respeta **horario hábil + zona horaria** de la empresa
  (menú **Configuración**).

---

## 5. Solución de problemas

| Síntoma | Causa / arreglo |
|---|---|
| `prisma generate` da **EPERM** en Windows | El backend en ejecución bloquea el DLL. Detén `node dist/main` / `start:dev` y regenera. |
| Migración borra el índice **HNSW** | `prisma migrate dev --create-only` mete un `DROP INDEX ..._hnsw_idx` espurio: **bórralo** del SQL antes de `migrate deploy`. |
| El cliente Prisma sale como *stub* | pnpm 11 bloquea build scripts: revisa `allowBuilds`/`onlyBuiltDependencies` en `pnpm-workspace.yaml` y re-corre `pnpm prisma generate`. |
| El panel no toma cambios de estilo | Reinicia el dev server de Vite si cambiaste `tailwind.config.js`. |
| El agente "escala a humano" siempre | Falta `ANTHROPIC_API_KEY` (degradación esperada). |
| 401 en el webhook | Firma HMAC o `X-Company-Id` incorrectos; firma el **cuerpo crudo**, no el objeto. |
