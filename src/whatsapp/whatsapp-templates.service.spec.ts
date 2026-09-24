import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { CredentialsService } from '../integrations/credentials.service';
import { TemplateCategory } from './dto/create-template.dto';

/** Mockea CredentialsService.get('whatsapp') con (o sin) cuenta de YCloud. */
function build(
  cred: {
    provider?: string;
    secret?: string;
    wabaId?: string;
  } | null,
) {
  const credentials = {
    get: jest.fn().mockResolvedValue(
      cred
        ? {
            provider: cred.provider ?? 'ycloud',
            secret: cred.secret,
            config: cred.wabaId ? { wabaId: cred.wabaId } : {},
            isActive: true,
          }
        : null,
    ),
  } as unknown as CredentialsService;
  return new WhatsappTemplatesService(credentials);
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
    const svc = build({ secret: 'key', wabaId: 'waba1' });
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
    const svc = build(null);
    await expect(
      svc.create({
        name: 'x',
        language: 'es',
        category: TemplateCategory.UTILITY,
        body: 'hola',
      }),
    ).rejects.toThrow(/YCloud/i);
  });

  it('lista y normaliza (status, reason, body)', async () => {
    const svc = build({ secret: 'key', wabaId: 'waba1' });
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
    const svc = build(null);
    await expect(svc.list()).resolves.toEqual([]);
  });
});
