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

Imprime el `agent_id`. El prompt vive en `scripts/retell-prompt.mjs` (compartido
con `update-retell-prompt.mjs`, ver más abajo); para cambiarlo, edítalo ahí —
no hace falta tocar `setup-retell.mjs`.

### 3. Retell — webhook
En Retell, apunta el webhook del agente a:
`https://TU-BACKEND/voice/retell/webhook`

### 4. Panel — Integraciones → Voz
Las credenciales son **por empresa** (BYO), NO variables de entorno de
Railway. En el panel, cada empresa entra a **Integraciones → Voz**, elige
proveedor "Retell" y pega:
- **API key** (secreto, cifrado en reposo)
- **Número** (E.164, el mismo `RETELL_FROM_NUMBER` de arriba)
- **Agent ID** (el `agent_id` que imprimió el script)

Guarda y prueba con el botón "Probar conexión". Sin esto configurado, la
empresa no puede llamar (el canal de voz queda inactivo para ella).

### 5. Actualizar el prompt de un agente ya creado
Si ya tienes un `agent_id` funcionando y solo quieres cambiar el prompt (sin
crear un agente duplicado ni tocar el Agent ID guardado en el panel):

```powershell
$env:RETELL_API_KEY="key_..."
$env:RETELL_AGENT_ID="agent_..."   # el mismo que tienes en Integraciones
node scripts/update-retell-prompt.mjs
```

Edita `scripts/retell-prompt.mjs` primero si quieres cambiar el contenido.

## Voz y tono por empresa (multiempresa)

Cada empresa configura su **voz y tono** desde el panel (Configuración de la
empresa → sección "Voz del agente"). Se guarda en `channelsConfig.voice` y se
aplica **por llamada** vía `agent_override` de Retell — un solo agente base
sirve a todas las empresas.

Campos:
- **Voz** (`voiceId`): del catálogo de Retell. El panel lo lista desde
  `GET /panel/voice/voices` (proxy a `list-voices`, usa la API key de esa
  empresa guardada en Integraciones → Voz).
- **Tono/estilo** (`tone`): se inyecta en el prompt como la variable `{{tono}}`
  (por eso el prompt del agente base debe incluir `{{tono}}` — ver
  `scripts/retell-prompt.mjs`).
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
