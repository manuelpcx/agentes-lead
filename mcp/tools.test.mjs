import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolDescriptor, toolsFor } from './tools.mjs';

const byName = (name) => TOOLS.find((t) => t.name === name);

/** API falsa: registra la llamada y devuelve lo que se le diga. */
function fakeApi(responses = {}) {
  const calls = [];
  const handler = (method) => (path, payload) => {
    calls.push({ method, path, payload });
    const key = `${method} ${path}`;
    return Promise.resolve(responses[key] ?? responses[path] ?? null);
  };
  return {
    calls,
    get: handler('GET'),
    post: handler('POST'),
    patch: handler('PATCH'),
  };
}

test('ninguna herramienta manda mensajes a una persona', () => {
  const nombres = TOOLS.map((t) => t.name).join(' ');
  for (const prohibido of ['responder', 'enviar', 'llamar', 'whatsapp']) {
    assert.ok(
      !nombres.toLowerCase().includes(prohibido),
      `no debería existir una herramienta de "${prohibido}"`,
    );
  }
});

test('toda herramienta tiene descripción y un schema de objeto', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.description.length > 20, `${tool.name} sin descripción útil`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} sin schema`);
    assert.equal(typeof tool.run, 'function');
  }
});

test('los nombres de herramienta son únicos', () => {
  const nombres = TOOLS.map((t) => t.name);
  assert.equal(new Set(nombres).size, nombres.length);
});

test('una llave de solo lectura no ve las herramientas de escritura', () => {
  const soloLectura = toolsFor({ puedeEscribir: false }).map((t) => t.name);
  assert.ok(soloLectura.includes('listarLeads'));
  assert.ok(!soloLectura.includes('crearLead'));
  assert.ok(!soloLectura.includes('agendarCita'));
  assert.ok(!soloLectura.includes('agregarNota'));

  const completo = toolsFor({ puedeEscribir: true });
  assert.equal(completo.length, TOOLS.length);
});

test('el descriptor que ve el cliente no lleva el ejecutor ni campos internos', () => {
  const d = toolDescriptor(byName('listarLeads'));
  assert.deepEqual(Object.keys(d).sort(), [
    'description',
    'inputSchema',
    'name',
  ]);
});

test('listarLeads traduce los filtros y recorta la ficha', async () => {
  const api = fakeApi({
    '/leads': [
      {
        id: 'l1',
        name: 'Ana',
        phone: '+56911111111',
        email: null,
        status: 'EN_CONVERSACION',
        qualification: 'CALIENTE',
        isPausedForHuman: false,
        nextActionAt: null,
        updatedAt: '2026-09-16T10:00:00Z',
        lastMessage: {
          content: '¿Tienen stock?',
          channel: 'whatsapp',
          direction: 'inbound',
          occurredAt: '2026-09-16T09:00:00Z',
        },
      },
    ],
  });

  const out = await byName('listarLeads').run(api, {
    estado: 'EN_CONVERSACION',
    busqueda: 'ana',
  });

  assert.deepEqual(api.calls[0], {
    method: 'GET',
    path: '/leads',
    payload: { status: 'EN_CONVERSACION', q: 'ana' },
  });
  assert.equal(out.total, 1);
  assert.equal(out.leads[0].nombre, 'Ana');
  assert.equal(out.leads[0].ultimoMensaje.direccion, 'del lead');
});

test('verLead arma ficha, conversación, citas y notas', async () => {
  const api = fakeApi({
    '/leads/l1': {
      lead: {
        id: 'l1',
        name: 'Ana',
        status: 'NUEVO',
        source: 'instagram',
        contactAttempts: 2,
      },
      interactions: [
        { channel: 'whatsapp', direction: 'outbound', agentId: 'a1', content: 'Hola', occurredAt: 'x' },
      ],
      appointments: [
        { id: 'c1', title: 'Demo', startAt: 'x', endAt: 'y', status: 'PROGRAMADA', lead: null },
      ],
      notes: [{ id: 'n1', body: 'Pidió factura', authorName: 'demo', createdAt: 'x' }],
    },
  });

  const out = await byName('verLead').run(api, { leadId: 'l1' });
  assert.equal(out.lead.origen, 'instagram');
  assert.equal(out.lead.intentosDeContacto, 2);
  assert.equal(out.conversacion[0].direccion, 'nuestro');
  assert.equal(out.conversacion[0].porAgente, true);
  assert.equal(out.citas[0].titulo, 'Demo');
  assert.equal(out.notas[0].texto, 'Pidió factura');
});

test('crearLead manda los nombres de campo que espera la API', async () => {
  const api = fakeApi({ 'POST /leads': { id: 'l2', name: 'Bruno' } });
  await byName('crearLead').run(api, {
    nombre: 'Bruno',
    telefono: '+56922222222',
    origen: 'referido',
  });
  assert.deepEqual(api.calls[0].payload, {
    name: 'Bruno',
    phone: '+56922222222',
    email: undefined,
    source: 'referido',
    campaign: undefined,
  });
});

test('actualizarLead solo traduce; no inventa campos ausentes', async () => {
  const api = fakeApi({ 'PATCH /leads/l1': { id: 'l1' } });
  await byName('actualizarLead').run(api, {
    leadId: 'l1',
    estado: 'AGENDADO',
  });
  const { payload } = api.calls[0];
  assert.equal(payload.status, 'AGENDADO');
  assert.equal(payload.name, undefined);
  assert.equal(payload.qualification, undefined);
});

test('agendarCita traduce inicio/fin a startAt/endAt', async () => {
  const api = fakeApi({ 'POST /appointments': { id: 'c1', title: 'Demo' } });
  await byName('agendarCita').run(api, {
    leadId: 'l1',
    titulo: 'Demo',
    inicio: '2026-09-20T15:00:00-03:00',
    fin: '2026-09-20T16:00:00-03:00',
  });
  assert.equal(api.calls[0].payload.startAt, '2026-09-20T15:00:00-03:00');
  assert.equal(api.calls[0].payload.endAt, '2026-09-20T16:00:00-03:00');
});

test('verMetricas pasa los días como parámetro de consulta', async () => {
  const api = fakeApi({ '/metrics': [] });
  await byName('verMetricas').run(api, { dias: 30 });
  assert.deepEqual(api.calls[0].payload, { days: 30 });
});
