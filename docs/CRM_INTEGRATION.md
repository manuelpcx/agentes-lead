# Conectar cualquier CRM

El agente puede **avisar a tu CRM** cuando pasa algo relevante con un lead
(webhooks salientes), y tu CRM puede **alimentar datos al agente** (ya
funciona hoy vía `POST /webhooks/lead`, ver `docs/DESPLIEGUE.md` / el flujo de
n8n existente). No hay un conector por CRM: hablamos un lenguaje genérico
(webhooks firmados) y tú lo mapeas a tu CRM con **n8n, Zapier, Make, o código
propio** — cualquier herramienta que reciba un webhook y tenga (o pueda
llamar) la API de tu CRM sirve.

## 1. Saliente — el agente avisa a tu CRM

### Setup
En el panel: **Integraciones → CRM**, pega la URL de tu webhook (ej. el
trigger de un flujo de n8n) e inventa un **secreto de firma** (cualquier
string; TÚ lo eliges, no viene de tu CRM). Guarda y usa **"Probar conexión"**
— manda un evento real `test.ping` a tu URL, firmado, para que puedas armar
el mapeo en tu flujo con un ejemplo real.

### Formato del payload
Cada evento es un `POST` con este cuerpo:

```json
{
  "event": "lead.status_changed",
  "companyId": "uuid-de-tu-empresa",
  "leadId": "uuid-interno-del-lead",
  "externalId": "el-id-que-tú-nos-diste-al-crear-el-lead",
  "occurredAt": "2026-09-05T14:30:00.000Z",
  "data": { "...": "específico de cada evento, ver abajo" }
}
```

`externalId` es el id que tu sistema le dio al lead al crearlo (el mismo
`externalId` del webhook de entrada) — úsalo para encontrar el registro
correcto en tu CRM sin depender de nuestro `leadId` interno.

### Eventos disponibles (v1)

| Evento | Cuándo | `data` |
|---|---|---|
| `lead.status_changed` | Cambia el estado del lead (incluye agendado, escalado a humano, cerrado ganado/perdido) | `{ from, to }` (valores del embudo: NUEVO, CONTACTADO, EN_CONVERSACION, AGENDADO, CERRADO_GANADO, CERRADO_PERDIDO, ESCALADO_HUMANO) |
| `lead.appointment_scheduled` | Se agenda una cita | `{ title, startAt, endAt, location }` (fechas ISO 8601) |
| `lead.promise_to_pay` | (Cobranza) el deudor promete pagar en una fecha | `{ fecha, monto?, nota? }` |
| `test.ping` | Solo lo manda "Probar conexión" | `{ mensaje }` |

### Verificar la firma
Cada request trae el header `X-Signature`: HMAC-SHA256 del **cuerpo crudo**
(el JSON tal cual, sin reformatear) usando el secreto que definiste. Mismo
esquema que usamos para verificar YCloud/Retell, en el sentido inverso.

En un nodo Code de n8n:

```js
const crypto = require('crypto');
const secret = 'el-secreto-que-pegaste-en-el-panel';
const body = $input.first().json; // ojo: debe ser el string crudo, no el objeto reparseado
const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
const received = $input.first().headers['x-signature'];
if (expected !== received) {
  throw new Error('Firma inválida');
}
```

*(Nota: si tu herramienta de automatización no te da el cuerpo crudo tal cual
llegó — algunas reparsean el JSON con otro orden de claves — la comparación
puede fallar aunque la petición sea legítima. Si te pasa, dinos y evaluamos
alternativas.)*

### Reintentos
Si tu endpoint no responde `2xx`, reintentamos hasta 5 veces con backoff
exponencial (unos minutos entre intento e intento). Si tu flujo está caído,
no perderás el evento — pero tampoco lo esperes en tiempo real si tu servidor
tardó en volver.

## 2. Entrante — tu CRM alimenta al agente

Ya funciona: `POST /webhooks/lead` (firmado HMAC con tu `webhookSecret` de
empresa) crea o actualiza un lead por `externalId`. Cualquier campo dentro de
`metadata` queda disponible para que el agente lo use como contexto (ej. la
etapa del negocio, el valor de la oportunidad, la deuda si es cobranza).

Una actualización con `metadata` parcial **mezcla** con lo que ya había —no lo
reemplaza— así que puedes sincronizar solo el campo que cambió sin perder el
resto.

## 3. (Próximamente) Consulta en vivo durante la conversación

Hoy el agente NO puede preguntarle a tu CRM algo en tiempo real a mitad de una
conversación (solo usa lo que ya está en `metadata`). Es la siguiente pieza
planeada — pídenosla si la necesitas antes.
