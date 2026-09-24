// Envía un lead de prueba al webhook con firma HMAC-SHA256.
// Uso (PowerShell):
//   $env:COMPANY_ID="<uuid>"; $env:WEBHOOK_SECRET="<secreto>"; node scripts/send-test-lead.mjs
// Opcional: $env:BACKEND_URL="https://backend-production-9630.up.railway.app"
import { createHmac } from 'node:crypto';

const BACKEND =
  process.env.BACKEND_URL ??
  'https://backend-production-9630.up.railway.app';
const COMPANY_ID = process.env.COMPANY_ID;
const SECRET = process.env.WEBHOOK_SECRET;

if (!COMPANY_ID || !SECRET) {
  console.error('Faltan COMPANY_ID y/o WEBHOOK_SECRET en el entorno.');
  process.exit(1);
}

// Solo campos válidos del DTO (el backend rechaza propiedades extra).
const lead = {
  externalId: 'test-' + Date.now(), // idempotencia por empresa
  name: 'Lead de Prueba',
  phone: '+56911111111', // formato E.164
  email: 'prueba@example.com',
  source: 'prueba-manual',
  preferredChannel: 'whatsapp',
  metadata: { origen: 'script de prueba' },
};

// CLAVE: se firma EXACTAMENTE el mismo string que se envía como body.
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
