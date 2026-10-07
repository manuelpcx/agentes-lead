import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { VoiceUsageService, startOfMonth } from '../voice/voice-usage.service';
import { CreateDemoCompanyDto } from './dto/create-demo-company.dto';

/**
 * Vista de plataforma: qué empresas usan la aplicación y cómo. Es el único
 * lugar del sistema que consulta a TODAS las empresas a la vez, así que usa
 * `prisma.raw` (sin el filtro por empresa) de forma deliberada y explícita.
 *
 * Lo que NO hace, también a propósito: no expone el contenido de las
 * conversaciones ni los datos de los leads. Eso es información personal de los
 * clientes de nuestros clientes; acá se ven agregados y configuración. Si
 * alguna vez hace falta mirar una conversación puntual para dar soporte, que
 * sea una acción aparte, pedida y registrada, y no el comportamiento normal
 * de esta pantalla.
 */

/** Ventana para las métricas de "uso reciente". */
const DIAS_RECIENTES = 30;

/** Resumen de una empresa para el listado. */
export interface CompanySummary {
  id: string;
  name: string;
  rut: string;
  isActive: boolean;
  createdAt: Date;
  usuarios: number;
  agentesActivos: number;
  /** Canales con integración activa: whatsapp, email, voice, crm. */
  canales: string[];
  /** Documentos + datos cargados en la base de conocimiento. */
  conocimiento: number;
  leads: number;
  leadsRecientes: number;
  mensajesRecientes: number;
  /** Última interacción de cualquier canal. Null = nunca conversó. */
  ultimaActividad: Date | null;
  /** Voz gestionada: minutos del mes en curso y tope (el efectivo). */
  voz: { minutosMes: number; tope: number; topePorDefecto: boolean };
}

export interface CompanyDetail extends CompanySummary {
  timezone: string;
  usuariosDetalle: Array<{
    email: string;
    name: string | null;
    role: string;
    desde: Date;
  }>;
  agentes: Array<{ name: string; type: string; isActive: boolean }>;
  integraciones: Array<{
    channel: string;
    provider: string;
    isActive: boolean;
    /** Si tiene secreto de firma guardado. Nunca el secreto en sí. */
    tieneSecretoWebhook: boolean;
  }>;
  citas: number;
  escalamientos: number;
}

/** Lo que se devuelve UNA sola vez al crear una demo. */
export interface DemoCompanyCreated {
  companyId: string;
  companyName: string;
  email: string;
  /** En claro, solo en esta respuesta. */
  password: string;
  /** En claro, solo en esta respuesta (igual que en el registro normal). */
  webhookSecret: string;
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly voiceUsage: VoiceUsageService,
  ) {}

  /**
   * Listado de clientes con su uso. Las cuentas se resuelven con una consulta
   * agregada por tabla, no una por empresa: el costo no crece con la cantidad
   * de clientes.
   */
  async listCompanies(): Promise<CompanySummary[]> {
    const desde = new Date(Date.now() - DIAS_RECIENTES * 24 * 60 * 60 * 1000);
    const raw = this.prisma.raw;

    const [
      companies,
      memberships,
      agentes,
      integraciones,
      documentos,
      datos,
      leads,
      leadsRecientes,
      mensajesRecientes,
      ultimaActividad,
      llamadas,
    ] = await Promise.all([
      raw.company.findMany({
        select: {
          id: true,
          name: true,
          rut: true,
          isActive: true,
          createdAt: true,
          timezone: true,
          voiceMinutesLimit: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      raw.membership.groupBy({ by: ['companyId'], _count: true }),
      raw.agent.groupBy({
        by: ['companyId'],
        where: { isActive: true },
        _count: true,
      }),
      raw.integration.findMany({
        where: { isActive: true },
        select: { companyId: true, channel: true },
      }),
      raw.knowledgeDocument.groupBy({
        by: ['companyId'],
        where: { isActive: true },
        _count: true,
      }),
      raw.structuredFact.groupBy({
        by: ['companyId'],
        where: { isActive: true },
        _count: true,
      }),
      raw.lead.groupBy({ by: ['companyId'], _count: true }),
      raw.lead.groupBy({
        by: ['companyId'],
        where: { createdAt: { gte: desde } },
        _count: true,
      }),
      raw.interaction.groupBy({
        by: ['companyId'],
        where: { occurredAt: { gte: desde } },
        _count: true,
      }),
      raw.interaction.groupBy({
        by: ['companyId'],
        _max: { occurredAt: true },
      }),
      // Llamadas gestionadas desde un poco antes del inicio del mes en UTC:
      // cubre el mes en curso de cualquier zona horaria. Cada empresa se filtra
      // después por el inicio de SU mes.
      raw.voiceCall.findMany({
        where: {
          managed: true,
          startedAt: { gte: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000) },
        },
        select: { companyId: true, startedAt: true, durationSecs: true },
      }),
    ]);

    const cuenta = (
      filas: Array<{ companyId: string; _count: number }>,
    ): Map<string, number> =>
      new Map(filas.map((f) => [f.companyId, f._count]));

    const porUsuarios = cuenta(memberships);
    const porAgentes = cuenta(agentes);
    const porDocumentos = cuenta(documentos);
    const porDatos = cuenta(datos);
    const porLeads = cuenta(leads);
    const porLeadsRecientes = cuenta(leadsRecientes);
    const porMensajes = cuenta(mensajesRecientes);
    const porActividad = new Map(
      ultimaActividad.map((f) => [f.companyId, f._max.occurredAt ?? null]),
    );
    const porCanales = new Map<string, string[]>();
    for (const i of integraciones) {
      porCanales.set(i.companyId, [
        ...(porCanales.get(i.companyId) ?? []),
        i.channel,
      ]);
    }

    const ahora = new Date();
    const llamadasPorEmpresa = new Map<string, typeof llamadas>();
    for (const l of llamadas) {
      llamadasPorEmpresa.set(l.companyId, [
        ...(llamadasPorEmpresa.get(l.companyId) ?? []),
        l,
      ]);
    }
    const minutosDelMes = (companyId: string, timezone: string): number => {
      const inicio = startOfMonth(ahora, timezone);
      return (llamadasPorEmpresa.get(companyId) ?? [])
        .filter((l) => l.startedAt >= inicio)
        .reduce((t, l) => t + Math.ceil((l.durationSecs ?? 0) / 60), 0);
    };

    return companies.map(({ timezone, voiceMinutesLimit, ...c }) => ({
      ...c,
      voz: {
        minutosMes: minutosDelMes(c.id, timezone),
        tope: voiceMinutesLimit ?? this.voiceUsage.defaultLimit,
        topePorDefecto: voiceMinutesLimit === null,
      },
      usuarios: porUsuarios.get(c.id) ?? 0,
      agentesActivos: porAgentes.get(c.id) ?? 0,
      canales: porCanales.get(c.id) ?? [],
      conocimiento: (porDocumentos.get(c.id) ?? 0) + (porDatos.get(c.id) ?? 0),
      leads: porLeads.get(c.id) ?? 0,
      leadsRecientes: porLeadsRecientes.get(c.id) ?? 0,
      mensajesRecientes: porMensajes.get(c.id) ?? 0,
      ultimaActividad: porActividad.get(c.id) ?? null,
    }));
  }

  /** Ficha de una empresa: configuración y quién tiene acceso. */
  async getCompany(companyId: string): Promise<CompanyDetail> {
    const raw = this.prisma.raw;
    const company = await raw.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        rut: true,
        isActive: true,
        createdAt: true,
        timezone: true,
        voiceMinutesLimit: true,
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const { voiceMinutesLimit, ...companyBase } = company;

    const desde = new Date(Date.now() - DIAS_RECIENTES * 24 * 60 * 60 * 1000);
    const [
      memberships,
      agentes,
      integraciones,
      documentos,
      datos,
      leads,
      leadsRecientes,
      mensajesRecientes,
      ultima,
      citas,
      escalamientos,
    ] = await Promise.all([
      raw.membership.findMany({
        where: { companyId },
        select: {
          role: true,
          createdAt: true,
          user: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      raw.agent.findMany({
        where: { companyId },
        select: { name: true, type: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      raw.integration.findMany({
        where: { companyId },
        // Nunca los secretos: solo si existen.
        select: {
          channel: true,
          provider: true,
          isActive: true,
          webhookSecretEnc: true,
        },
      }),
      raw.knowledgeDocument.count({ where: { companyId, isActive: true } }),
      raw.structuredFact.count({ where: { companyId, isActive: true } }),
      raw.lead.count({ where: { companyId } }),
      raw.lead.count({ where: { companyId, createdAt: { gte: desde } } }),
      raw.interaction.count({
        where: { companyId, occurredAt: { gte: desde } },
      }),
      raw.interaction.aggregate({
        where: { companyId },
        _max: { occurredAt: true },
      }),
      raw.appointment.count({ where: { companyId } }),
      raw.lead.count({ where: { companyId, status: 'ESCALADO_HUMANO' } }),
    ]);

    return {
      ...companyBase,
      voz: {
        minutosMes: await this.voiceUsage.minutesUsed(
          companyId,
          company.timezone,
        ),
        tope: voiceMinutesLimit ?? this.voiceUsage.defaultLimit,
        topePorDefecto: voiceMinutesLimit === null,
      },
      usuarios: memberships.length,
      agentesActivos: agentes.filter((a) => a.isActive).length,
      canales: integraciones.filter((i) => i.isActive).map((i) => i.channel),
      conocimiento: documentos + datos,
      leads,
      leadsRecientes,
      mensajesRecientes,
      ultimaActividad: ultima._max.occurredAt ?? null,
      usuariosDetalle: memberships.map((m) => ({
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        desde: m.createdAt,
      })),
      agentes,
      integraciones: integraciones.map((i) => ({
        channel: i.channel,
        provider: i.provider,
        isActive: i.isActive,
        tieneSecretoWebhook: !!i.webhookSecretEnc,
      })),
      citas,
      escalamientos,
    };
  }

  /**
   * Crea una empresa de demostración con su usuario dueño. Reusa el registro
   * normal, así que la cuenta queda idéntica a la de un cliente real: mismo
   * agente por defecto, mismo secreto de webhook.
   *
   * Sin datos de ejemplo a propósito: los leads y el conocimiento dependen de
   * a quién se le muestre, y se cargan desde el panel.
   */
  async createDemoCompany(
    dto: CreateDemoCompanyDto,
    adminUserId: string,
  ): Promise<DemoCompanyCreated> {
    // Si no dan contraseña, una al azar: es de un solo uso y se muestra una vez.
    const password = dto.password ?? randomBytes(9).toString('base64url');
    const { company, webhookSecret } = await this.auth.registerCompany({
      companyName: dto.companyName,
      rut: dto.rut ?? 'DEMO',
      email: dto.email,
      password,
      name: dto.name,
    });

    await this.audit(adminUserId, company.id, 'platform_create_demo', {
      companyName: company.name,
      email: dto.email,
    });
    this.logger.log(
      `Demo creada por plataforma: ${company.name} (companyId=${company.id})`,
    );

    return {
      companyId: company.id,
      companyName: company.name,
      email: dto.email,
      password,
      webhookSecret,
    };
  }

  /** Activa o desactiva una empresa entera. */
  async setCompanyActive(
    companyId: string,
    isActive: boolean,
    adminUserId: string,
  ): Promise<{ id: string; isActive: boolean }> {
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { isActive: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const updated = await this.prisma.raw.company.update({
      where: { id: companyId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
    await this.audit(adminUserId, companyId, 'platform_set_company_active', {
      antes: company.isActive,
      despues: isActive,
    });
    return updated;
  }

  /**
   * Tope mensual de minutos de voz gestionada. `null` vuelve al valor por
   * defecto; 0 deja a la empresa sin llamadas.
   */
  async setVoiceLimit(
    companyId: string,
    minutes: number | null,
    adminUserId: string,
  ): Promise<{ id: string; voiceMinutesLimit: number | null }> {
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { voiceMinutesLimit: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const updated = await this.prisma.raw.company.update({
      where: { id: companyId },
      data: { voiceMinutesLimit: minutes },
      select: { id: true, voiceMinutesLimit: true },
    });
    await this.audit(adminUserId, companyId, 'platform_set_voice_limit', {
      antes: company.voiceMinutesLimit,
      despues: minutes,
    });
    return updated;
  }

  /**
   * Deja constancia de lo que escribe la plataforma. No reusa `AuditService`
   * porque ese toma el `companyId` del contexto de tenant, y acá no hay
   * ninguno activo: la empresa afectada se pasa explícita.
   */
  private async audit(
    userId: string,
    companyId: string,
    action: string,
    newValue: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.raw.auditLog.create({
      data: { companyId, userId, action, entity: 'Company', newValue },
    });
  }
}
