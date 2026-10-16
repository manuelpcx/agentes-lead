import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { EmailService } from './email.service';
import { ProviderHealthService } from '../alerts/provider-health.service';
import { EmailQuotaService } from './email-quota.service';
import { ManagedEmailService, PlatformSender } from './managed-email.service';

function build(opts: {
  byo?: unknown;
  sender?: PlatformSender | null;
  apiKey?: string;
  allowed?: boolean;
}) {
  const credentials = {
    get: jest.fn().mockResolvedValue(opts.byo ?? null),
  } as unknown as CredentialsService;
  const managed = {
    platformSender: jest.fn().mockResolvedValue(opts.sender ?? null),
    platformApiKey: opts.apiKey,
  } as unknown as ManagedEmailService;
  const quota = {
    consume: jest.fn().mockResolvedValue({
      allowed: opts.allowed ?? true,
      used: 1,
      limit: 500,
    }),
  } as unknown as EmailQuotaService;
  const health = {
    observe: jest.fn((_t: unknown, send: () => Promise<unknown>) => send()),
  };
  return {
    service: new EmailService(
      credentials,
      managed,
      quota,
      health as unknown as ProviderHealthService,
    ),
    quota,
    health,
  };
}

function mockFetch(): jest.Mock {
  const fn = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

const MENSAJE = {
  to: 'ana@x.cl',
  subject: 'Hola',
  text: 'Cuerpo',
  tags: { lead_id: 'lead-1' },
};

describe('EmailService', () => {
  it('por el dominio gestionado: remitente, respuestas y etiquetas de empresa y lead', async () => {
    const fetchMock = mockFetch();
    const h = build({
      apiKey: 're_plataforma',
      sender: {
        mode: 'managed',
        from: '"Sur" <contacto@notificaciones.sur.cl>',
        replyTo: 'equipo@sur.cl',
      },
    });

    await run(() => h.service.send(MENSAJE));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_plataforma');
    expect(JSON.parse(init.body)).toMatchObject({
      from: '"Sur" <contacto@notificaciones.sur.cl>',
      to: ['ana@x.cl'],
      reply_to: 'equipo@sur.cl',
      tags: [
        { name: 'lead_id', value: 'lead-1' },
        { name: 'company_id', value: 'c1' },
      ],
    });
    expect(h.quota.consume).toHaveBeenCalledWith('c1');
  });

  it('si la empresa conectó su propia cuenta, sale por ella y sin tope', async () => {
    const fetchMock = mockFetch();
    const h = build({
      apiKey: 're_plataforma',
      byo: {
        provider: 'resend',
        secret: 're_propia',
        config: { from: 'Sur <hola@sur.cl>' },
        isActive: true,
      },
      sender: { mode: 'shared', from: 'x' },
    });

    await run(() => h.service.send(MENSAJE));

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer re_propia',
    );
    expect(h.quota.consume).not.toHaveBeenCalled();
  });

  it('pasado el tope diario no envía y lo dice', async () => {
    const fetchMock = mockFetch();
    const h = build({
      apiKey: 're_plataforma',
      sender: { mode: 'shared', from: 'x@correo.plataforma.cl' },
      allowed: false,
    });

    await expect(run(() => h.service.send(MENSAJE))).rejects.toThrow(
      /Límite diario de correos/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin nada configurado, no envía (queda en el log)', async () => {
    const fetchMock = mockFetch();
    const h = build({ apiKey: 're_plataforma', sender: null });

    await run(() => h.service.send(MENSAJE));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.quota.consume).not.toHaveBeenCalled();
  });
});

describe('EmailService y la salud del proveedor', () => {
  it('registra la salud: cuenta propia como empresa, gestionado como plataforma', async () => {
    mockFetch();
    const propia = build({
      byo: {
        provider: 'resend',
        isActive: true,
        secret: 're_propia',
        config: { from: 'a@b.cl' },
      },
    });
    await run(() => propia.service.send(MENSAJE));
    expect(propia.health.observe).toHaveBeenCalledWith(
      {
        service: 'email',
        provider: 'resend',
        scope: 'company',
        companyId: 'c1',
      },
      expect.any(Function),
    );

    const gestionado = build({
      apiKey: 're_plataforma',
      sender: { mode: 'shared', from: 'n@plataforma.cl', replyTo: undefined },
    });
    await run(() => gestionado.service.send(MENSAJE));
    expect(gestionado.health.observe).toHaveBeenCalledWith(
      {
        service: 'email',
        provider: 'resend',
        scope: 'platform',
        companyId: 'c1',
      },
      expect.any(Function),
    );
  });

  it('el tope diario no cuenta como fallo del proveedor', async () => {
    mockFetch();
    const h = build({
      apiKey: 're_plataforma',
      sender: { mode: 'shared', from: 'n@plataforma.cl', replyTo: undefined },
      allowed: false,
    });
    await expect(run(() => h.service.send(MENSAJE))).rejects.toThrow(
      'Límite diario',
    );
    expect(h.health.observe).not.toHaveBeenCalled();
  });
});
