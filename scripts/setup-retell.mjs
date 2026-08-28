// Crea el agente de voz en Retell (LLM + agente) y, si le pasas el trunk de
// Twilio, importa el número para que Retell pueda llamar desde él. Al final
// imprime RETELL_AGENT_ID y RETELL_FROM_NUMBER para pegar en Railway.
//
// Uso (PowerShell):
//   $env:RETELL_API_KEY="key_..."
//   $env:RETELL_FROM_NUMBER="+56XXXXXXXXX"          # tu número Twilio (E.164)
//   $env:TWILIO_TERMINATION_URI="tu-trunk.pstn.twilio.com"   # del Elastic SIP Trunk
//   # opcionales:
//   $env:SIP_AUTH_USER="..."; $env:SIP_AUTH_PASS="..."
//   $env:VOICE_ID="11labs-Adrian"                   # voz de Retell
//   $env:AGENT_NAME="Agente de ventas"
//   node scripts/setup-retell.mjs
//
// Si el número YA está importado en Retell (o lo harás a mano), no definas
// TWILIO_TERMINATION_URI: el script solo crea LLM + agente.

const API = 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const FROM = process.env.RETELL_FROM_NUMBER;
const TERMINATION_URI = process.env.TWILIO_TERMINATION_URI;
const SIP_USER = process.env.SIP_AUTH_USER;
const SIP_PASS = process.env.SIP_AUTH_PASS;
const VOICE_ID = process.env.VOICE_ID ?? '11labs-Adrian';
const AGENT_NAME = process.env.AGENT_NAME ?? 'Agente de voz';

if (!KEY) {
  console.error('Falta RETELL_API_KEY en el entorno.');
  process.exit(1);
}

// Prompt del agente de voz (español Chile). Usa las variables dinámicas que el
// backend envía al iniciar la llamada: {{nombre}}, {{empresa}}, {{motivo}}.
const GENERAL_PROMPT = `Eres un agente de voz de {{empresa}}, cálido, natural y breve. Hablas español de Chile.
Llamas a {{nombre}} por este motivo: {{motivo}}.
Objetivo: retomar el contacto, resolver dudas y, si corresponde, coordinar una hora o un siguiente paso.
Reglas:
- No inventes precios, disponibilidad ni datos: si no los sabes, dilo y ofrece que el equipo lo confirme por WhatsApp.
- Sé conciso, una idea a la vez, y confirma lo que entendiste.
- Si {{nombre}} no puede hablar, ofrece llamar más tarde o seguir por WhatsApp y despídete amablemente.`;
const BEGIN_MESSAGE = `Hola {{nombre}}, te llamo de {{empresa}}. ¿Tienes un minuto?`;

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ ${path} → ${res.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

console.log('1) Creando Retell LLM…');
const llm = await post('/create-retell-llm', {
  general_prompt: GENERAL_PROMPT,
  begin_message: BEGIN_MESSAGE,
});
console.log(`   llm_id = ${llm.llm_id}`);

console.log('2) Creando agente…');
const agent = await post('/create-agent', {
  response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  voice_id: VOICE_ID,
  agent_name: AGENT_NAME,
});
console.log(`   agent_id = ${agent.agent_id}`);

if (TERMINATION_URI) {
  if (!FROM) {
    console.error('Para importar el número define RETELL_FROM_NUMBER (E.164).');
    process.exit(1);
  }
  console.log('3) Importando número de Twilio…');
  const number = await post('/import-phone-number', {
    phone_number: FROM,
    termination_uri: TERMINATION_URI,
    ...(SIP_USER ? { sip_trunk_auth_username: SIP_USER } : {}),
    ...(SIP_PASS ? { sip_trunk_auth_password: SIP_PASS } : {}),
    inbound_agents: [{ agent_id: agent.agent_id, weight: 1 }],
    outbound_agents: [{ agent_id: agent.agent_id, weight: 1 }],
  });
  console.log(`   número importado = ${number.phone_number ?? FROM}`);
} else {
  console.log(
    '3) (omitido) No definiste TWILIO_TERMINATION_URI: importa el número en\n' +
      '   Retell a mano o conéctalo por el dashboard, y bíndealo a este agente.',
  );
}

console.log('\n✓ Listo. Configura en Railway (servicio backend):');
console.log('   VOICE_PROVIDER=retell');
console.log(`   RETELL_API_KEY=<tu key>`);
console.log(`   RETELL_AGENT_ID=${agent.agent_id}`);
console.log(`   RETELL_FROM_NUMBER=${FROM ?? '<tu número Twilio E.164>'}`);
console.log(
  '\nY en Retell, apunta el webhook a: https://TU-BACKEND/voice/retell/webhook',
);
