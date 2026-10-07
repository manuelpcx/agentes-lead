import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { EmailQuotaService } from './email-quota.service';
import { ManagedEmailService, formatFrom } from './managed-email.service';

const RECORDS = [
  {
    record: 'DKIM',
    name: 'resend._domainkey.notificaciones',
    type: 'TXT',
    value: 'p=MIGf',
    status: 'not_started',
  },
  {
    record: 'SPF',
    name: 'send.notificaciones',
    type: 'MX',
    value: 'feedback-smtp.sa-east-1.amazonses.com',
    priority: 10,
    status: 'not_started',
  },
];

type Row = Record<string, unknown> | null;

function res(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mockFetch(...responses: ReturnType<typeof res>[]): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

function build(
  opts: {
    apiKey?: string | null;
    sharedDomain?: string | null;
    row?: Row;
    channelsConfig?: unknown;
    byo?: unknown;
    domainOfOtherCompany?: string;
  } = {},
) {
  const cfg: Record<string, unknown> = {
    RESEND_API_KEY: opts.apiKey === undefined ? 're_key' : opts.apiKey,
    EMAIL_SHARED_DOMAIN:
      opts.sharedDomain === undefined
        ? 'correo.plataforma.cl'
        : opts.sharedDomain,
    EMAIL_SHARED_LOCAL_PART: 'notificaciones',
    RESEND_DOMAIN_REGION: 'sa-east-1',
  };
  const config = {
    get: (k: string) => cfg[k] ?? undefined,
  } as unknown as ConfigService<EnvVars, true>;

  let row: Row = opts.row ?? null;
  const db = {
    emailDomain: {
      findFirst: jest.fn(async () => row),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { id: 'ed1', ...data };
        return row;
      }),
      deleteMany: jest.fn(async () => {
        row = null;
        return { count: 1 };
      }),
    },
  };
  const raw = {
    company: {
      findUnique: jest.fn(async () => ({
        name: 'Cobranzas del Sur',
        channelsConfig: opts.channelsConfig ?? {},
      })),
      update: jest.fn(async () => ({})),
    },
    emailDomain: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { companyId?: string; domain?: string };
        }) =>
          where.companyId
            ? row
            : where.domain === opts.domainOfOtherCompany
              ? { id: 'otra' }
              : null,
      ),
      findMany: jest.fn(async () => (row ? [row] : [])),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data };
        return row;
      }),
    },
  };
  const prisma = { db, raw } as unknown as PrismaService;
  const credentials = {
    get: jest.fn().mockResolvedValue(opts.byo ?? null),
  } as unknown as CredentialsService;
  const quota = {
    used: jest.fn().mockResolvedValue(2),
    limit: 500,
  } as unknown as EmailQuotaService;

  return {
    service: new ManagedEmailService(prisma, credentials, quota, config),
    db,
    raw,
    row: () => row,
  };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

const VERIFICADO = {
  id: 'ed1',
  companyId: 'c1',
  domain: 'notificaciones.sur.cl',
  resendDomainId: 'rd1',
  status: 'verified',
  records: RECORDS,
  verifiedAt: new Date('2026-09-20T00:00:00Z'),
  lastCheckedAt: new Date(),
};

describe('ManagedEmailService.platformSender', () => {
  it('con el dominio verificado, envía desde él con el remitente de la empresa', async () => {
    const { service } = build({
      row: VERIFICADO,
      channelsConfig: {
        email: {
          fromName: 'Cobranzas Sur',
          localPart: 'cobranza',
          replyTo: 'equipo@sur.cl',
        },
      },
    });

    await expect(service.platformSender('c1')).resolves.toEqual({
      mode: 'managed',
      from: '"Cobranzas Sur" <cobranza@notificaciones.sur.cl>',
      replyTo: 'equipo@sur.cl',
    });
  });

  it('mientras el dominio se verifica, envía desde el compartido con el nombre de la empresa', async () => {
    const { service } = build({ row: { ...VERIFICADO, status: 'pending' } });

    await expect(service.platformSender('c1')).resolves.toEqual({
      mode: 'shared',
      from: '"Cobranzas del Sur" <notificaciones@correo.plataforma.cl>',
      replyTo: undefined,
    });
  });

  it('sin dominio verificado ni compartido, no hay por dónde enviar', async () => {
    const { service } = build({ sharedDomain: null });
    await expect(service.platformSender('c1')).resolves.toBeNull();
  });

  it('sin la cuenta de Resend de la plataforma, tampoco', async () => {
    const { service } = build({ apiKey: null, row: VERIFICADO });
    await expect(service.platformSender('c1')).resolves.toBeNull();
  });
});

describe('formatFrom', () => {
  it('saca del nombre lo que podría romper la cabecera From', () => {
    expect(formatFrom('Juan "El" <x>\nY', 'a@b.cl')).toBe(
      '"Juan El xY" <a@b.cl>',
    );
  });
});

describe('ManagedEmailService.addDomain', () => {
  it('lo da de alta en Resend (São Paulo), dispara la verificación y guarda los registros', async () => {
    const h = build();
    const fetchMock = mockFetch(
      res(200, {
        id: 'rd1',
        name: 'notificaciones.sur.cl',
        status: 'not_started',
        records: RECORDS,
      }),
      res(200, { object: 'domain', id: 'rd1' }),
      res(200, { id: 'rd1', status: 'pending', records: RECORDS }),
    );

    const status = await run(() =>
      h.service.addDomain(' Notificaciones.Sur.CL. '),
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'notificaciones.sur.cl',
      region: 'sa-east-1',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.resend.com/domains/rd1/verify',
    );
    expect(h.db.emailDomain.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c1',
        domain: 'notificaciones.sur.cl',
        resendDomainId: 'rd1',
        status: 'pending',
      }),
    });
    // El panel recibe los registros con su nombre completo, por si el
    // proveedor de DNS lo pide así.
    expect(status.domain?.records[0].fqdn).toBe(
      'resend._domainkey.notificaciones.sur.cl',
    );
    // Mientras se verifica, sale desde el dominio compartido.
    expect(status.sending.mode).toBe('shared');
  });

  it('no deja registrar el dominio de la plataforma', async () => {
    const h = build();
    await expect(
      run(() => h.service.addDomain('x.correo.plataforma.cl')),
    ).rejects.toThrow(BadRequestException);
  });

  it('un dominio por empresa: hay que quitar el actual antes', async () => {
    const h = build({ row: VERIFICADO });
    await expect(run(() => h.service.addDomain('otro.sur.cl'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('no deja registrar un dominio que ya usa otra empresa', async () => {
    const h = build({ domainOfOtherCompany: 'notificaciones.ajena.cl' });
    const fetchMock = mockFetch();

    await expect(
      run(() => h.service.addDomain('notificaciones.ajena.cl')),
    ).rejects.toThrow(ConflictException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un error de Resend llega al panel como 400 con su mensaje', async () => {
    const h = build();
    mockFetch(res(422, { message: 'Domain already exists' }));

    await expect(
      run(() => h.service.addDomain('notificaciones.sur.cl')),
    ).rejects.toThrow(/Domain already exists/);
  });

  it('si no se pudo guardar, lo borra de Resend para que no quede huérfano', async () => {
    const h = build();
    h.db.emailDomain.create.mockRejectedValueOnce(new Error('db caída'));
    const fetchMock = mockFetch(
      res(200, { id: 'rd1', status: 'not_started', records: RECORDS }),
      res(200, {}),
      res(200, { id: 'rd1', status: 'pending', records: RECORDS }),
      res(200, {}),
    );

    await expect(
      run(() => h.service.addDomain('notificaciones.sur.cl')),
    ).rejects.toThrow('db caída');
    expect(fetchMock.mock.calls[3][0]).toBe(
      'https://api.resend.com/domains/rd1',
    );
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });
});

describe('ManagedEmailService.status', () => {
  it('si la empresa conectó su propia cuenta, se envía por ella', async () => {
    const h = build({
      row: VERIFICADO,
      byo: {
        provider: 'resend',
        secret: 're_propia',
        config: { from: 'Sur <hola@sur.cl>' },
        isActive: true,
      },
    });

    const status = await run(() => h.service.status());

    expect(status.sending).toEqual({
      mode: 'byo',
      from: 'Sur <hola@sur.cl>',
      replyTo: null,
    });
  });

  it('sin nada configurado lo dice, con el cupo del día', async () => {
    const h = build({ sharedDomain: null });

    const status = await run(() => h.service.status());

    expect(status.sending.mode).toBe('none');
    expect(status.quota).toEqual({ used: 2, limit: 500 });
  });

  it('al abrir el panel, pregunta a Resend por un dominio que se está verificando', async () => {
    const h = build({
      row: {
        ...VERIFICADO,
        status: 'pending',
        verifiedAt: null,
        lastCheckedAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });
    mockFetch(res(200, { id: 'rd1', status: 'verified', records: RECORDS }));

    const status = await run(() => h.service.status());

    expect(status.domain?.sendable).toBe(true);
    expect(status.domain?.verifiedAt).toBeInstanceOf(Date);
    expect(status.sending.mode).toBe('managed');
  });
});

describe('ManagedEmailService — remitente y dominios pendientes', () => {
  it('guarda el remitente; un campo vacío lo borra', async () => {
    const h = build({
      channelsConfig: {
        voice: { voiceId: 'v1' },
        email: { fromName: 'Viejo', replyTo: 'antes@sur.cl' },
      },
    });

    await run(() =>
      h.service.updateSender({ fromName: ' Cobranzas Sur ', replyTo: '' }),
    );

    expect(h.raw.company.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        channelsConfig: {
          voice: { voiceId: 'v1' },
          email: { fromName: 'Cobranzas Sur' },
        },
      },
    });
  });

  it('el scheduler marca verificado un dominio apenas Resend lo confirma', async () => {
    const h = build({
      row: { ...VERIFICADO, status: 'pending', verifiedAt: null },
    });
    mockFetch(res(200, { id: 'rd1', status: 'verified', records: RECORDS }));

    await expect(h.service.refreshPendingDomains()).resolves.toBe(1);

    expect(h.row()).toMatchObject({ status: 'verified' });
    expect((h.row() as { verifiedAt: unknown }).verifiedAt).toBeInstanceOf(
      Date,
    );
  });

  it('quitar el dominio lo borra de Resend y de la plataforma', async () => {
    const h = build({ row: VERIFICADO });
    const fetchMock = mockFetch(res(200, {}));

    await run(() => h.service.removeDomain());

    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(h.db.emailDomain.deleteMany).toHaveBeenCalledWith({
      where: { id: 'ed1' },
    });
  });
});
