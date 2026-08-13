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
  credenciales de WhatsApp/SMTP/Vapi y de Voyage AI (embeddings).

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

### 3.2 Cargar el conocimiento (menú **Conocimiento**)

El agente solo dice lo que está aquí. Dos tipos:

- **Documentos (RAG)**: textos largos (FAQs, catálogo, objeciones). Se trocean e
  indexan; el agente los recupera por similitud.
- **Datos** (precios, horarios, políticas): fuente de verdad exacta. Clave +
  categoría + **valor JSON**, ej. clave `precio_corte`, categoría `PRECIO`,
  valor `{"monto":25000,"moneda":"CLP"}`.

Usa **"Pregúntale al conocimiento"** para ver qué recuperaría el agente ante una
pregunta, antes de exponerlo a clientes.

### 3.3 Configurar agentes (menú **Agentes**)

Crea agentes especializados y define **cómo se enrutan** los leads:

- **Canales que atiende** (WhatsApp / correo / llamada). Vacío = cualquiera.
- **Estados de lead que maneja** (NUEVO, EN_CONVERSACION, ESCALADO_HUMANO…).
  Vacío = cualquiera.
- **Prioridad** y **Agente por defecto**: desempatan cuando varios califican.

El enrutamiento decide en este orden: **canal → estado → clasificador (IA)**. Si
tras filtrar por canal y estado queda un único candidato, se asigna directo; si
quedan varios y hay `ANTHROPIC_API_KEY`, un clasificador elige por la
**descripción** de cada agente (por eso vale la pena describirlos bien).

> Regla de oro: **un solo agente a cargo de un lead a la vez** (`Lead.agentId`).
> Un agente pasa la conversación a otro con la herramienta `derivarAAgente`,
> dejando un resumen de contexto — lo ves en **Traspasos recientes**.

### 3.4 Conectar la entrada de leads (webhook firmado)

Envía cada lead nuevo a `POST /webhooks/lead` con **firma HMAC-SHA256** del
cuerpo crudo usando tu `webhookSecret`:

- Header `X-Company-Id`: el id de tu empresa.
- Header `X-Signature`: `hmacSHA256(rawBody, webhookSecret)` en hex.

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
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(body)
  .digest('hex');

await fetch('http://localhost:3000/webhooks/lead', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Company-Id': COMPANY_ID,
    'X-Signature': signature,
  },
  body,
});
```

En **n8n**: un nodo *Crypto* (HMAC-SHA256, hex) sobre el JSON y un *HTTP Request*
con esos headers. La ingesta es **idempotente** por `(empresa, externalId)`: si
reenvías el mismo lead, se actualiza en vez de duplicarse.

### 3.5 Simular una conversación (dev)

Para probar sin WhatsApp real, usa `POST /whatsapp/simulate` (también firmado con
HMAC). Simula un mensaje entrante de un número; el agente responde por el proveedor
`log` (verás la respuesta en la consola del backend). En producción, el webhook de
Meta (`/whatsapp/webhook`) reemplaza a la simulación.

### 3.6 Operar la bandeja (menú **Bandeja**)

- Lista de conversaciones en vivo (refresco cada 4 s), filtrable por estado.
- Entra a un lead para ver el **hilo** (cliente / agente / operador / sistema) y
  el **log de acciones** del agente (qué herramienta usó y con qué resultado).
- **Tomar control**: pausas al agente y respondes tú. **Devolver al agente** lo
  reactiva. (Requiere rol OWNER u OPERADOR.)

### 3.7 Aprobación y mejora continua (menú **Aprobación** / **Prompts**)

El sistema **propone**, tú **apruebas** (el modelo no cambia solo):

- **Vacíos de conocimiento**: preguntas que el agente no supo responder. Editas
  la respuesta y **Aprobar** → se indexa como FAQ.
- **Ejemplos**: buenas respuestas detectadas; al aprobarlas se usan como
  *few-shot*.
- **Prompts**: el playbook semanal propone nuevas versiones de system prompt
  como **inactivas**; en **Prompts** revisas y **Activas** la que quieras.

### 3.8 Métricas (menú **Métricas**)

KPIs del rango (leads, citas, mensajes, escalamientos) y detalle por día. En
**Agentes** tienes además las métricas **comparadas** por agente y los traspasos.

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
