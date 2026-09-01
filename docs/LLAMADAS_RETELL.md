# Llamadas de voz con Retell + Twilio

El módulo de voz (`src/voice/`) es pluggable (`VOICE_PROVIDER`: `log` | `vapi` |
`retell`). Con **Retell** el agente de voz completo (prompt/voz/LLM) vive en
Retell; nuestro backend solo **dispara** la llamada, le pasa el contexto del
lead como variables dinámicas, y recibe la transcripción por webhook.

## Cómo funciona el flujo

```
agente decide / lead pide / escalera de seguimiento
   → tool iniciarLlamada → Retell (create-phone-call, from = número Twilio)
   → Retell conversa solo con el lead
   → webhook /voice/retell/webhook (call_analyzed)
   → guardamos transcripción + resumen como Interaction(call, inbound)
   → despertamos al agente para seguir por texto (si hubo conversación)
```

Disparo de la llamada:
- **El agente** cuando el lead está caliente o el texto no avanza (`iniciarLlamada`).
- **El lead lo pide** ("llámame") → llamada inmediata.
- **El lead agenda** ("llámame a las 5") → `iniciarLlamada` con `programarEnMinutos`;
  el seguimiento la dispara a esa hora (respeta horario hábil).
- **Escalera de seguimiento** si pones `call` en `FOLLOWUP_CHANNEL_LADDER`.

## Setup (una vez)

### 1. Twilio — Elastic SIP Trunk
Retell marca **desde** tu número de Twilio vía un Elastic SIP Trunk (BYO).
En la consola de Twilio:
1. Compra/ten un número (con capacidad de **voz**).
2. **Elastic SIP Trunking → Trunks → crear** un trunk.
3. En **Termination**, define un *Termination SIP URI* (algo como
   `tu-trunk.pstn.twilio.com`). Anótalo — es el `TWILIO_TERMINATION_URI`.
4. (Recomendado) En **Termination → Authentication**, crea credenciales SIP
   (usuario/clave) → `SIP_AUTH_USER` / `SIP_AUTH_PASS`.
5. Asocia tu número al trunk (**Numbers**).

### 2. Retell — agente + importar número (script)
Con tu `RETELL_API_KEY`, corre el script (crea LLM + agente e importa el número):

```powershell
$env:RETELL_API_KEY="key_..."
$env:RETELL_FROM_NUMBER="+56XXXXXXXXX"
$env:TWILIO_TERMINATION_URI="tu-trunk.pstn.twilio.com"
$env:SIP_AUTH_USER="..."; $env:SIP_AUTH_PASS="..."   # si creaste credenciales
node scripts/setup-retell.mjs
```

Imprime el `RETELL_AGENT_ID`. Puedes ajustar el prompt/voz editando el script o
directamente en el dashboard de Retell.

### 3. Retell — webhook
En Retell, apunta el webhook del agente a:
`https://TU-BACKEND/voice/retell/webhook`

### 4. Railway — variables del backend
```
VOICE_PROVIDER=retell
RETELL_API_KEY=key_...
RETELL_AGENT_ID=agent_...
RETELL_FROM_NUMBER=+56XXXXXXXXX
```
Redeploy (`railway up`).

## Voz y tono por empresa (multiempresa)

Cada empresa configura su **voz y tono** desde el panel (Configuración de la
empresa → sección "Voz del agente"). Se guarda en `channelsConfig.voice` y se
aplica **por llamada** vía `agent_override` de Retell — un solo agente base
sirve a todas las empresas.

Campos:
- **Voz** (`voiceId`): del catálogo de Retell. El panel lo lista desde
  `GET /panel/voice/voices` (proxy a `list-voices`, requiere `RETELL_API_KEY`).
- **Tono/estilo** (`tone`): se inyecta en el prompt como la variable `{{tono}}`
  (por eso el prompt del agente base debe incluir `{{tono}}` — ya lo hace el de
  `setup-retell.mjs`).
- **Saludo inicial** (`beginMessage`): puede usar `{{nombre}}` / `{{empresa}}`.
- **Idioma** (`language`) y **velocidad** (`speed`, 0.5–2).

Mapeo por llamada: `voiceId`/`speed`/`language` → `agent_override.agent`;
`beginMessage` → `agent_override.retell_llm.begin_message`; `tono` →
`retell_llm_dynamic_variables`. Lo que no se configura, cae al default del
agente base.

## Notas
- **Verificación de firma** del webhook (`x-retell-signature`) queda pendiente,
  igual que en WhatsApp/YCloud. La correlación exige `companyId`+`leadId` en la
  metadata, que solo nosotros enviamos al iniciar la llamada.
- El backend actúa sobre el evento **`call_analyzed`** (trae transcripción y
  análisis); ignora `call_started`/`call_ended` para no duplicar.
- Una llamada **sin respuesta** se registra en el hilo pero **no** despierta al
  agente (no hay nada que retomar).
