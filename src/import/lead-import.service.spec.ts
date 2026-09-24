import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadStatus } from '@prisma/client';
import { LeadImportService } from './lead-import.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant/tenant-context';

const COMPANY = 'company-1';

/** Lead ya existente, tal como lo devuelve el `select` del servicio. */
interface ExistingRow {
  id: string;
  externalId: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  source: string | null;
  campaign: string | null;
  metadata: Record<string, unknown>;
}

function buildHarness(existing: ExistingRow[] = []) {
  const created: Record<string, unknown>[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  const lead = {
    // Imita el filtro real: solo devuelve los que calzan con el `in`.
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const [field] = Object.keys(where).filter((k) => k !== 'companyId');
      const wanted = (where[field] as { in: string[] }).in;
      return Promise.resolve(
        existing.filter((row) =>
          wanted.includes(row[field as keyof ExistingRow] as string),
        ),
      );
    }),
    createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
      created.push(...data);
      return Promise.resolve({ count: data.length });
    }),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        updates.push({ id: where.id, data });
        return Promise.resolve({ id: where.id });
      },
    ),
  };

  const prisma = {
    db: { lead },
    raw: {
      company: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Mexico_City' }),
      },
    },
  } as unknown as PrismaService;

  const agents = {
    resolveDefaultAgentId: jest.fn().mockResolvedValue('agent-1'),
  } as unknown as AgentsService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const config = {
    get: jest.fn().mockReturnValue(5),
  } as unknown as ConfigService<never, true>;

  return {
    service: new LeadImportService(prisma, agents, audit, config),
    created,
    updates,
    lead,
    agents,
    audit,
  };
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ companyId: COMPANY, correlationId: 'c1' }, fn);
}

const CSV = [
  'Nombre,Teléfono,Correo,Etapa,Comuna',
  'Ana Pérez,+56911111111,ana@test.cl,Contacted,Ñuñoa',
  'Bruno Díaz,922222222,bruno@test.cl,Closed Won,Maipú',
].join('\n');

const MAPPING = {
  Nombre: 'name',
  Teléfono: 'phone',
  Correo: 'email',
  Etapa: 'status',
} as const;

function options(overrides: Record<string, unknown> = {}) {
  return {
    mapping: { ...MAPPING },
    phonePrefix: '+56',
    duplicates: 'update' as const,
    scheduleFirstContact: false,
    fileName: 'contactos.csv',
    ...overrides,
  } as Parameters<LeadImportService['run']>[1];
}

describe('LeadImportService.preview', () => {
  it('propone el mapeo y sugiere el prefijo según la zona horaria de la empresa', async () => {
    const { service } = buildHarness();
    const preview = await run(() => service.preview(CSV));

    expect(preview.headers).toEqual([
      'Nombre',
      'Teléfono',
      'Correo',
      'Etapa',
      'Comuna',
    ]);
    expect(preview.totalRows).toBe(2);
    expect(preview.mapping).toEqual({
      Nombre: 'name',
      Teléfono: 'phone',
      Correo: 'email',
      Etapa: 'status',
      Comuna: null,
    });
    expect(preview.suggestedPrefix).toBe('+52');
    expect(preview.sample).toHaveLength(2);
  });

  it('rechaza un archivo sin contactos', async () => {
    const { service } = buildHarness();
    await expect(run(() => service.preview('Nombre,Correo'))).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('LeadImportService.run', () => {
  it('crea los leads normalizando teléfono y estado, y guarda lo no mapeado', async () => {
    const { service, created } = buildHarness();
    const result = await run(() => service.run(CSV, options(), 'user-1'));

    expect(result).toMatchObject({
      total: 2,
      created: 2,
      updated: 0,
      failed: 0,
      skipped: 0,
    });
    expect(created[0]).toMatchObject({
      companyId: COMPANY,
      agentId: 'agent-1',
      name: 'Ana Pérez',
      phone: '+56911111111',
      email: 'ana@test.cl',
      status: LeadStatus.CONTACTADO,
      externalId: 'imp:+56911111111',
    });
    // El teléfono local se completó con el prefijo elegido.
    expect(created[1]).toMatchObject({ phone: '+56922222222' });
    // La columna que no supimos mapear no se pierde, pero va anidada para no
    // chocar con las claves que usa el enrutamiento por metadata.
    expect(created[0].metadata).toMatchObject({
      datosOriginales: { Comuna: 'Ñuñoa' },
    });
  });

  it('NO agenda contacto automático por defecto', async () => {
    const { service, created } = buildHarness();
    await run(() => service.run(CSV, options(), 'user-1'));
    expect(created.every((l) => l.nextActionAt === null)).toBe(true);
    expect(created.every((l) => l.nextActionType === null)).toBe(true);
  });

  it('cuando se pide contacto automático, lo escalona y salta a los cerrados', async () => {
    const { service, created } = buildHarness();
    const result = await run(() =>
      service.run(CSV, options({ scheduleFirstContact: true }), 'user-1'),
    );

    expect(result.scheduledFirstContact).toBe(true);
    // Ana (CONTACTADO) sí; Bruno viene "Closed Won" y no se le escribe.
    const ana = created[0].nextActionAt as Date;
    expect(ana).toBeInstanceOf(Date);
    expect(created[0].nextActionType).toBe('primer_contacto');
    expect(created[1].nextActionAt).toBeNull();
  });

  it('reporta la fila con su número de línea cuando el teléfono no es interpretable', async () => {
    const { service, created } = buildHarness();
    const csv = [
      'Nombre,Teléfono,Correo',
      'Ana,+56911111111,ana@test.cl',
      'Sin datos,no tiene,',
    ].join('\n');
    const result = await run(() =>
      service.run(
        csv,
        options({
          mapping: { Nombre: 'name', Teléfono: 'phone', Correo: 'email' },
        }),
        'user-1',
      ),
    );

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      { row: 3, reason: expect.stringContaining('no tiene') },
    ]);
    expect(created).toHaveLength(1);
  });

  it('no duplica al lead que ya existe: completa solo los campos vacíos', async () => {
    const { service, updates, created } = buildHarness([
      {
        id: 'lead-1',
        externalId: 'wa:+56911111111',
        phone: '+56911111111',
        email: null,
        name: 'Ana P.',
        source: 'whatsapp',
        campaign: null,
        metadata: { previo: true },
      },
    ]);
    const result = await run(() => service.run(CSV, options(), 'user-1'));

    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(created).toHaveLength(1);
    expect(updates[0].id).toBe('lead-1');
    // El email faltaba: se completa. El nombre ya estaba: no se pisa.
    expect(updates[0].data).toMatchObject({ email: 'ana@test.cl' });
    expect(updates[0].data.name).toBeUndefined();
    expect(updates[0].data.phone).toBeUndefined();
    expect(updates[0].data.metadata).toMatchObject({ previo: true });
  });

  it('con duplicados="skip" deja intacto lo que ya existe', async () => {
    const { service, updates } = buildHarness([
      {
        id: 'lead-1',
        externalId: 'x',
        phone: '+56911111111',
        email: null,
        name: null,
        source: null,
        campaign: null,
        metadata: {},
      },
    ]);
    const result = await run(() =>
      service.run(CSV, options({ duplicates: 'skip' }), 'user-1'),
    );

    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    expect(updates).toHaveLength(0);
  });

  it('descarta el duplicado dentro del mismo archivo', async () => {
    const { service, created } = buildHarness();
    const csv = [
      'Nombre,Teléfono',
      'Ana,+56911111111',
      'Ana repetida,56911111111',
    ].join('\n');
    const result = await run(() =>
      service.run(
        csv,
        options({ mapping: { Nombre: 'name', Teléfono: 'phone' } }),
        'user-1',
      ),
    );

    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(created).toHaveLength(1);
  });

  it('usa el id del CRM de origen como identificador estable si viene', async () => {
    const { service, created } = buildHarness();
    const csv = ['Record ID,Teléfono', '77123,+56911111111'].join('\n');
    await run(() =>
      service.run(
        csv,
        options({ mapping: { 'Record ID': 'externalId', Teléfono: 'phone' } }),
        'user-1',
      ),
    );
    expect(created[0].externalId).toBe('crm:77123');
  });

  it('exige que se indique al menos teléfono o email', async () => {
    const { service } = buildHarness();
    await expect(
      run(() =>
        service.run(CSV, options({ mapping: { Nombre: 'name' } }), 'u'),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deja el resumen en la auditoría', async () => {
    const { service, audit } = buildHarness();
    await run(() => service.run(CSV, options(), 'user-1'));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'import_leads',
        entity: 'Lead',
        newValue: expect.objectContaining({
          creados: 2,
          contactoAutomatico: false,
        }),
      }),
    );
  });
});
