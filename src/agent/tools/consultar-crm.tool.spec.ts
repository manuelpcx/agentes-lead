// Sin red en los tests: todo host "resuelve" a una IP pública, para que la
// validación anti-SSRF de las URLs del CRM deje pasar las de ejemplo.
jest.mock('node:dns/promises', () => ({
  lookup: jest
    .fn()
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

import { ConsultarCrmTool } from './consultar-crm.tool';
import { CredentialsService } from '../../integrations/credentials.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ToolContext } from './tool.interface';

function build(cred: unknown) {
  const credentials = {
    get: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  return new ConsultarCrmTool(credentials);
}

function ctxBase(): ToolContext {
  return {
    lead: { id: 'lead-1', externalId: 'ext-1' },
    agentId: 'ag-1',
    recordedFacts: [],
    escalated: false,
    messageSent: false,
  } as unknown as ToolContext;
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

function mockFetchOk(data: string) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data }),
    });
}

describe('ConsultarCrmTool', () => {
  it('sin "pregunta", devuelve error sin consultar nada', async () => {
    const tool = build({
      isActive: true,
      secret: 'k',
      config: { queryUrl: 'https://x.cl' },
    });
    const ctx = ctxBase();
    const res = await run(() => tool.execute({}, ctx));
    expect(res.isError).toBe(true);
    expect(ctx.recordedFacts).toEqual([]);
  });

  it('sin integración CRM configurada, avisa y no inventa', async () => {
    const tool = build(null);
    const ctx = ctxBase();
    const res = await run(() => tool.execute({ pregunta: '¿saldo?' }, ctx));
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no está configurada/i);
    expect(res.content).toMatch(/no inventes/i);
  });

  it('con integración pero sin queryUrl, avisa igual', async () => {
    const tool = build({ isActive: true, secret: 'k', config: {} });
    const ctx = ctxBase();
    const res = await run(() => tool.execute({ pregunta: '¿saldo?' }, ctx));
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no está configurada/i);
  });

  it('con todo configurado, consulta el CRM y respalda el resultado en recordedFacts', async () => {
    const tool = build({
      isActive: true,
      secret: 'wh-secret',
      config: { queryUrl: 'https://n8n.cliente.cl/query' },
    });
    mockFetchOk('Saldo: $50.000');
    const ctx = ctxBase();

    const res = await run(() =>
      tool.execute({ pregunta: '¿cuál es el saldo?' }, ctx),
    );

    expect(res.content).toBe('Saldo: $50.000');
    expect(ctx.recordedFacts).toEqual([
      'consultarCrm("¿cuál es el saldo?") = Saldo: $50.000',
    ]);
  });

  it('si la consulta falla, no respalda nada y avisa que no invente', async () => {
    const tool = build({
      isActive: true,
      secret: 'wh-secret',
      config: { queryUrl: 'https://n8n.cliente.cl/query' },
    });
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('timeout'));
    const ctx = ctxBase();

    const res = await run(() => tool.execute({ pregunta: '¿saldo?' }, ctx));

    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no inventes/i);
    expect(ctx.recordedFacts).toEqual([]);
  });
});
