// Carga una base de conocimiento (onboarding) a una empresa, firmada con HMAC.
// Uso (PowerShell):
//   $env:COMPANY_ID="<uuid>"; $env:WEBHOOK_SECRET="<secreto>"
//   node scripts/cargar-conocimiento.mjs scripts/conocimiento-cobranza.json
// Opcional: $env:BACKEND_URL="https://backend-production-9630.up.railway.app"
//
// El archivo debe tener la forma del OnboardingDto (policies, faqs, objections,
// toneOfVoice, businessHours, services). Los campos que empiezan con "_" y
// cualquier valor "REEMPLAZAR_*" que olvides completar se avisan antes de enviar.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BACKEND =
  process.env.BACKEND_URL ?? 'https://backend-production-9630.up.railway.app';
const COMPANY_ID = process.env.COMPANY_ID;
const SECRET = process.env.WEBHOOK_SECRET;
const FILE = process.argv[2] ?? 'scripts/conocimiento-cobranza.json';

if (!COMPANY_ID || !SECRET) {
  console.error('Faltan COMPANY_ID y/o WEBHOOK_SECRET en el entorno.');
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`No pude leer/parsear ${FILE}: ${e.message}`);
  process.exit(1);
}

// Quita campos de ayuda (que empiezan con "_"); el backend los ignoraría igual.
const dto = Object.fromEntries(
  Object.entries(raw).filter(([k]) => !k.startsWith('_')),
);

// Avisa si quedaron placeholders sin completar (no bloquea, solo advierte).
const pendientes = JSON.stringify(dto).match(/REEMPLAZAR[_A-Za-z]*/g);
if (pendientes) {
  console.warn(
    `⚠ Hay ${pendientes.length} valor(es) sin completar (REEMPLAZAR...). ` +
      'Se cargarán igual, pero conviene reemplazarlos por datos reales.',
  );
}

const bodyStr = JSON.stringify(dto);
const signature = createHmac('sha256', SECRET).update(bodyStr).digest('hex');

const res = await fetch(`${BACKEND}/onboarding`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Company-Id': COMPANY_ID,
    'X-Signature': signature,
  },
  body: bodyStr,
});

console.log('HTTP', res.status);
console.log(await res.text());
