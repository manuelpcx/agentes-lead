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
4. Si usas WhatsApp real: configura el webhook de Meta a `https://<tu-backend>.up.railway.app/whatsapp/webhook` con `WHATSAPP_VERIFY_TOKEN`, **y pega el App Secret** de tu app de Meta en Integraciones → WhatsApp → "Secreto de firma del webhook" (con YCloud, el secreto del Webhook Endpoint). **Sin ese secreto los mensajes entrantes se rechazan** — es lo que impide que cualquiera le hable al agente haciéndose pasar por un cliente.

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

## Cambios de seguridad (2026-09-17) — qué revisar antes de subir

Esta versión endurece varias cosas que **rompen el arranque o cortan tráfico**
si no se preparan antes:

1. **`JWT_SECRET` de al menos 32 caracteres.** Si el de producción es más
   corto, la API **no arranca** (validación fail-fast). Genera uno nuevo:
   `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
   Cambiarlo cierra todas las sesiones del panel (la gente vuelve a entrar).
2. **Migraciones pendientes**: `lead_notes`, `api_keys` y `password_reset`
   (`npx prisma migrate deploy`). Sin la última, login y cambio de contraseña
   fallan.
3. **Webhooks de WhatsApp y voz exigen firma.** Meta necesita el App Secret y
   YCloud el secreto del Webhook Endpoint, pegados en Integraciones → WhatsApp;
   Vapi, el "Server URL Secret" en Integraciones → Voz. **Sin eso los
   mensajes entrantes se rechazan.**
4. **Firma de entrada con timestamp** (`X-Timestamp`, ver `GUIA_DE_USO.md`
   §3.3). El esquema viejo sigue aceptándose mientras
   `WEBHOOK_REQUIRE_TIMESTAMP=false`; migra los flujos de n8n y luego ponlo en
   `true`.
5. **`PANEL_URL`**: la URL pública del panel, para los enlaces de "recuperar
   contraseña". Si falta se usa el primer origen de `CORS_ORIGIN` (que en
   producción debe estar seteado igual).
6. **Correo de la plataforma** para recuperar contraseña: `EMAIL_PROVIDER` +
   `RESEND_API_KEY` (o `SMTP_*`) y `EMAIL_FROM`. Con `log`, el enlace solo se
   imprime en los logs del backend.
7. **Cabeceras de seguridad y CSP** del panel vienen en `frontend/vercel.json`.
   La CSP permite `connect-src https:`; si quieres cerrarla al dominio exacto
   del backend, cámbialo ahí.
8. **Dependencias**: `pnpm-workspace.yaml` fija versiones parchadas de
   `multer`, `lodash`, `qs` y `body-parser`. Los dos avisos que quedan
   (`file-type`, `@nestjs/core`) solo se cierran con NestJS 11; no afectan
   código que usemos.

## Comportamiento del agente (2026-09-22)

Cambios en cómo el agente atiende las conversaciones. **Ninguno exige tocar el
despliegue**: todos traen un valor por defecto que funciona tal cual.

- **Ventana de agrupación de mensajes** (`AGENT_TURN_DEBOUNCE_MS`, por defecto
  `8000`). El agente espera 8 s antes de responder para juntar las ráfagas de
  mensajes seguidos y contestar una sola vez. Súbela si los clientes escriben
  muy fragmentado; bájala (o ponla en `0`) si prefieres respuesta inmediata por
  cada mensaje.
- **Un turno por lead a la vez.** Se toma un candado en Redis
  (`agent-turn-lock:<leadId>`, TTL ≈2 min) para que dos mensajes no generen dos
  respuestas en paralelo. Si Redis no responde, el candado falla abierto: el
  agente sigue contestando, como antes.
- **Audios, imágenes, documentos y ubicaciones** ya no se descartan: quedan en
  el historial como marcadores (`[El cliente envió un audio]`) y el agente
  responde pidiendo esa información por escrito. Los toques de botón y las
  respuestas de listas ahora se leen como texto del cliente.
- **Cada mensaje del historial va anotado** con su canal, cuánto hace que
  ocurrió y, si la escribió una persona del equipo desde la bandeja, la marca
  "Operador". Las anotaciones se arman al momento de llamar al modelo: **no se
  guardan** en la base ni cambian lo que ve el operador en el panel.
- **Antecedentes del lead en el prompt**: citas vigentes, las últimas notas del
  equipo y un resumen de las acciones previas del agente. De las acciones va
  solo qué hizo, nunca el resultado, para que el guardrail de "ninguna cifra sin
  respaldo de este turno" siga intacto.
- **Caché de prompt**: el prompt del agente, las políticas y las definiciones de
  herramientas se envían como un bloque estable con `cache_control`. La API
  reutiliza ese prefijo entre las iteraciones de un mismo turno y entre turnos
  cercanos, lo que baja costo y latencia. No hay nada que configurar.
- **El agente ve las últimas 30 interacciones**, no las 30 primeras. Antes, en
  conversaciones largas, respondía a un mensaje viejo.

## Memoria del lead (2026-09-22)

- **Migración nueva: `lead_memory`.** Es la cuarta pendiente, junto con
  `lead_notes`, `api_keys` y `password_reset`. Aplícalas con
  `npx prisma migrate deploy`. Sin ella, el detalle del lead y los turnos del
  agente fallan al leer la memoria.
- **Cola nueva `lead-memory`** en Redis. No requiere configuración: se registra
  sola con las demás. Si no hay `ANTHROPIC_API_KEY`, el resumen no se genera y
  todo lo demás sigue igual.
- **Costo.** El resumen es una llamada adicional al modelo cada 10
  interacciones de un mismo lead, con esfuerzo bajo y fuera del turno. Para
  cambiar la frecuencia, `REFRESH_EVERY_INTERACTIONS` en
  `src/memory/lead-memory.service.ts`.
- **Herramienta nueva `guardarEnMemoria`.** Queda habilitada por defecto en los
  agentes nuevos. Para los agentes que ya existen, agrégala en **Agentes →
  Herramientas** si quieres que la usen.
- **Las conversaciones ahora se cierran.** `Conversation.endedAt` no lo escribía
  nadie, así que el análisis nocturno evaluaba charlas a medias y las marcaba
  como analizadas para siempre. Ahora se cierran tras 24 h de silencio y solo se
  analizan las cerradas. La primera noche después de desplegar se cerrará de
  golpe todo lo que lleve más de un día inactivo, y el análisis procesará hasta
  50 por noche.

## Tour de bienvenida (2026-09-22)

- **Migración nueva: `user_onboarding`.** Es la quinta pendiente, junto con
  `lead_notes`, `api_keys`, `password_reset` y `lead_memory`. Agrega
  `User.onboardingCompletedAt`.
- **Los usuarios que ya existen lo ven una vez.** La columna queda en NULL a
  propósito, así que la próxima vez que entren les sale el recorrido. Se salta
  con un clic y queda marcado. Si prefieres que solo lo vean las cuentas
  nuevas, corre una vez:
  `UPDATE "User" SET "onboardingCompletedAt" = now();` después de migrar.
- Se guarda en el usuario y no en el navegador, para que quien ya lo hizo no lo
  vea de nuevo al entrar desde otro equipo. Endpoint:
  `POST /auth/onboarding-complete`.

## Despliegue de las guías (2026-09-22)

Dos arreglos que salieron de un `vercel --prod` fallido.

- **`docs/` ahora entra en la imagen del backend.** Estaba en `.dockerignore`,
  así que el asistente de ayuda venía corriendo **sin documentación** en
  producción: `HelpService` la lee de `docs/` en runtime, no la compila. Se
  quitó esa línea. Son ~60 KB de markdown.
- **El frontend ya no importa desde `docs/`.** Vercel sube solo la carpeta
  `frontend/`, así que ese import compilaba en local y fallaba en el deploy
  con `Could not resolve "../../../docs/PANEL.md?raw"`. Ahora usa una copia en
  `frontend/src/content/`.

La guía se edita **siempre** en `docs/PANEL.md` y `docs/PANEL.en.md`. Después:

```bash
npm run sync:guides
```

Si se te olvida, `src/help/guides-sync.spec.ts` falla y te lo recuerda.

## Mantenedor de la plataforma (2026-09-23)

- **Migración nueva: `platform_admin`.** Es la sexta pendiente. Agrega
  `User.isPlatformAdmin`, en `false` para todos.
- **Nadie es administrador hasta que lo marques a mano.** Después de migrar:

  ```sql
  UPDATE "User" SET "isPlatformAdmin" = true WHERE email = 'tu@correo.cl';
  ```

- Es la cuenta más sensible del sistema: detrás de ese permiso se ve el
  listado de todos los clientes. Conviene que tenga contraseña propia y fuerte,
  y que no se comparta.
- El permiso se consulta **en cada petición**, no va en el token: quitarlo
  tiene efecto inmediato, sin esperar a que caduque la sesión.
- Lo que escribe la plataforma (crear demo, activar o desactivar una empresa)
  queda en `AuditLog` con el usuario que lo hizo.
- **No expone conversaciones ni datos de leads**, a propósito. Si alguna vez
  hace falta para soporte, que sea una acción aparte y registrada.

## Piso legal de cobranza (2026-09-24)

Riesgo legal corregido: con la cadencia por defecto (`FOLLOWUP_DELAYS_HOURS`
= `12,48,72`), un agente de cobranza contactaba por segunda vez 12 h después de
la primera. El art. 37 de la Ley 19.496
(<https://www.bcn.cl/leychile/navegar?idNorma=61438>) exige más separación.
**No hay migración ni variables nuevas.**

### Qué se aplica

Solo a agentes de tipo **COBRANZA**, y por encima de cualquier configuración
(global, del agente o `businessHours` de la empresa):

| Límite | Valor |
|---|---|
| Mensajería (WhatsApp + correo) | máx. 2 gestiones proactivas por semana calendario (lunes a domingo) |
| Separación entre mensajes | al menos 48 h |
| Llamadas | máx. 1 proactiva por semana calendario |
| Horario | lunes a sábado, sin festivos, 8:00–20:00 en la zona del lead (o de la empresa) |
| Espaciado entre seguimientos | nunca menos de 48 h, aunque `delaysHours` diga menos |

El horario legal se exige **además** del horario de la empresa: si
`businessHours` es más amplio (o no está configurado), manda la ley; si es más
estricto, manda la empresa.

### Qué cuenta como gestión proactiva

- Cuenta: lo que el agente envía en un turno de **seguimiento** (primer
  contacto, reintentos, verificación de promesa de pago) y las **plantillas de
  WhatsApp** del seguimiento. Esas interacciones quedan marcadas con
  `Interaction.metadata.gestion = "proactiva"` (con cualquier tipo de agente,
  para que el conteo exista si un agente pasa a ser de cobranza). De ahí salen
  los conteos semanales.
- No cuenta: las **respuestas** a mensajes del deudor (y no tienen restricción
  de horario: si escribe a las 22:00, se le contesta), ni la **llamada que el
  propio deudor pidió** agendar.
- Las **llamadas de cobranza** van en horario legal siempre, las pida quien
  las pida. Si el deudor pide una hora fuera del tramo, la llamada se agenda
  para el primer momento permitido y el agente se lo dice. En un seguimiento,
  el agente no puede agendar llamadas por su cuenta (sería una forma de saltar
  el tope semanal).

### Dónde se aplica

- `FollowUpService.processFollowUp`: antes de despertar al agente o enviar una
  plantilla. Si el contacto pasaría un límite, reprograma para el primer
  momento válido con `nextActionType = "limite_legal"` y **no cuenta el
  intento**. Las llamadas agendadas y las promesas de pago conservan su tipo.
- `enviarWhatsApp`, `enviarCorreo` e `iniciarLlamada`: repiten el control en
  el momento del envío, para cubrir un segundo mensaje en el mismo turno. Si
  bloquean, responden `LÍMITE LEGAL DE COBRANZA` y cortan el turno.
- Lógica en `src/followup/collection-floor.ts` (topes) y
  `src/followup/business-hours.ts` (horario legal, feriados, semana
  calendario).

### Al desplegar

- **Historial sin marcar.** Lo enviado antes de este cambio no tiene la marca.
  Para la separación de 48 h se usa además `Lead.lastContactedAt` (último
  intento de seguimiento), así que un lead contactado hace poco no recibe otro
  mensaje al día siguiente del despliegue. El tope semanal, en cambio, solo
  cuenta lo marcado: en la semana del despliegue un deudor podría recibir hasta
  2 gestiones además de las que ya tenía. Para no tener ese margen, despliega un
  domingo o el lunes antes de las 8:00, cuando la semana parte limpia.
- **Feriados.** La lista está en `FERIADOS_CHILE`
  (`src/followup/business-hours.ts`) para 2026 y 2027, solo los nacionales (no
  los regionales de Arica y Chillán). **Hay que agregar 2028 antes del 1 de
  enero de 2028**: el test `hay calendario cargado para el año en curso` falla
  cuando falta el año. Si igual llegara a faltar, se respetan al menos los
  feriados de fecha fija. Los feriados por elecciones se agregan a mano.
- **Interpretación.** La ley habla de "dos días" de separación; se aplica como
  48 h corridas. El borrador de reglamento (no vigente) habla de 2 días hábiles
  completos: si entra en vigencia, hay que revisar
  `COBRANZA_MIN_GAP_HOURS`.

### Prompt de cobranza

`COBRANZA_PROMPT` (`src/prompts/default-prompts.ts`) ahora prohíbe mencionar
registros comerciales (DICOM, Boletín Comercial) y consecuencias de juicios no
iniciados, y obliga a aclarar que la cobranza extrajudicial no es un
procedimiento que persiga la ejecución de los bienes del deudor.

**Solo afecta a los agentes que se creen desde ahora.** Cada agente guarda su
propia copia en `PromptVersion` al crearse. Para los agentes de cobranza que ya
existen:

- Si nunca les editaron el prompt: **Agentes → Prompts → Restablecer al prompt
  por defecto** (queda como versión nueva; la anterior sigue en el historial).
- Si lo personalizaron: restablecer borraría esos cambios. Mejor edítalo a
  mano y agrega estas líneas en la sección de cumplimiento:

  ```text
  - Aclara que se trata de una cobranza extrajudicial y que no es un procedimiento que persiga la ejecución de los bienes del deudor: dilo en el primer contacto y cada vez que la persona pregunte qué pasa si no paga.
  - PROHIBIDO por ley (Ley del Consumidor, art. 37): mencionar registros comerciales o de morosidad (DICOM, Boletín Comercial u otros) y mencionar consecuencias de juicios que no se han iniciado (demandas, embargos, remates). No los uses ni como advertencia ni como "información".
  ```

El prompt nombra la ley sin su número a propósito: el guardrail de salida
bloquea cifras de 4 o más dígitos sin respaldo, y si el agente citara "19.496"
el mensaje se bloquearía y el lead pasaría a una persona.

## URL del webhook en Integraciones (2026-09-24)

El cliente ya no tiene que adivinar la ruta: en **Integraciones → WhatsApp** (y
**Voz**), al elegir el proveedor, el panel muestra la URL del webhook con botón
de copiar y los pasos para su proveedor.

| Proveedor | URL que se muestra |
|---|---|
| YCloud | `<backend>/whatsapp/ycloud/webhook` (evento `whatsapp.inbound_message.received`) |
| Meta | `<backend>/whatsapp/webhook` (campo `messages`) + token de verificación |
| Retell | `<backend>/voice/retell/webhook` (evento `call_analyzed`) |
| Vapi | `<backend>/voice/vapi/webhook` (mensaje `end-of-call-report`) |

- **Endpoint nuevo:** `GET /panel/integrations/webhooks`, solo OWNER (los demás
  roles no pueden guardar integraciones, así que no ven la guía).
- **`PUBLIC_API_URL` (opcional, nueva).** Es la URL pública del backend que se
  muestra. Si falta, se deduce de la petición del panel con las cabeceras del
  proxy (`X-Forwarded-Proto`/`X-Forwarded-Host`), que en Railway y Cloud Run da
  la URL correcta. Conviene fijarla cuando haya dominio propio
  (`https://api.tu-dominio.cl`) o si el panel llega al backend por otra ruta.
- **Meta usa `WHATSAPP_VERIFY_TOKEN`**, que es uno solo para toda la plataforma.
  El panel se lo muestra al dueño de cada empresa para que lo pegue en Meta. Si
  no está configurado, el panel avisa que falta. Solo sirve para el apretón de
  manos de la suscripción: los mensajes se validan con el App Secret de cada
  empresa.
- **Las rutas están en un solo lugar** (`src/integrations/webhook-urls.ts`) y
  un test compara con las que registran los controllers: si alguien cambia una
  ruta, el test falla antes de que el panel muestre una URL que no existe.

**Número para enrutar la entrada.** La URL es la misma para todas las empresas:
cada mensaje se asigna a la empresa por `Company.channelsConfig.whatsapp`
(número de negocio con YCloud, Phone Number ID con Meta), que antes se cargaba
aparte en **Configuración**. Si faltaba ahí, el cliente dejaba todo bien
configurado y los mensajes se descartaban sin aviso. Ahora, al guardar la
integración de WhatsApp, ese dato se copia solo (el número se normaliza a
E.164: `+56 9 1111 1111` → `+56911111111`). No toca el resto de
`channelsConfig`. Las empresas que ya tenían la integración lo reciben la
próxima vez que guarden.
