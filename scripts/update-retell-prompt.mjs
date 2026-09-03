// Actualiza el prompt del agente de voz de Retell YA CREADO (sin duplicarlo).
// Usa el mismo Agent ID que ya tienes guardado en el panel (Integraciones →
// Voz): busca su llm_id y le aplica el prompt de scripts/retell-prompt.mjs.
//
// Uso (PowerShell):
//   $env:RETELL_API_KEY="key_..."
//   $env:RETELL_AGENT_ID="agent_..."   # el mismo que tienes en el panel
//   node scripts/update-retell-prompt.mjs
//
// Para cambiar el contenido del prompt, edita scripts/retell-prompt.mjs (lo
// comparte con setup-retell.mjs) y vuelve a correr este script.

import { GENERAL_PROMPT, BEGIN_MESSAGE } from './retell-prompt.mjs';

const API = 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const AGENT_ID = process.env.RETELL_AGENT_ID;

if (!KEY || !AGENT_ID) {
  console.error('Faltan RETELL_API_KEY y/o RETELL_AGENT_ID en el entorno.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

console.log(`1) Buscando el agente ${AGENT_ID}…`);
const agent = await call('GET', `/get-agent/${AGENT_ID}`);
const llmId = agent.response_engine?.llm_id;
if (!llmId) {
  console.error(
    'Este agente no usa un Retell LLM (response_engine distinto) — no se puede actualizar así.',
  );
  process.exit(1);
}
console.log(`   llm_id = ${llmId}`);

console.log('2) Actualizando el prompt…');
await call('PATCH', `/update-retell-llm/${llmId}`, {
  general_prompt: GENERAL_PROMPT,
  begin_message: BEGIN_MESSAGE,
});

console.log('\n✓ Prompt actualizado. No hace falta cambiar nada en Railway ni en el panel:');
console.log(`  el mismo RETELL_AGENT_ID (${AGENT_ID}) ya usa el prompt nuevo.`);
