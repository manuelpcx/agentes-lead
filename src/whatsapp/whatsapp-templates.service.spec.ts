import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { ConfigService } from '@nestjs/config';
import { TemplateCategory } from './dto/create-template.dto';
import type { EnvVars } from '../common/config/env.validation';

function build(cfg: Record<string, unknown>) {
  const config = {
    get: (k: string) => cfg[k],
  } as unknown as ConfigService<EnvVars, true>;
  return new WhatsappTemplatesService(config);
}

function mockFetch(res: { ok: boolean; body: unknown; status?: number }) {
  const fn = jest.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status ?? (res.ok ? 200 : 400),
    text: async () => JSON.stringify(res.body),
    json: async () => res.body,
  });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

describe('WhatsappTemplatesService', () => {
  it('crea la plantilla con wabaId, category y BODY + ejemplos', async () => {
    const svc = build({ YCLOUD_API_KEY: 'key', YCLOUD_WABA_ID: 'waba1' });
    const fetchMock = mockFetch({
      ok: true,
      body: { name: 'recordatorio', status: 'PENDING' },
    });
    const out = await svc.create({
      name: 'recordatorio',
      language: 'es_CL',
      category: TemplateCategory.MARKETING,
      body: 'Hola {{1}}, de {{2}}',
      examples: ['Ana', 'Acme'],
      footer: 'Equipo',
    });

    expect(out.status).toBe('PENDING');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.wabaId).toBe('waba1');
    expect(body.category).toBe('MARKETING');
    const bodyComp = body.components.find(
      (c: { type: string }) => c.type === 'BODY',
    );
    expect(bodyComp.text).toBe('Hola {{1}}, de {{2}}');
    expect(bodyComp.example.body_text).toEqual([['Ana', 'Acme']]);
    expect(
      body.components.some((c: { type: string }) => c.type === 'FOOTER'),
    ).toBe(true);
  });

  it('falla al crear si falta la config de YCloud', async () => {
    const svc = build({});
    await expect(
      svc.create({
        name: 'x',
        language: 'es',
        category: TemplateCategory.UTILITY,
        body: 'hola',
      }),
    ).rejects.toThrow(/YCLOUD/);
  });

  it('lista y normaliza (status, reason, body)', async () => {
    const svc = build({ YCLOUD_API_KEY: 'key', YCLOUD_WABA_ID: 'waba1' });
    mockFetch({
      ok: true,
      body: {
        items: [
          {
            name: 'bienvenida',
            language: 'es_CL',
            category: 'MARKETING',
            status: 'REJECTED',
            reason: 'texto promocional',
            components: [{ type: 'BODY', text: 'Hola {{1}}' }],
          },
        ],
      },
    });
    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'bienvenida',
      status: 'REJECTED',
      reason: 'texto promocional',
      body: 'Hola {{1}}',
    });
  });

  it('sin API key, listar devuelve vacío', async () => {
    const svc = build({});
    await expect(svc.list()).resolves.toEqual([]);
  });
});
