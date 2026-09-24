import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CODES,
  LATEST_PROTOCOL_VERSION,
  createHandler,
  splitLines,
  toolText,
} from './protocol.mjs';

const SERVER_INFO = { name: 'agentes-lead', version: '0.1.0' };

function buildHandler(overrides = {}) {
  return createHandler({
    serverInfo: SERVER_INFO,
    listTools: async () => [
      { name: 'listarLeads', description: 'x', inputSchema: { type: 'object' } },
    ],
    callTool: async (name, args) => toolText({ name, args }),
    ...overrides,
  });
}

const req = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('initialize acepta la versión que pide el cliente si la sabemos hablar', async () => {
  const handle = buildHandler();
  const res = await handle(req('initialize', { protocolVersion: '2024-11-05' }));
  assert.equal(res.result.protocolVersion, '2024-11-05');
  assert.deepEqual(res.result.serverInfo, SERVER_INFO);
  assert.deepEqual(res.result.capabilities, { tools: { listChanged: false } });
});

test('initialize cae a nuestra versión más nueva si la pedida no existe', async () => {
  const handle = buildHandler();
  const res = await handle(req('initialize', { protocolVersion: '1999-01-01' }));
  assert.equal(res.result.protocolVersion, LATEST_PROTOCOL_VERSION);
});

test('las notificaciones no se responden nunca', async () => {
  const handle = buildHandler();
  assert.equal(
    await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    null,
  );
  assert.equal(
    await handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }),
    null,
  );
});

test('ping responde vacío', async () => {
  const res = await buildHandler()(req('ping'));
  assert.deepEqual(res.result, {});
});

test('tools/list devuelve el catálogo', async () => {
  const res = await buildHandler()(req('tools/list'));
  assert.equal(res.result.tools[0].name, 'listarLeads');
});

test('tools/call pasa nombre y argumentos', async () => {
  const res = await buildHandler()(
    req('tools/call', { name: 'verLead', arguments: { leadId: 'abc' } }),
  );
  assert.deepEqual(JSON.parse(res.result.content[0].text), {
    name: 'verLead',
    args: { leadId: 'abc' },
  });
});

test('tools/call sin nombre es un error de parámetros', async () => {
  const res = await buildHandler()(req('tools/call', { arguments: {} }));
  assert.equal(res.error.code, ERROR_CODES.invalidParams);
});

test('un método desconocido con id devuelve methodNotFound', async () => {
  const res = await buildHandler()(req('resources/list'));
  assert.equal(res.error.code, ERROR_CODES.methodNotFound);
});

test('un mensaje que no es JSON-RPC 2.0 se rechaza', async () => {
  const res = await buildHandler()({ id: 1, method: 'ping' });
  assert.equal(res.error.code, ERROR_CODES.invalidRequest);
});

test('un fallo inesperado se devuelve como error interno, no revienta', async () => {
  const handle = buildHandler({
    listTools: async () => {
      throw new Error('se cayó todo');
    },
  });
  const res = await handle(req('tools/list'));
  assert.equal(res.error.code, ERROR_CODES.internal);
  assert.equal(res.error.message, 'se cayó todo');
});

test('toolText serializa objetos y marca los errores', () => {
  assert.deepEqual(toolText({ a: 1 }), {
    content: [{ type: 'text', text: '{\n  "a": 1\n}' }],
  });
  assert.equal(toolText('ups', true).isError, true);
});

test('splitLines guarda la línea incompleta para el próximo chunk', () => {
  const primero = splitLines('{"a":1}\n{"b":2}\n{"c":');
  assert.deepEqual(primero.lines, ['{"a":1}', '{"b":2}']);
  assert.equal(primero.rest, '{"c":');

  const segundo = splitLines(primero.rest + '3}\n');
  assert.deepEqual(segundo.lines, ['{"c":3}']);
  assert.equal(segundo.rest, '');
});

test('splitLines descarta líneas en blanco', () => {
  assert.deepEqual(splitLines('\n\n{"a":1}\n').lines, ['{"a":1}']);
});
