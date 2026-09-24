#!/usr/bin/env node
/**
 * Servidor MCP de agentes-lead. Habla MCP por stdio con el cliente (Claude
 * Desktop, Claude Code, …) y REST con la API del panel.
 *
 * Configuración por variables de entorno:
 *   AGENTES_LEAD_API_KEY   llave creada en el panel (Integraciones → Acceso MCP)
 *   AGENTES_LEAD_URL       base de la API (por defecto http://localhost:3000)
 *
 * Todo lo que se imprima por stdout es protocolo: los mensajes para humanos
 * van a stderr o se mezclarían con el JSON-RPC y romperían la sesión.
 */
import { createClient } from './client.mjs';
import { TOOLS, toolDescriptor, toolsFor } from './tools.mjs';
import { createHandler, splitLines, toolText } from './protocol.mjs';

const SERVER_INFO = { name: 'agentes-lead', version: '0.1.0' };
const DEFAULT_URL = 'http://localhost:3000';

const log = (...args) => process.stderr.write(`[agentes-lead] ${args.join(' ')}\n`);

const apiKey = process.env.AGENTES_LEAD_API_KEY;
if (!apiKey) {
  log('Falta AGENTES_LEAD_API_KEY. Crea una llave en el panel: Integraciones → Acceso MCP.');
  process.exit(1);
}
const baseUrl = process.env.AGENTES_LEAD_URL ?? DEFAULT_URL;
const api = createClient({ baseUrl, apiKey });

/**
 * Permisos de la llave, consultados una sola vez. Con una llave de solo
 * lectura no tiene sentido ofrecerle al modelo herramientas que van a fallar,
 * así que el catálogo se recorta. Si la consulta falla (API caída, por
 * ejemplo) se ofrecen todas: mejor una herramienta que dé un error claro al
 * usarla que un servidor que no ofrece nada.
 */
let permisos;
function permisosDeLaLlave() {
  permisos ??= api
    .get('/me')
    .then((me) => ({ puedeEscribir: me.canWrite, empresa: me.companyName }))
    .catch((e) => {
      log(`No se pudo verificar la llave: ${e.message}`);
      return { puedeEscribir: true, empresa: null };
    });
  return permisos;
}

async function listTools() {
  const { puedeEscribir } = await permisosDeLaLlave();
  return toolsFor({ puedeEscribir }).map(toolDescriptor);
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    const disponibles = TOOLS.map((t) => t.name).join(', ');
    return toolText(
      `No existe la herramienta "${name}". Disponibles: ${disponibles}.`,
      true,
    );
  }
  const faltantes = (tool.inputSchema.required ?? []).filter(
    (k) => args[k] === undefined || args[k] === null || args[k] === '',
  );
  if (faltantes.length > 0) {
    return toolText(`Faltan argumentos obligatorios: ${faltantes.join(', ')}.`, true);
  }

  try {
    return toolText(await tool.run(api, args));
  } catch (e) {
    // El error vuelve como resultado de herramienta, no como error de
    // protocolo: así el modelo lo lee y puede corregir en vez de cortarse.
    return toolText(e?.message ?? 'Error desconocido llamando a la API.', true);
  }
}

const handle = createHandler({ serverInfo: SERVER_INFO, listTools, callTool });

// ─────────────────────────── transporte stdio ───────────────────────────

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function processLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'JSON inválido' },
    });
    return;
  }
  const response = await handle(message);
  if (response) send(response);
}

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const { lines, rest } = splitLines(pending + chunk);
  pending = rest;
  // Sin await: las peticiones lentas (una llamada HTTP) no deben bloquear a
  // las que vienen detrás. El `id` de JSON-RPC ya correlaciona las respuestas.
  for (const line of lines) {
    void processLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));

log(`listo — API en ${baseUrl}`);
