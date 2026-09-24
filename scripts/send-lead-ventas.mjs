// Envía un lead de VENTAS de prueba al webhook (firmado HMAC-SHA256).
// Enruta directo al agente de ventas gracias a metadata.tipo = "ventas".
// Cada corrida crea un lead NUEVO (externalId con timestamp) — a propósito,
// para no arrastrar historial de pruebas viejas a la conversación (eso
// contaminó una prueba anterior de cobranza y sesgó al agente).
//
// Uso (PowerShell):
//   $env:COMPANY_ID="<uuid>"; $env:WEBHOOK_SECRET="<secreto>"
//   node scripts/send-lead-ventas.mjs
// Opcional: $env:BACKEND_URL="https://backend-production-9630.up.railway.app"
import { createHmac } from 'node:crypto';

const BACKEND =
  process.env.BACKEND_URL ?? 'https://backend-production-9630.up.railway.app';
const COMPANY_ID = process.env.COMPANY_ID;
const SECRET = process.env.WEBHOOK_SECRET;

if (!COMPANY_ID || !SECRET) {
  console.error('Faltan COMPANY_ID y/o WEBHOOK_SECRET en el entorno.');
  process.exit(1);
}

const lead = {
  externalId: 'ventas-' + Date.now(), // idempotencia + lead siempre nuevo
  name: 'Lead Demo Ventas',
  phone: '+56911113111', // debe coincidir con $env:PHONE al simular WhatsApp
  email: 'demo@example.com',
  source: 'landing-demo',
  preferredChannel: 'whatsapp',
  timezone: 'America/Santiago',
  // "tipo" enruta al agente de ventas (ver src/agents/infer-agent-type.ts).
  metadata: { tipo: 'ventas' },
};

const body = JSON.stringify(lead);
// Firma v2: el timestamp entra en la firma (ver docs/GUIA_DE_USO.md §3.3).
const timestamp = String(Date.now());
const signature = createHmac('sha256', SECRET)
  .update(`${timestamp}.`)
  .update(body)
  .digest('hex');

const res = await fetch(`${BACKEND}/webhooks/lead`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Company-Id': COMPANY_ID,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  },
  body,
});

console.log('HTTP', res.status);
console.log(await res.text());
