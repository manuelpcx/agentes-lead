# Alertas de proveedores — diseño

Fecha: 2026-10-08 · Estado: para revisión

## 1. Por qué

En una misma semana fallaron dos proveedores y nadie se enteró hasta revisar a
mano por qué el agente "no hacía nada":

- **YCloud sin saldo** (`403 BALANCE_INSUFFICIENT`): ningún WhatsApp salía.
- **Twilio suspendido** (`account … is not active`): ninguna llamada salía.

El objetivo es que el responsable se entere **antes que el cliente final**, sin
revisar logs.

## 2. Lo acordado

Lo que pidió la persona:

- **Destinatario según de quién es la cuenta.** Si falla una cuenta propia de
  la empresa, se avisa al dueño de esa empresa. Si falla una cuenta de la
  plataforma, se avisa a los administradores de la plataforma. Plataforma ve
  todo.
- **Por dónde:** un aviso en el panel mientras dure el problema y un correo al
  empezar. El aviso se cierra solo cuando el proveedor vuelve a funcionar.
- **Cómo se detecta (enfoque A):** observando los envíos reales. Revisar saldos
  de forma periódica (enfoque B) queda para una etapa 2.

Supuestos de diseño (validados en la conversación, sección por sección):

- Un fallo "del mensaje" (teléfono inválido, por ejemplo) no es un problema del
  proveedor y no abre incidentes.
- Los incidentes de la plataforma son uno por proveedor, no uno por empresa.
- Al cliente no se le muestran detalles internos de las cuentas de la
  plataforma.
- También se manda un correo al cerrarse un incidente, si antes se avisó su
  apertura.

**Éxito =** con el YCloud sin saldo de esta semana, el dueño habría recibido un
correo al primer envío fallido y habría visto el aviso rojo en el panel. El
aviso se habría cerrado solo con el primer envío exitoso después de recargar.

## 3. Alcance

**Entra:**

- Detección en los 4 puntos de envío: WhatsApp, correo del agente, voz e IA.
- Incidentes guardados en la base de datos, con apertura y cierre automáticos.
- Correo de apertura y de cierre.
- Aviso en el panel: rojo para la cuenta propia, ámbar para la plataforma.
- Sección **Incidentes** en Plataforma.

**No entra (etapa 2 o después):**

- Consultar saldos o el estado de las cuentas de forma periódica.
- Avisos por WhatsApp o SMS.
- Configurar los umbrales desde el panel.
- Borrar incidentes viejos.
- Vigilar el correo del sistema (`PlatformEmailService`) y los webhooks
  entrantes.

## 4. Clasificación de errores

Cada fallo se clasifica en uno de tres tipos:

| Tipo | Señales | Efecto |
|---|---|---|
| `account` | HTTP 401, 402, 403; códigos o textos conocidos: `BALANCE_INSUFFICIENT`, `not active`, `suspended`, `credit balance is too low`, `insufficient`, `quota` | Abre incidente al **primer** fallo |
| `transient` | HTTP 5xx, 429, error de red o timeout (sin respuesta HTTP) | Abre incidente al llegar a **3 fallos seguidos dentro de 15 min** |
| `request` | Resto de 4xx (400, 404, 422…): teléfono inválido, destinatario no permitido | **No** abre ni cierra incidentes, y no corta la racha de fallos `transient` |

Si el texto trae una señal de cuenta, manda sobre el código HTTP. Por ejemplo,
ElevenLabs reenvía el error de Twilio dentro de una respuesta 4xx genérica, y
se clasifica como `account`.

**Error estructurado.** Nuevo `ProviderError extends Error` con `status?:
number` y `code?: string`.

- Los proveedores que hoy lanzan `new Error('Fallo … (X 403)')` pasan a lanzar
  `ProviderError`: YCloud, Meta, Resend, Retell, Vapi y ElevenLabs.
- El mensaje legible no cambia, así que el aviso en la conversación del lead
  sigue igual.
- Los errores del SDK de Anthropic ya traen `status`.
- El clasificador (`classifyProviderError(error) → { kind, reason }`) acepta
  cualquier `Error`. Si no viene estructurado, cae a leer el texto, para no
  depender de que todos los puntos de lanzamiento estén migrados.

`reason` es el motivo legible para la persona. Los motivos conocidos llevan
además una sugerencia de qué hacer:

| Señal | Motivo | Qué hacer |
|---|---|---|
| `BALANCE_INSUFFICIENT` | La cuenta de YCloud no tiene saldo | Recarga saldo en YCloud |
| `not active` / `suspended` | La cuenta del proveedor está suspendida | Revisa el estado de la cuenta (Twilio, etc.) |
| 401 | El proveedor rechazó la clave | Revisa la clave en Integraciones |
| `credit balance is too low` | La cuenta de IA no tiene crédito | (plataforma) Recarga crédito en Anthropic |

## 5. Dónde se engancha

Una sola llamada en cada punto central de envío, **en segundo plano**: nunca
demora ni rompe el envío, y si falla solo queda en el log.

| Punto | Cuenta | `scope` | `companyId` |
|---|---|---|---|
| `WhatsappService.send` / `sendTemplate` (YCloud, Meta) | de la empresa | `company` | la del contexto |
| `EmailService.send`, rama BYO (Resend o SMTP de la empresa) | de la empresa | `company` | la del contexto |
| `EmailService.send`, rama gestionada o compartida | de la plataforma | `platform` | afectada |
| `VoiceService.startCall`, rama BYO | de la empresa | `company` | la del contexto |
| `VoiceService.startCall`, rama gestionada | de la plataforma | `platform` | afectada |
| `AnthropicService.createMessage` / `complete` | de la plataforma | `platform` | afectada, si hay contexto de empresa |

Los proveedores `log` (desarrollo) no se registran.

## 6. Datos

### Tabla `ProviderIncident` (migración nueva)

```prisma
model ProviderIncident {
  id                 String    @id @default(uuid()) @db.Uuid
  /// Empresa dueña de la cuenta; null = cuenta de la plataforma.
  companyId          String?   @db.Uuid
  scope              String    // 'company' | 'platform'
  service            String    // 'whatsapp' | 'email' | 'voice' | 'llm'
  provider           String    // 'ycloud' | 'meta' | 'resend' | 'smtp' | 'retell' | 'vapi' | 'elevenlabs' | 'anthropic'
  kind               String    // 'account' | 'transient'
  reason             String
  hint               String?
  failureCount       Int       @default(1)
  /// Empresas que sufrieron el incidente (relevante en los de plataforma).
  affectedCompanyIds String[]  @db.Uuid
  openedAt           DateTime  @default(now())
  lastFailureAt      DateTime  @default(now())
  resolvedAt         DateTime?
  openNotifiedAt     DateTime?
  /// Clave permanente (empresa o plataforma + canal + proveedor), para
  /// encontrar incidentes anteriores del mismo proveedor.
  key                String
  /// Copia de `key` mientras está abierto; null al cerrarse.
  /// Único: garantiza un solo incidente abierto por clave.
  openKey            String?   @unique

  company Company? @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, resolvedAt])
  @@index([resolvedAt])
  @@index([key, openedAt])
}
```

- **Clave:** `company:<companyId>:<service>:<provider>` o
  `platform:<service>:<provider>`.
- **Unicidad:** Postgres permite varios `NULL` en un `@unique`, así que los
  incidentes cerrados no chocan entre sí.
- **Aislamiento entre empresas:** la tabla va a `EXENTOS` en
  `tenant-coverage.spec.ts`, con el motivo "companyId opcional (null =
  plataforma); se consulta por raw con companyId explícito". Toda consulta del
  panel filtra explícitamente por la empresa activa.

### Estado efímero en Redis (sin persistencia necesaria)

- `provider-health:streak:<clave>`: fallos `transient` seguidos y el momento
  del primero, con TTL de 15 min. Se borra con un éxito.
- El incidente abierto se busca por `openKey` y el límite de correos (uno
  cada 6 h por clave) por `key`, ambos en la base de datos e indexados. Redis
  queda solo para la racha. (Ajuste hecho al planificar: menos estado
  duplicado.)

Si Redis no está disponible:

- Los errores `account` siguen abriendo incidentes, porque no dependen de Redis.
- Los `transient` no acumulan racha.
- Los incidentes se siguen cerrando con los éxitos.

## 7. Componentes

Nuevo módulo `src/alerts/`:

| Unidad | Qué hace | Depende de |
|---|---|---|
| `provider-error.ts` | `ProviderError` y `classifyProviderError` (función pura) | — |
| `ProviderHealthService` | `success(target)` y `failure(target, error)`: racha, apertura, cierre, contador. Entrega los avisos al notificador | Prisma (raw), Redis |
| `IncidentNotifier` | Arma y envía los correos de apertura y cierre; resuelve destinatarios; aplica el límite de 6 h | `PlatformEmailService`, Prisma (raw), `PANEL_URL` |
| `PanelAlertsController` | `GET /panel/alerts` | Prisma (raw) |
| Endpoint en `PlatformController` | `GET /platform/incidents` | Prisma (raw) |

`target = { service, provider, scope, companyId? }`.

**Destinatarios del correo:**

- `company`: usuarios con `Membership.role = OWNER` en esa empresa.
- `platform`: usuarios con `isPlatformAdmin = true`.

**Flujo de un fallo:**

1. Se clasifica. Si es `request`, termina.
2. Si es `account`, abre. Si es `transient`, suma a la racha y abre solo si
   llega a 3 dentro de 15 min.
3. "Abrir" es un `create` con `openKey`. Si ya existía uno abierto (conflicto
   de unicidad), se incrementa `failureCount` y se agrega la empresa a
   `affectedCompanyIds`.
4. Solo el `create` que gana avisa al notificador.

**Flujo de un éxito:**

1. Borra la racha.
2. Si hay una marca de abierto (o, sin Redis, un incidente abierto en la base),
   cierra: `resolvedAt = now`, `openKey = null`.
3. Si se había avisado la apertura, manda el correo de cierre.

## 8. API

**`GET /panel/alerts`** (cualquier rol de la empresa activa):

```json
{
  "own": [
    { "id": "…", "service": "whatsapp", "provider": "ycloud", "reason": "…",
      "hint": "…", "openedAt": "…", "failureCount": 14 }
  ],
  "platform": [
    { "id": "…", "service": "voice", "openedAt": "…" }
  ]
}
```

- `own`: incidentes abiertos con `companyId = empresa activa`.
- `platform`: incidentes abiertos de plataforma cuyo `affectedCompanyIds`
  incluye a la empresa activa. **Sin** `provider`, `reason` ni `hint`: el
  cliente no ve detalles internos.
- Si quien consulta es administrador de la plataforma, `platform` trae
  **todos** los incidentes de plataforma abiertos (afecten o no a la empresa
  activa), **con** `provider`, `reason` y `hint`, y el panel los muestra en
  rojo.

**`GET /platform/incidents`** (solo administradores de la plataforma):

- Los abiertos más los cerrados en los últimos 7 días.
- Con el nombre de la empresa (o "Plataforma"), la cantidad de empresas
  afectadas y la duración.

## 9. Frontend

**Aviso en `AppLayout`**, sobre el contenido de todas las páginas:

- Consulta `/panel/alerts` al cargar y luego cada 60 s.
- **Rojo** por cada incidente propio: ícono del canal, "WhatsApp no está
  enviando mensajes", el motivo, "Desde hace 2 h · 14 envíos fallidos", la
  sugerencia y un enlace a **Integraciones**.
- **Ámbar** por cada incidente de plataforma, por ejemplo: "Las llamadas tienen
  un problema de nuestra parte; ya lo estamos revisando."
- No se puede descartar mientras siga abierto (se cierra solo).
- `role="alert"` solo al aparecer, sin robar el foco.
- Si la consulta falla, no se muestra nada: un aviso que falla no debe tapar
  el panel.
- Los administradores de la plataforma ven además sus incidentes de
  plataforma en rojo, con el detalle.

**Sección "Incidentes" en `PlatformPage`:**

- Tabla con estado (abierto o cerrado), canal con ícono, proveedor, de quién es
  la cuenta (empresa o "Plataforma"), motivo, desde, duración o "en curso",
  fallos y empresas afectadas.
- Estado vacío: "Sin incidentes en los últimos 7 días".

Textos en `es.json` y `en.json`. Los íconos de canal se reutilizan de
`components/channels.tsx`; la IA usa el ícono `Robot` que ya existe.

## 10. Correos

- **Apertura:**
  - Asunto: "{Canal} no está {enviando mensajes | iniciando llamadas |
    respondiendo} — {Empresa o "Plataforma"}".
  - Cuerpo: motivo, desde cuándo, qué hacer y el enlace
    `PANEL_URL/integrations`, o `PANEL_URL/platform` si es de plataforma.
- **Cierre:** "{Canal} volvió a funcionar. Estuvo con problemas {duración} y
  fallaron {n} envíos."
- **Límite:** como máximo un correo de apertura cada 6 h por clave. El de
  cierre solo sale si antes se avisó la apertura.
- **Enlace:** usa la misma URL del panel que el correo de "recuperar
  contraseña" (`PANEL_URL`, si no `CORS_ORIGIN`). (Ajuste hecho al
  planificar.)

## 11. Casos borde

- **Envíos simultáneos:** la unicidad de `openKey` resuelve la carrera; solo un
  proceso crea el incidente y avisa.
- **Falla el correo de la plataforma:** el aviso por correo no llega. Queda en
  el log y el aviso del panel sigue apareciendo.
- **Arreglo de la cuenta:** el incidente se cierra con el siguiente envío
  exitoso, como máximo 1 h después gracias al reintento del seguimiento.
- **Borrar la empresa:** sus incidentes se borran en cascada.
- **Errores `request` entre fallos `transient`:** no cortan ni suman a la
  racha.
- **Mensaje del lead:** el aviso en la conversación del lead ("Fallo al enviar
  WhatsApp…") no cambia. Este sistema es aparte.

## 12. Pruebas

- **`classifyProviderError`:**
  - Los errores reales de esta semana: YCloud 403 `BALANCE_INSUFFICIENT`, el
    texto de Twilio "not active" dentro de ElevenLabs y el "credit balance is
    too low" de Anthropic.
  - Además: un 500, un 429, un error de red, un 400 de teléfono inválido y un
    `Error` sin estructura.
- **`ProviderHealthService`:**
  - Abre al primer error `account`.
  - Abre al tercer `transient` dentro de 15 min, pero no si el primero tiene
    más de 15 min.
  - `request` no abre.
  - Un solo incidente abierto a la vez (conflicto de unicidad → incrementa).
  - Un éxito cierra el incidente y borra la racha.
  - Sigue funcionando sin Redis.
  - Un error interno no se propaga.
- **`IncidentNotifier`:**
  - Destinatarios correctos (OWNER o administradores).
  - Límite de 6 h.
  - El cierre solo sale si se avisó la apertura.
  - Funciona sin `PANEL_URL`.
- **Los 4 puntos de envío:** registran éxito y fallo con `scope` y `companyId`
  correctos (BYO frente a gestionado), y el envío original se comporta igual
  que antes.
- **Endpoints:**
  - La empresa A no ve los incidentes de la B.
  - `platform` no expone `provider`, `reason` ni `hint` a un usuario normal.
  - Un administrador sí ve todos los de plataforma, con el detalle.
  - `/platform/incidents` es solo para administradores.
- **`tenant-coverage.spec`:** `ProviderIncident` queda exento con su motivo.
- **Frontend:** `pnpm build`, y revisión en el navegador con datos de prueba
  del aviso rojo, del ámbar y de la sección de Plataforma, en escritorio y en
  celular.
- **Verificación final:** lint, build y toda la suite del backend.

## 13. Despliegue

- Una migración nueva (`provider_incidents`), que se aplica sola al arrancar.
- Sin variables nuevas. Usa `PANEL_URL` y el proveedor de correo del sistema
  que ya existen.
- Se documenta en `docs/DESPLIEGUE.md` y `docs/PANEL.md` (y `.en.md`), con
  `sync:guides`.
