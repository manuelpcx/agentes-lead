# Despliegue — Railway (backend) + Vercel (frontend), por CLI

Arquitectura en producción:

```
Navegador ── https ──> Vercel (panel React)  ── /panel,/auth ──>  Railway (API NestJS)
                                                                   ├─ PostgreSQL + pgvector
                                                                   └─ Redis (colas BullMQ)
```

El backend (con sus colas y crons) va en **Railway**; el panel estático va en
**Vercel**. El repo ya quedó listo: `Dockerfile`, `railway.json`,
`frontend/vercel.json` y CORS configurable por env.

> Estos pasos requieren **tus cuentas** (login interactivo en el navegador) y
> **tus secretos**. Ejecútalos tú; aquí están los comandos exactos.

---

## 0. Prerrequisitos

```bash
# CLIs
npm i -g @railway/cli vercel

# Genera secretos fuertes (guárdalos)
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 32   # JWT_SECRET
```

Necesitas cuentas en [railway.app](https://railway.app) y [vercel.com](https://vercel.com).

---

## 1. Backend en Railway

### 1.1 Crear el proyecto

```bash
cd C:/Users/Zenta/Documents/agentes-lead
railway login            # abre el navegador
railway init             # crea el proyecto (elige un nombre)
```

### 1.2 Base de datos con **pgvector** (paso crítico ⚠️)

El Postgres estándar de Railway **no trae pgvector**, y la primera migración hace
`CREATE EXTENSION vector` → fallaría. Usa una imagen con pgvector:

**Opción recomendada (dashboard):** en tu proyecto → **New → Database → Add
PostgreSQL**; si esa imagen no soporta `vector`, en su lugar **New → Empty
Service → Deploy from Docker Image** con `pgvector/pgvector:pg16`. También existe
la plantilla comunitaria **"pgvector"** (New → Template → busca "pgvector").

Añade Redis (sí viene listo):

```bash
railway add --database redis
```

> Verifica pgvector conectándote y corriendo `CREATE EXTENSION IF NOT EXISTS vector;`
> (la migración lo hará sola si la imagen lo soporta).

### 1.3 Variables de entorno del backend

En el **servicio del backend** (dashboard → Variables, o por CLI). `DATABASE_URL`
y `REDIS_URL` se referencian desde los servicios de BD/Redis:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}      # referencia al servicio Postgres
REDIS_URL    = ${{Redis.REDIS_URL}}            # referencia al servicio Redis
ENCRYPTION_KEY = <hex de 32 bytes>
JWT_SECRET     = <string largo>
NODE_ENV       = production
# Opcionales (el agente degrada sin la primera):
ANTHROPIC_API_KEY = sk-ant-...
EMBEDDINGS_PROVIDER = local        # o 'voyage' + VOYAGE_API_KEY
# CORS: se completa en el paso 3, cuando tengas la URL de Vercel
```

Por CLI (ejemplo):

```bash
railway variables --set "ENCRYPTION_KEY=xxxx" --set "JWT_SECRET=yyyy" --set "NODE_ENV=production"
```

> `PORT` lo inyecta Railway automáticamente; la app ya lo lee de env.

### 1.4 Desplegar

```bash
railway up              # construye el Dockerfile y despliega
railway domain          # genera una URL pública (https://<algo>.up.railway.app)
```

Al arrancar corre `prisma migrate deploy` (crea tablas, la extensión vector y el
índice HNSW). Revisa `railway logs`; deberías ver "API escuchando…".
Prueba: `curl https://<tu-backend>.up.railway.app/health`.

---

## 2. Frontend en Vercel

```bash
cd frontend
vercel login            # abre el navegador
vercel link             # crea/enlaza el proyecto (framework Vite autodetectado)

# Apunta el panel al backend de Railway
vercel env add VITE_API_URL production
# pega: https://<tu-backend>.up.railway.app

vercel --prod           # despliega a producción
```

Copia la URL resultante (`https://<tu-panel>.vercel.app`). El `vercel.json` ya
incluye los *rewrites* SPA (rutas como `/agents` no dan 404).

---

## 3. Cerrar el círculo (CORS)

En Railway, fija el origen permitido al dominio de Vercel y redepliega:

```bash
railway variables --set "CORS_ORIGIN=https://<tu-panel>.vercel.app"
railway up
```

(Si usas dominio propio en Vercel, agrégalo también, separado por coma.)

---

## 4. Checklist post-despliegue

1. Abre `https://<tu-panel>.vercel.app` → **Regístrate** (crea empresa + guarda el `webhookSecret`).
2. Carga conocimiento y configura agentes (ver [GUIA_DE_USO.md](GUIA_DE_USO.md)).
3. Apunta tu fuente de leads (n8n / CRM) a `https://<tu-backend>.up.railway.app/webhooks/lead` (firma HMAC).
4. Si usas WhatsApp real: configura el webhook de Meta a `https://<tu-backend>.up.railway.app/whatsapp/webhook` con `WHATSAPP_VERIFY_TOKEN`.

---

## 5. Notas y limitaciones

- **pgvector es obligatorio** en el Postgres (ver 1.2). Es el error de despliegue más común.
- **Una sola instancia del backend**: incluye las colas y los **crons** (seguimiento,
  análisis nocturno). Escalar a >1 réplica duplicaría los crons; si necesitas escalar,
  separa el worker en otro servicio con los crons desactivados.
- `migrate deploy` corre en cada arranque (idempotente). Con 1 instancia no hay carrera.
- **Filesystem efímero** en Railway: no guardes archivos en disco de forma persistente
  (usa un bucket/volumen si más adelante subes archivos).
- Redeploys automáticos: si luego conectas el repo de GitHub en Railway/Vercel, cada
  `git push` desplegará solo. Por CLI, redepliegas con `railway up` / `vercel --prod`.
