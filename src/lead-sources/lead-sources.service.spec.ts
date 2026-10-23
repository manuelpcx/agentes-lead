import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import {
  CredentialsService,
  ResolvedCredential,
} from '../integrations/credentials.service';
import { LeadImportService } from '../import/lead-import.service';
import { LeadSourcesService } from './lead-sources.service';

const URL_A = 'https://api.cliente.cl/leads';
const URL_B = 'https://api.cliente.cl/cartera';

/** DNS de mentira: todo resuelve a una IP pública. */
const lookupPublico = async () => [{ address: '93.184.216.34' }];

function respuesta(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function buildHarness(cred: Partial<ResolvedCredential> | null = null) {
  let guardada: ResolvedCredential | null = cred
    ? { provider: 'api', config: {}, isActive: true, ...cred }
    : null;
  const credentials = {
    get: jest.fn(async () => guardada),
    upsert: jest.fn(
      async (
        _c: string,
        dto: { config?: Record<string, unknown>; secret?: string },
      ) => {
        guardada = {
          provider: 'api',
          isActive: true,
          config: dto.config ?? guardada?.config ?? {},
          secret: dto.secret ?? guardada?.secret,
        };
      },
    ),
  } as unknown as CredentialsService;

  const importTable = jest.fn(async () => ({
    total: 1,
    created: 1,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    truncated: 0,
    scheduledFirstContact: true,
  }));
  const imports = { importTable } as unknown as LeadImportService;
  const audit = {
    record: jest.fn(async () => undefined),
  } as unknown as AuditService;
  const prisma = {
    raw: {
      company: {
        findUnique: jest.fn(async () => ({ timezone: 'America/Santiago' })),
      },
    },
  } as unknown as PrismaService;
  const fetchMock = jest.fn();

  const service = new LeadSourcesService(credentials, imports, audit, prisma, {
    fetch: fetchMock as unknown as typeof fetch,
    lookup: lookupPublico,
  });
  return {
    service,
    credentials,
    importTable,
    audit,
    fetchMock,
    guardada: () => guardada,
  };
}

function enTenant<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ companyId: 'company-1', correlationId: 't' }, fn);
}

const configurada = {
  config: { fuentes: [{ nombre: 'Cartera', url: URL_A }] },
  secret: 'tok-123',
};

describe('LeadSourcesService.ver', () => {
  it('sin configurar: no está lista y no expone el token', async () => {
    const h = buildHarness();

    await expect(enTenant(() => h.service.ver())).resolves.toEqual({
      fuentes: [],
      parametroFecha: null,
      tokenConfigurado: false,
      lista: false,
    });
  });

  it('configurada: lista, con sus fuentes y sin el token en claro', async () => {
    const h = buildHarness(configurada);

    const vista = await enTenant(() => h.service.ver());

    expect(vista).toMatchObject({ lista: true, tokenConfigurado: true });
    expect(JSON.stringify(vista)).not.toContain('tok-123');
  });
});

describe('LeadSourcesService.guardar', () => {
  it('guarda las fuentes y el token cifrado (vía credenciales)', async () => {
    const h = buildHarness();

    await enTenant(() =>
      h.service.guardar(
        {
          fuentes: [
            { nombre: 'Cartera', url: URL_A },
            { nombre: 'Campaña', url: URL_B },
          ],
          token: 'tok-123',
          parametroFecha: 'desde',
        },
        'user-1',
      ),
    );

    expect(h.credentials.upsert).toHaveBeenCalledWith('leads', {
      provider: 'api',
      config: {
        fuentes: [
          { nombre: 'Cartera', url: URL_A },
          { nombre: 'Campaña', url: URL_B },
        ],
        parametroFecha: 'desde',
      },
      secret: 'tok-123',
    });
  });

  it('conserva la fecha de la última carga de las fuentes que siguen', async () => {
    const h = buildHarness({
      config: {
        fuentes: [
          {
            nombre: 'Cartera',
            url: URL_A,
            ultimaCarga: '2026-10-20T12:00:00.000Z',
          },
        ],
      },
      secret: 'tok',
    });

    await enTenant(() =>
      h.service.guardar(
        { fuentes: [{ nombre: 'Cartera vencida', url: URL_A }] },
        'u',
      ),
    );

    expect(h.guardada()?.config.fuentes).toEqual([
      {
        nombre: 'Cartera vencida',
        url: URL_A,
        ultimaCarga: '2026-10-20T12:00:00.000Z',
      },
    ]);
  });

  it('guarda la URL de la API aunque peguen la del navegador de Airtable', async () => {
    const h = buildHarness();

    await enTenant(() =>
      h.service.guardar(
        {
          fuentes: [
            {
              nombre: 'Airtable',
              url: 'https://airtable.com/appA1/tblB2/viwC3',
            },
          ],
          token: 'pat',
        },
        'u',
      ),
    );

    expect(h.guardada()?.config.fuentes).toEqual([
      {
        nombre: 'Airtable',
        url: 'https://api.airtable.com/v0/appA1/tblB2?view=viwC3',
      },
    ]);
  });

  it('rechaza URLs internas o sin https', async () => {
    const h = buildHarness();

    for (const url of [
      'http://api.cliente.cl/x',
      'https://localhost/x',
      'https://10.0.0.5/x',
    ]) {
      await expect(
        enTenant(() =>
          h.service.guardar(
            { fuentes: [{ nombre: 'X', url }], token: 't' },
            'u',
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rechaza nombres vacíos, URLs repetidas o un parámetro de fecha raro', async () => {
    const h = buildHarness();
    const casos = [
      { fuentes: [{ nombre: ' ', url: URL_A }] },
      {
        fuentes: [
          { nombre: 'A', url: URL_A },
          { nombre: 'B', url: URL_A },
        ],
      },
      { fuentes: [{ nombre: 'A', url: URL_A }], parametroFecha: 'desde&x=1' },
    ];
    for (const dto of casos) {
      await expect(
        enTenant(() => h.service.guardar(dto, 'u')),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

describe('LeadSourcesService.cargar', () => {
  it('sin fuentes configuradas no hace nada y lo dice', async () => {
    const h = buildHarness();

    await expect(enTenant(() => h.service.cargar('u'))).rejects.toThrow(
      'Integraciones',
    );
  });

  it('consulta con el token, adapta la respuesta e importa solo lo nuevo', async () => {
    const h = buildHarness(configurada);
    h.fetchMock.mockResolvedValue(
      respuesta({
        data: [
          {
            id: 'L1',
            fullName: 'Ana',
            phoneNumber: '+56911111111',
            monto: 150000,
          },
        ],
      }),
    );

    const r = await enTenant(() => h.service.cargar('user-1'));

    const [url, init] = h.fetchMock.mock.calls[0];
    expect(String(url)).toBe(URL_A);
    expect(init).toMatchObject({
      headers: { Authorization: 'Bearer tok-123', Accept: 'application/json' },
      redirect: 'manual',
    });
    expect(h.importTable).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: ['id', 'fullName', 'phoneNumber', 'monto'],
      }),
      expect.objectContaining({
        mapping: { id: 'externalId', fullName: 'name', phoneNumber: 'phone' },
        duplicates: 'skip',
        scheduleFirstContact: true,
        source: 'Cartera',
        phonePrefix: '+56',
      }),
      'user-1',
      expect.objectContaining({ action: 'import_leads_api' }),
    );
    expect(r.fuentes[0]).toMatchObject({
      nombre: 'Cartera',
      ok: true,
      recibidos: 1,
    });
  });

  it('pasa la fecha de la última carga si hay parámetro configurado, y la avanza', async () => {
    const h = buildHarness({
      config: {
        fuentes: [
          {
            nombre: 'Cartera',
            url: URL_A,
            ultimaCarga: '2026-10-20T12:00:00.000Z',
          },
        ],
        parametroFecha: 'desde',
      },
      secret: 'tok',
    });
    h.fetchMock.mockResolvedValue(respuesta([]));

    await enTenant(() => h.service.cargar('u'));

    expect(String(h.fetchMock.mock.calls[0][0])).toBe(
      `${URL_A}?desde=2026-10-20T12%3A00%3A00.000Z`,
    );
    const fuente = (
      h.guardada()?.config.fuentes as Array<{ ultimaCarga: string }>
    )[0];
    expect(fuente.ultimaCarga > '2026-10-20T12:00:00.000Z').toBe(true);
  });

  it('una fuente que falla no frena a las demás ni avanza su fecha', async () => {
    const h = buildHarness({
      config: {
        fuentes: [
          { nombre: 'Rota', url: URL_A },
          { nombre: 'Buena', url: URL_B },
        ],
      },
      secret: 'tok',
    });
    h.fetchMock
      .mockResolvedValueOnce(respuesta('error', 500))
      .mockResolvedValueOnce(respuesta([{ email: 'a@b.cl' }]));

    const r = await enTenant(() => h.service.cargar('u'));

    expect(r.fuentes[0]).toMatchObject({
      nombre: 'Rota',
      ok: false,
      error: expect.stringContaining('500'),
    });
    expect(r.fuentes[1]).toMatchObject({ nombre: 'Buena', ok: true });
    const fuentes = h.guardada()?.config.fuentes as Array<{
      ultimaCarga?: string;
    }>;
    expect(fuentes[0].ultimaCarga).toBeUndefined();
    expect(fuentes[1].ultimaCarga).toBeDefined();
  });

  it('explica cada problema de la respuesta', async () => {
    const casos: Array<[Response, string]> = [
      [respuesta('no es json'), 'JSON'],
      [
        respuesta('<!DOCTYPE html><html><body>Airtable</body></html>', 200, {
          'content-type': 'text/html; charset=utf-8',
        }),
        'página web',
      ],
      [respuesta({ ok: true }), 'lista de leads'],
      [respuesta([{ folio: 'F1', monto: 1 }]), 'teléfono ni correo'],
      [respuesta('', 302, { location: 'https://otro.cl' }), 'redirige'],
      [respuesta('', 401), '401'],
      [
        respuesta('x', 200, { 'content-length': String(6 * 1024 * 1024) }),
        'demasiado grande',
      ],
    ];
    for (const [res, esperado] of casos) {
      const h = buildHarness(configurada);
      h.fetchMock.mockResolvedValue(res);

      const r = await enTenant(() => h.service.cargar('u'));

      expect(r.fuentes[0].ok).toBe(false);
      expect(r.fuentes[0].error).toContain(esperado);
      expect(h.importTable).not.toHaveBeenCalled();
    }
  });

  it('una fuente ya guardada con la URL del navegador de Airtable igual llama a la API', async () => {
    const h = buildHarness({
      config: {
        fuentes: [
          { nombre: 'Airtable', url: 'https://airtable.com/appA1/tblB2/viwC3' },
        ],
      },
      secret: 'pat',
    });
    h.fetchMock.mockResolvedValue(respuesta({ records: [] }));

    await enTenant(() => h.service.cargar('u'));

    expect(String(h.fetchMock.mock.calls[0][0])).toBe(
      'https://api.airtable.com/v0/appA1/tblB2?view=viwC3',
    );
  });

  it('una respuesta vacía es "nada nuevo", no un error', async () => {
    const h = buildHarness(configurada);
    h.fetchMock.mockResolvedValue(respuesta({ data: [] }));

    const r = await enTenant(() => h.service.cargar('u'));

    expect(r.fuentes[0]).toMatchObject({ ok: true, recibidos: 0 });
    expect(h.importTable).not.toHaveBeenCalled();
  });

  it('no deja correr dos cargas a la vez para la misma empresa', async () => {
    const h = buildHarness(configurada);
    let soltar: (r: Response) => void = () => undefined;
    h.fetchMock.mockReturnValue(new Promise<Response>((r) => (soltar = r)));

    const primera = enTenant(() => h.service.cargar('u'));
    await expect(enTenant(() => h.service.cargar('u'))).rejects.toThrow(
      'en curso',
    );
    soltar(respuesta([]));
    await primera;
  });
});
