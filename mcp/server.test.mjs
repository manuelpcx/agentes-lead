import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));

/**
 * API falsa de agentes-lead. Devuelve lo que se le configure y registra qué
 * llegó, para poder afirmar que el servidor MCP manda bien la llave.
 */
function startFakeApi(routes) {
  const recibido = [];
  const server = createServer((req, res) => {
    recibido.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
    });
    const route = routes[`${req.method} ${req.url.split('?')[0]}`];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'no existe' }));
    }
    res.writeHead(route.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(route.body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        recibido,
        close: () => new Promise((r) => server.close(r)),
      }),
    );
  });
}

/** Levanta el servidor MCP y deja hablarle por stdio, como un cliente real. */
function startMcp(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pendientes = new Map();
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      pendientes.get(message.id)?.(message);
      pendientes.delete(message.id);
    }
  });

  let nextId = 1;
  return {
    child,
    call(method, params) {
      const id = nextId++;
      const espera = new Promise((resolve) => pendientes.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return espera;
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    stop() {
      child.stdin.end();
      child.kill();
    },
  };
}

const LEAD = {
  id: 'l1',
  name: 'Ana Pérez',
  phone: '+56911111111',
  email: 'ana@test.cl',
  status: 'EN_CONVERSACION',
  qualification: 'CALIENTE',
  isPausedForHuman: false,
  nextActionAt: null,
  updatedAt: '2026-09-16T10:00:00Z',
  lastMessage: null,
};

test('handshake completo y una llamada real de herramienta', async (t) => {
  const api = await startFakeApi({
    'GET /api/v1/me': {
      body: {
        companyId: 'company-1',
        companyName: 'Demo SpA',
        timezone: 'America/Santiago',
        role: 'OPERADOR',
        canWrite: true,
      },
    },
    'GET /api/v1/leads': { body: [LEAD] },
  });
  const mcp = startMcp({
    AGENTES_LEAD_URL: api.url,
    AGENTES_LEAD_API_KEY: 'ale_llave_de_prueba',
  });
  t.after(async () => {
    mcp.stop();
    await api.close();
  });

  const init = await mcp.call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'agentes-lead');
  assert.equal(init.result.protocolVersion, '2025-06-18');

  mcp.notify('notifications/initialized');

  const lista = await mcp.call('tools/list');
  const nombres = lista.result.tools.map((t2) => t2.name);
  assert.ok(nombres.includes('listarLeads'));
  assert.ok(nombres.includes('crearLead'), 'la llave puede escribir');

  const llamada = await mcp.call('tools/call', {
    name: 'listarLeads',
    arguments: { estado: 'EN_CONVERSACION' },
  });
  const payload = JSON.parse(llamada.result.content[0].text);
  assert.equal(payload.total, 1);
  assert.equal(payload.leads[0].nombre, 'Ana Pérez');

  // La llave viaja en cada petición, y el filtro llega como query string.
  const pedido = api.recibido.at(-1);
  assert.equal(pedido.auth, 'Bearer ale_llave_de_prueba');
  assert.ok(pedido.url.includes('status=EN_CONVERSACION'));
});

test('con una llave de solo lectura no se ofrecen herramientas de escritura', async (t) => {
  const api = await startFakeApi({
    'GET /api/v1/me': {
      body: {
        companyId: 'company-1',
        companyName: 'Demo SpA',
        timezone: 'America/Santiago',
        role: 'SOLO_LECTURA',
        canWrite: false,
      },
    },
  });
  const mcp = startMcp({
    AGENTES_LEAD_URL: api.url,
    AGENTES_LEAD_API_KEY: 'ale_solo_lectura',
  });
  t.after(async () => {
    mcp.stop();
    await api.close();
  });

  await mcp.call('initialize', { protocolVersion: '2025-06-18' });
  const lista = await mcp.call('tools/list');
  const nombres = lista.result.tools.map((t2) => t2.name);
  assert.ok(nombres.includes('listarLeads'));
  assert.ok(!nombres.includes('crearLead'));
  assert.ok(!nombres.includes('cancelarCita'));
});

test('un error de la API vuelve como resultado de herramienta, no corta la sesión', async (t) => {
  const api = await startFakeApi({
    'GET /api/v1/me': {
      body: { companyId: 'c', companyName: 'x', timezone: null, role: 'OWNER', canWrite: true },
    },
    'GET /api/v1/leads/l9': { status: 404, body: { message: 'Lead no encontrado' } },
  });
  const mcp = startMcp({
    AGENTES_LEAD_URL: api.url,
    AGENTES_LEAD_API_KEY: 'ale_x',
  });
  t.after(async () => {
    mcp.stop();
    await api.close();
  });

  await mcp.call('initialize', { protocolVersion: '2025-06-18' });
  const res = await mcp.call('tools/call', {
    name: 'verLead',
    arguments: { leadId: 'l9' },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Lead no encontrado/);

  // La sesión sigue viva después del error.
  const ping = await mcp.call('ping');
  assert.deepEqual(ping.result, {});
});

test('avisa y falla al arrancar si falta la llave', async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGENTES_LEAD_API_KEY: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => (stderr += c));

  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /AGENTES_LEAD_API_KEY/);
});

test('una herramienta inexistente responde con la lista de las que sí existen', async (t) => {
  const api = await startFakeApi({
    'GET /api/v1/me': {
      body: { companyId: 'c', companyName: 'x', timezone: null, role: 'OWNER', canWrite: true },
    },
  });
  const mcp = startMcp({
    AGENTES_LEAD_URL: api.url,
    AGENTES_LEAD_API_KEY: 'ale_x',
  });
  t.after(async () => {
    mcp.stop();
    await api.close();
  });

  await mcp.call('initialize', { protocolVersion: '2025-06-18' });
  const res = await mcp.call('tools/call', {
    name: 'borrarTodo',
    arguments: {},
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /listarLeads/);
});

test('una herramienta a la que le faltan argumentos avisa cuáles', async (t) => {
  const api = await startFakeApi({
    'GET /api/v1/me': {
      body: { companyId: 'c', companyName: 'x', timezone: null, role: 'OWNER', canWrite: true },
    },
  });
  const mcp = startMcp({
    AGENTES_LEAD_URL: api.url,
    AGENTES_LEAD_API_KEY: 'ale_x',
  });
  t.after(async () => {
    mcp.stop();
    await api.close();
  });

  await mcp.call('initialize', { protocolVersion: '2025-06-18' });
  const res = await mcp.call('tools/call', {
    name: 'agendarCita',
    arguments: { leadId: 'l1' },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /titulo, inicio, fin/);
});
