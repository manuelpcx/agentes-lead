import { NotFoundException } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { VoiceUsageService } from '../voice/voice-usage.service';

const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);
const HACE_MESES = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

function buildHarness(
  overrides: Partial<Record<string, unknown>> = {},
  registerCompany = jest.fn(),
) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const companyUpdate = jest.fn(({ data }: { data: { isActive: boolean } }) =>
    Promise.resolve({ id: 'c-1', isActive: data.isActive }),
  );

  const base = {
    company: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'c-1',
          name: 'Activa SpA',
          rut: '1-9',
          isActive: true,
          createdAt: HACE_MESES,
          timezone: 'America/Santiago',
          voiceMinutesLimit: 300,
        },
        {
          id: 'c-2',
          name: 'Dormida Ltda',
          rut: '2-7',
          isActive: true,
          createdAt: HACE_MESES,
          timezone: 'America/Santiago',
          voiceMinutesLimit: null,
        },
      ]),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'c-1', isActive: true, name: 'Activa SpA' }),
      update: companyUpdate,
    },
    membership: {
      groupBy: jest.fn().mockResolvedValue([{ companyId: 'c-1', _count: 3 }]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    agent: {
      groupBy: jest.fn().mockResolvedValue([{ companyId: 'c-1', _count: 2 }]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    integration: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ companyId: 'c-1', channel: 'whatsapp' }]),
    },
    knowledgeDocument: {
      groupBy: jest.fn().mockResolvedValue([{ companyId: 'c-1', _count: 4 }]),
      count: jest.fn().mockResolvedValue(4),
    },
    structuredFact: {
      groupBy: jest.fn().mockResolvedValue([{ companyId: 'c-1', _count: 1 }]),
      count: jest.fn().mockResolvedValue(1),
    },
    lead: {
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { companyId: 'c-1', _count: 50 },
          { companyId: 'c-2', _count: 7 },
        ])
        .mockResolvedValueOnce([{ companyId: 'c-1', _count: 12 }]),
      count: jest.fn().mockResolvedValue(50),
    },
    interaction: {
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ companyId: 'c-1', _count: 400 }])
        .mockResolvedValueOnce([
          { companyId: 'c-1', _max: { occurredAt: AYER } },
          { companyId: 'c-2', _max: { occurredAt: HACE_MESES } },
        ]),
      count: jest.fn().mockResolvedValue(400),
      aggregate: jest.fn().mockResolvedValue({ _max: { occurredAt: AYER } }),
    },
    appointment: { count: jest.fn().mockResolvedValue(9) },
    voiceCall: {
      // Dos llamadas gestionadas de este mes: 61 s (2 min) y 30 s (1 min).
      findMany: jest.fn().mockResolvedValue([
        { companyId: 'c-1', startedAt: new Date(), durationSecs: 61 },
        { companyId: 'c-1', startedAt: new Date(), durationSecs: 30 },
      ]),
    },
    auditLog: { create: auditCreate },
    ...overrides,
  };

  const prisma = {
    raw: base,
    // Si el servicio usara el cliente con filtro por empresa, reventaría acá:
    // una vista de plataforma TIENE que ir por `raw`, explícitamente.
    get db(): never {
      throw new Error('PlatformService no debe usar el cliente con tenant');
    },
  } as unknown as PrismaService;

  const auth = { registerCompany } as unknown as AuthService;
  const voiceUsage = {
    defaultLimit: 60,
    minutesUsed: jest.fn().mockResolvedValue(7),
  } as unknown as VoiceUsageService;
  return {
    service: new PlatformService(prisma, auth, voiceUsage),
    auditCreate,
    base,
  };
}

describe('PlatformService.listCompanies', () => {
  it('resume cada cliente con su uso', async () => {
    const { service } = buildHarness();

    const [activa, dormida] = await service.listCompanies();

    expect(activa).toMatchObject({
      name: 'Activa SpA',
      usuarios: 3,
      agentesActivos: 2,
      canales: ['whatsapp'],
      conocimiento: 5,
      leads: 50,
      leadsRecientes: 12,
      mensajesRecientes: 400,
      ultimaActividad: AYER,
    });
    // La que nunca activó nada queda en cero, no en undefined: la tabla del
    // panel tiene que poder pintarla igual.
    expect(dormida).toMatchObject({
      name: 'Dormida Ltda',
      usuarios: 0,
      agentesActivos: 0,
      canales: [],
      conocimiento: 0,
      leads: 7,
      leadsRecientes: 0,
      mensajesRecientes: 0,
    });
  });

  it('no consulta una vez por empresa: el costo no crece con los clientes', async () => {
    const { service, base } = buildHarness();

    await service.listCompanies();

    expect(base.lead.groupBy).toHaveBeenCalledTimes(2);
    expect(base.interaction.groupBy).toHaveBeenCalledTimes(2);
    expect(base.membership.groupBy).toHaveBeenCalledTimes(1);
  });
});

describe('PlatformService.getCompany', () => {
  it('trae la ficha con quién tiene acceso', async () => {
    const { service, base } = buildHarness();
    base.membership.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        createdAt: HACE_MESES,
        user: { email: 'ana@demo.cl', name: 'Ana' },
      },
    ]);
    base.agent.findMany.mockResolvedValue([
      { name: 'Ventas', type: 'VENTAS', isActive: true },
    ]);
    base.company.findUnique.mockResolvedValue({
      id: 'c-1',
      name: 'Activa SpA',
      rut: '1-9',
      isActive: true,
      createdAt: HACE_MESES,
      timezone: 'America/Santiago',
    });
    base.integration.findMany.mockResolvedValue([
      {
        channel: 'whatsapp',
        provider: 'ycloud',
        isActive: true,
        webhookSecretEnc: 'cifrado',
      },
    ]);

    const detalle = await service.getCompany('c-1');

    expect(detalle.usuariosDetalle).toEqual([
      {
        email: 'ana@demo.cl',
        name: 'Ana',
        role: 'OWNER',
        desde: HACE_MESES,
      },
    ]);
    expect(detalle.agentes).toHaveLength(1);
    expect(detalle.citas).toBe(9);
  });

  it('NUNCA devuelve los secretos de integración, solo si existen', async () => {
    const { service, base } = buildHarness();
    base.integration.findMany.mockResolvedValue([
      {
        channel: 'whatsapp',
        provider: 'ycloud',
        isActive: true,
        webhookSecretEnc: 'esto-es-secreto',
      },
    ]);

    const detalle = await service.getCompany('c-1');

    expect(detalle.integraciones[0]).toEqual({
      channel: 'whatsapp',
      provider: 'ycloud',
      isActive: true,
      tieneSecretoWebhook: true,
    });
    expect(JSON.stringify(detalle)).not.toContain('esto-es-secreto');
  });

  it('404 si la empresa no existe', async () => {
    const { service, base } = buildHarness();
    base.company.findUnique.mockResolvedValue(null);

    await expect(service.getCompany('c-9')).rejects.toThrow(NotFoundException);
  });
});

describe('PlatformService.createDemoCompany', () => {
  const registerOk = () =>
    jest.fn().mockResolvedValue({
      company: { id: 'c-demo', name: 'Demo SpA' },
      webhookSecret: 'secreto-webhook',
    });

  it('reusa el registro normal: la demo queda igual que un cliente real', async () => {
    const registerCompany = registerOk();
    const { service } = buildHarness({}, registerCompany);

    const creada = await service.createDemoCompany(
      { companyName: 'Demo SpA', email: 'demo@x.cl', password: 'clave-1234' },
      'admin-1',
    );

    expect(registerCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Demo SpA',
        email: 'demo@x.cl',
        password: 'clave-1234',
      }),
    );
    expect(creada).toMatchObject({
      companyId: 'c-demo',
      password: 'clave-1234',
      webhookSecret: 'secreto-webhook',
    });
  });

  it('genera una contraseña si no se la dan, y la devuelve una vez', async () => {
    const registerCompany = registerOk();
    const { service } = buildHarness({}, registerCompany);

    const creada = await service.createDemoCompany(
      { companyName: 'Demo SpA', email: 'demo@x.cl' },
      'admin-1',
    );

    expect(creada.password.length).toBeGreaterThanOrEqual(8);
    expect(registerCompany.mock.calls[0][0].password).toBe(creada.password);
  });

  it('deja constancia de quién creó la demo', async () => {
    const { service, auditCreate } = buildHarness({}, registerOk());

    await service.createDemoCompany(
      { companyName: 'Demo SpA', email: 'demo@x.cl' },
      'admin-1',
    );

    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c-demo',
        userId: 'admin-1',
        action: 'platform_create_demo',
      }),
    });
  });
});

describe('PlatformService.setCompanyActive', () => {
  it('desactiva y audita el cambio con el valor anterior', async () => {
    const { service, auditCreate } = buildHarness();

    const out = await service.setCompanyActive('c-1', false, 'admin-1');

    expect(out).toEqual({ id: 'c-1', isActive: false });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'platform_set_company_active',
        newValue: { antes: true, despues: false },
      }),
    });
  });

  it('404 si la empresa no existe', async () => {
    const { service, base } = buildHarness();
    base.company.findUnique.mockResolvedValue(null);

    await expect(
      service.setCompanyActive('c-9', false, 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PlatformService — voz gestionada', () => {
  it('muestra los minutos del mes de cada empresa y su tope', async () => {
    const { service } = buildHarness();

    const [activa, dormida] = await service.listCompanies();

    // Cada llamada se redondea al minuto hacia arriba: 61 s = 2, 30 s = 1.
    expect(activa.voz).toEqual({
      minutosMes: 3,
      tope: 300,
      topePorDefecto: false,
    });
    // Sin tope propio: el de la plataforma.
    expect(dormida.voz).toEqual({
      minutosMes: 0,
      tope: 60,
      topePorDefecto: true,
    });
  });

  it('cambia el tope y deja constancia con el valor anterior', async () => {
    const { service, base, auditCreate } = buildHarness({
      company: {
        findUnique: jest.fn().mockResolvedValue({ voiceMinutesLimit: 100 }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'c-1', voiceMinutesLimit: 500 }),
      },
    });

    await expect(service.setVoiceLimit('c-1', 500, 'admin-1')).resolves.toEqual(
      {
        id: 'c-1',
        voiceMinutesLimit: 500,
      },
    );
    expect((base.company.update as jest.Mock).mock.calls[0][0].data).toEqual({
      voiceMinutesLimit: 500,
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'platform_set_voice_limit',
        newValue: { antes: 100, despues: 500 },
      }),
    });
  });
});
