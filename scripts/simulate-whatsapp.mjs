// Simula un mensaje ENTRANTE de WhatsApp del cliente para despertar al agente
// en modo respuesta (inmediato, sin cron ni horario hábil).
// Uso (PowerShell):
//   $env:COMPANY_ID="<uuid>"; $env:WEBHOOK_SECRET="<secreto>"; node scripts/simulate-whatsapp.mjs
// Opcionales: $env:PHONE="+56911113111"  $env:TEXT="Hola, quiero info"
import { createHmac } from 'node:crypto';

const BACKEND =
  process.env.BACKEND_URL ??
  'https://backend-production-9630.up.railway.app';
const COMPANY_ID = process.env.COMPANY_ID;
const SECRET = process.env.WEBHOOK_SECRET;
// Debe coincidir con el teléfono del lead que quieres despertar.
const phone = process.env.PHONE ?? '+56911113111';
const text = process.env.TEXT ?? 'Hola, quiero información sobre sus servicios';

if (!COMPANY_ID || !SECRET) {
  console.error('Faltan COMPANY_ID y/o WEBHOOK_SECRET en el entorno.');
  process.exit(1);
}

const body = JSON.stringify({ phone, text });
const signature = createHmac('sha256', SECRET).update(body).digest('hex');

const res = await fetch(`${BACKEND}/whatsapp/simulate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Company-Id': COMPANY_ID,
    'X-Signature': signature,
  },
  body,
});

console.log('HTTP', res.status);
console.log(await res.text());
