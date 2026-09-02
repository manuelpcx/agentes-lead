// Envía un lead de COBRANZA de prueba al webhook (firmado HMAC-SHA256).
// Enruta directo al agente de cobranza gracias a metadata.tipo = "cobranza".
//
// Uso (PowerShell):
//   $env:COMPANY_ID="<uuid>"; $env:WEBHOOK_SECRET="<secreto>"
//   node scripts/send-lead-cobranza.mjs
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

// Solo campos válidos del DTO (el backend rechaza propiedades extra).
const lead = {
  externalId: 'cobranza-' + Date.now(), // idempotencia por empresa
  name: 'Jesús Medina',
  phone: '+56920337143', // E.164
  email: 'jesus.medina05@gmail.com',
  source: 'erp_cobranza',
  preferredChannel: 'whatsapp',
  timezone: 'America/Santiago',
  // La deuda va en metadata. "tipo" enruta al agente de cobranza; el resto lo
  // usa el agente (y cuenta como dato válido para el guardrail).
  metadata: {
    tipo: 'cobranza',
    monto: '150000',
    moneda: 'CLP',
    folio: 'F-4821',
    vencimiento: '2026-08-15',
    dias_mora: 17,
    link_pago: 'https://pago.tuempresa.cl/F-4821',
  },
};

const body = JSON.stringify(lead);
const signature = createHmac('sha256', SECRET).update(body).digest('hex');

const res = await fetch(`${BACKEND}/webhooks/lead`, {
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
