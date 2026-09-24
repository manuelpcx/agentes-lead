import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadStatus, Prisma } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { parseCsv } from './csv';
import {
  CLOSED_STATUSES,
  ImportField,
  mapStatus,
  normalizeEmail,
  normalizePhone,
  prefixFromTimezone,
  suggestMapping,
} from './lead-mapping';

/** Tope de filas por archivo. Más que esto conviene partirlo en tandas. */
export const MAX_IMPORT_ROWS = 5000;
/** Filas de ejemplo que se muestran en el paso de mapeo. */
const SAMPLE_ROWS = 5;
/** Tamaño de lote para escribir y para los `IN (...)` de búsqueda. */
const CHUNK = 500;
/** Errores que se devuelven al panel (el conteo total sí es completo). */
const MAX_REPORTED_ERRORS = 50;
/**
 * Separación entre primeros contactos cuando la persona pide que el agente
 * salga a hablarles. Importar 2.000 contactos y escribirles a todos en el
 * mismo minuto es spam: se reparten de a uno por minuto.
 */
const STAGGER_MS = 60_000;

/** Lo que ve el panel antes de confirmar: qué trae el archivo y qué entendimos. */
export interface ImportPreview {
  delimiter: string;
  headers: string[];
  /** Filas de datos detectadas (sin contar la cabecera). */
  totalRows: number;
  sample: string[][];
  /** Campo propuesto por cada cabecera; `null` = no reconocida. */
  mapping: Record<string, ImportField | null>;
  /** Prefijo país sugerido según la zona horaria de la empresa. */
  suggestedPrefix: string;
  /** Filas que superaban el tope y no se van a importar. */
  truncated: number;
}

/** Qué hacer con un lead que ya existe en nuestra base. */
export type DuplicateMode = 'update' | 'skip';

export interface ImportOptions {
  /** cabecera -> campo. Las cabeceras ausentes van a `metadata.datosOriginales`. */
  mapping: Record<string, ImportField>;
  /** Prefijo país para los teléfonos que vengan sin código internacional. */
  phonePrefix: string;
  duplicates: DuplicateMode;
  /** Si es true, agenda el primer contacto del agente. Por defecto NO. */
  scheduleFirstContact: boolean;
  /** Etiqueta de origen para los leads nuevos (ej. "hubspot"). */
  source?: string;
  /** Nombre del archivo, solo para dejar rastro en la metadata. */
  fileName?: string;
}

export interface ImportError {
  /** Número de línea en el archivo (1 = cabecera). */
  row: number;
  reason: string;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  /** Filas descartadas por no tener datos utilizables. */
  failed: number;
  errors: ImportError[];
  truncated: number;
  /** true si se agendó el primer contacto del agente. */
  scheduledFirstContact: boolean;
}

/** Fila ya interpretada y lista para escribir. */
interface PreparedRow {
  row: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  campaign: string | null;
  status: LeadStatus;
  externalId: string;
  extras: Record<string, string>;
}

/** Lead ya existente, con lo justo para decidir si completarlo. */
interface ExistingLead {
  id: string;
  externalId: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  source: string | null;
  campaign: string | null;
  metadata: Prisma.JsonValue;
}

/** Leads existentes indexados por las tres claves con las que cruzamos. */
interface ExistingIndex {
  byExternalId: Map<string, ExistingLead>;
  byPhone: Map<string, ExistingLead>;
  byEmail: Map<string, ExistingLead>;
}

/**
 * Importación masiva de leads desde el CSV que exporta el CRM anterior del
 * cliente (HubSpot, Pipedrive, Zoho, una planilla…). Es la vía de entrada
 * "me traigo mi base", complementaria al webhook (que trae leads de a uno en
 * vivo) y al alta manual del panel.
 *
 * Dos decisiones de diseño que importan:
 *
 * 1. **No pasa por `LeadsService.ingest`.** Esa ruta programa el primer
 *    contacto (`nextActionAt = ahora + retardo`) porque asume un lead recién
 *    capturado. Importar una base histórica por ahí haría que el agente
 *    saliera a escribirle a miles de personas que llevan meses sin hablarnos.
 *    Acá el contacto automático es opt-in explícito y, aun así, escalonado.
 * 2. **No inventa datos.** Un teléfono que no se puede llevar a E.164 con
 *    certeza no se guarda: la fila se reporta como error con su número de
 *    línea para que la persona lo corrija en la planilla.
 */
@Injectable()
export class LeadImportService {
  private readonly logger = new Logger(LeadImportService.name);
  private readonly firstContactDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly audit: AuditService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.firstContactDelayMs =
      config.get('FOLLOWUP_FIRST_CONTACT_DELAY_MIN', { infer: true }) * 60_000;
  }

  /** Lee el archivo y propone el mapeo, sin escribir nada. */
  async preview(csvText: string): Promise<ImportPreview> {
    const parsed = parseCsv(csvText, { maxRows: MAX_IMPORT_ROWS });
    if (parsed.headers.length === 0) {
      throw new BadRequestException('El archivo está vacío.');
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException(
        'El archivo solo trae la fila de títulos, sin contactos.',
      );
    }
    return {
      delimiter: parsed.delimiter,
      headers: parsed.headers,
      totalRows: parsed.rows.length,
      sample: parsed.rows.slice(0, SAMPLE_ROWS),
      mapping: suggestMapping(parsed.headers),
      suggestedPrefix: prefixFromTimezone(await this.companyTimezone()),
      truncated: parsed.truncated,
    };
  }

  /** Importa de verdad. Devuelve el resumen de lo que pasó con cada fila. */
  async run(
    csvText: string,
    options: ImportOptions,
    userId: string,
  ): Promise<ImportResult> {
    const parsed = parseCsv(csvText, { maxRows: MAX_IMPORT_ROWS });
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      throw new BadRequestException('El archivo no trae contactos.');
    }
    const mapped = new Set(Object.values(options.mapping));
    if (!mapped.has('phone') && !mapped.has('email')) {
      throw new BadRequestException(
        'Hay que indicar al menos qué columna trae el teléfono o el email; sin eso no hay a quién contactar.',
      );
    }

    const errors: ImportError[] = [];
    const prepared: PreparedRow[] = [];
    const seen = new Set<string>();
    let failed = 0;
    let skipped = 0;

    parsed.rows.forEach((cells, index) => {
      // +2: la fila 1 del archivo es la cabecera y el índice parte en 0.
      const row = index + 2;
      const result = this.prepareRow(cells, parsed.headers, options, row);
      if ('reason' in result) {
        failed++;
        if (errors.length < MAX_REPORTED_ERRORS) {
          errors.push({ row, reason: result.reason });
        }
        return;
      }
      // Duplicado dentro del mismo archivo: la primera aparición manda.
      const keys = this.dedupeKeys(result.prepared);
      if (keys.some((k) => seen.has(k))) {
        skipped++;
        return;
      }
      keys.forEach((k) => seen.add(k));
      prepared.push(result.prepared);
    });

    const index = await this.findExisting(prepared);
    const agentId = await this.agents.resolveDefaultAgentId(this.prisma.db, {
      status: LeadStatus.NUEVO,
    });

    const toCreate: PreparedRow[] = [];
    const toUpdate: { lead: ExistingLead; row: PreparedRow }[] = [];
    for (const row of prepared) {
      const match = this.matchExisting(row, index);
      if (!match) {
        toCreate.push(row);
      } else if (options.duplicates === 'update') {
        toUpdate.push({ lead: match, row });
      } else {
        skipped++;
      }
    }

    const created = await this.createLeads(toCreate, agentId, options);
    const updated = await this.completeLeads(toUpdate, options);
    // Lo que no se creó ni se actualizó quedó igual que antes: omitido.
    skipped += toCreate.length - created + (toUpdate.length - updated);

    const result: ImportResult = {
      total: parsed.rows.length,
      created,
      updated,
      skipped,
      failed,
      errors,
      truncated: parsed.truncated,
      scheduledFirstContact: options.scheduleFirstContact,
    };

    await this.audit.record({
      userId,
      action: 'import_leads',
      entity: 'Lead',
      newValue: {
        archivo: options.fileName ?? null,
        origen: options.source ?? null,
        total: result.total,
        creados: result.created,
        actualizados: result.updated,
        omitidos: result.skipped,
        fallidos: result.failed,
        contactoAutomatico: options.scheduleFirstContact,
      } as Prisma.InputJsonValue,
    });
    this.logger.log(
      `Importación: ${result.created} creados, ${result.updated} actualizados, ${result.skipped} omitidos, ${result.failed} con error.`,
    );
    return result;
  }

  // ─────────────────────────── interpretación ───────────────────────────

  /** Convierte una fila cruda en un lead listo, o dice por qué no se puede. */
  private prepareRow(
    cells: string[],
    headers: string[],
    options: ImportOptions,
    row: number,
  ): { prepared: PreparedRow } | { reason: string } {
    const values: Partial<Record<ImportField, string>> = {};
    const extras: Record<string, string> = {};

    headers.forEach((header, i) => {
      const value = (cells[i] ?? '').trim();
      const field = options.mapping[header];
      if (field) {
        if (value) values[field] = value;
      } else if (value) {
        extras[header] = value;
      }
    });

    const rawPhone = values.phone ?? '';
    const phone = rawPhone
      ? normalizePhone(rawPhone, options.phonePrefix)
      : null;
    if (rawPhone && !phone) {
      return {
        reason: `El teléfono "${rawPhone}" no se pudo interpretar. Déjalo en formato internacional (${options.phonePrefix}...) o borra la celda.`,
      };
    }

    const rawEmail = values.email ?? '';
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (rawEmail && !email) {
      return { reason: `El email "${rawEmail}" no es válido.` };
    }

    if (!phone && !email) {
      return { reason: 'La fila no trae teléfono ni email.' };
    }

    const externalId = this.buildExternalId(values.externalId, phone, email);
    return {
      prepared: {
        row,
        name: values.name ?? null,
        phone,
        email,
        source: values.source ?? options.source ?? 'import',
        campaign: values.campaign ?? null,
        // Etapa desconocida => NUEVO: es el estado que menos supone.
        status: (values.status && mapStatus(values.status)) || LeadStatus.NUEVO,
        externalId,
        extras,
      },
    };
  }

  /**
   * Identificador estable para que reimportar el mismo archivo actualice en
   * vez de duplicar. Si el CRM de origen trae su propio id lo usamos con
   * prefijo `crm:`; si no, derivamos del contacto.
   */
  private buildExternalId(
    rawId: string | undefined,
    phone: string | null,
    email: string | null,
  ): string {
    if (rawId) return `crm:${rawId}`.slice(0, 200);
    return `imp:${phone ?? email}`.slice(0, 200);
  }

  /** Claves con las que se detecta un duplicado (dentro y fuera del archivo). */
  private dedupeKeys(row: PreparedRow): string[] {
    const keys = [`id:${row.externalId}`];
    if (row.phone) keys.push(`tel:${row.phone}`);
    if (row.email) keys.push(`mail:${row.email}`);
    return keys;
  }

  // ─────────────────────────── base de datos ───────────────────────────

  /**
   * Busca los leads que ya tenemos, por externalId, teléfono o email, y los
   * devuelve indexados. Con archivos de miles de filas un `find` lineal por
   * fila sería cuadrático; acá cada cruce es una búsqueda en Map.
   */
  private async findExisting(rows: PreparedRow[]): Promise<ExistingIndex> {
    const select = {
      id: true,
      externalId: true,
      phone: true,
      email: true,
      name: true,
      source: true,
      campaign: true,
      metadata: true,
    } as const;

    const found = new Map<string, ExistingLead>();
    const collect = async (
      where: (chunk: string[]) => Prisma.LeadWhereInput,
      values: string[],
    ) => {
      for (const chunk of chunks(unique(values), CHUNK)) {
        const leads = await this.prisma.db.lead.findMany({
          where: where(chunk),
          select,
        });
        leads.forEach((lead) => found.set(lead.id, lead));
      }
    };

    await collect(
      (chunk) => ({ externalId: { in: chunk } }),
      rows.map((r) => r.externalId),
    );
    await collect(
      (chunk) => ({ phone: { in: chunk } }),
      rows.flatMap((r) => (r.phone ? [r.phone] : [])),
    );
    await collect(
      (chunk) => ({ email: { in: chunk } }),
      rows.flatMap((r) => (r.email ? [r.email] : [])),
    );

    const index: ExistingIndex = {
      byExternalId: new Map(),
      byPhone: new Map(),
      byEmail: new Map(),
    };
    for (const lead of found.values()) {
      index.byExternalId.set(lead.externalId, lead);
      if (lead.phone) index.byPhone.set(lead.phone, lead);
      if (lead.email) index.byEmail.set(lead.email, lead);
    }
    return index;
  }

  /** Cruza una fila con los leads existentes: id externo, luego teléfono, luego email. */
  private matchExisting(
    row: PreparedRow,
    index: ExistingIndex,
  ): ExistingLead | undefined {
    return (
      index.byExternalId.get(row.externalId) ??
      (row.phone ? index.byPhone.get(row.phone) : undefined) ??
      (row.email ? index.byEmail.get(row.email) : undefined)
    );
  }

  /** Inserta los leads nuevos por lotes. Devuelve cuántos entraron. */
  private async createLeads(
    rows: PreparedRow[],
    agentId: string,
    options: ImportOptions,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const companyId = TenantContext.requireCompanyId();
    const importedAt = new Date().toISOString();
    const base = Date.now() + this.firstContactDelayMs;

    let created = 0;
    let scheduled = 0;
    for (const chunk of chunks(rows, CHUNK)) {
      const data = chunk.map((row) => {
        // Los cerrados nunca se contactan, aunque la persona lo haya pedido.
        const contactable =
          options.scheduleFirstContact && !CLOSED_STATUSES.includes(row.status);
        const nextActionAt = contactable
          ? new Date(base + scheduled++ * STAGGER_MS)
          : null;
        return {
          companyId,
          agentId,
          externalId: row.externalId,
          name: row.name,
          phone: row.phone,
          email: row.email,
          source: row.source,
          campaign: row.campaign,
          status: row.status,
          nextActionAt,
          nextActionType: nextActionAt ? 'primer_contacto' : null,
          metadata: this.buildMetadata(
            row,
            options,
            importedAt,
          ) as Prisma.InputJsonValue,
        };
      });
      // `skipDuplicates` cubre la carrera con el webhook: si el mismo lead
      // entra por otra vía a mitad de la importación, no revienta el lote.
      const result = await this.prisma.db.lead.createMany({
        data,
        skipDuplicates: true,
      });
      created += result.count;
    }
    return created;
  }

  /**
   * Completa los leads que ya teníamos: solo rellena campos vacíos. Nunca pisa
   * un dato nuestro — el agente pudo haber corregido el nombre conversando, y
   * la exportación del otro CRM puede estar más desactualizada que nosotros.
   */
  private async completeLeads(
    pairs: { lead: ExistingLead; row: PreparedRow }[],
    options: ImportOptions,
  ): Promise<number> {
    const importedAt = new Date().toISOString();
    let updated = 0;
    for (const { lead, row } of pairs) {
      const data: Prisma.LeadUpdateInput = {};
      if (!lead.name && row.name) data.name = row.name;
      if (!lead.phone && row.phone) data.phone = row.phone;
      if (!lead.email && row.email) data.email = row.email;
      if (!lead.source && row.source) data.source = row.source;
      if (!lead.campaign && row.campaign) data.campaign = row.campaign;

      const meta = this.buildMetadata(row, options, importedAt);
      const current =
        lead.metadata && typeof lead.metadata === 'object'
          ? (lead.metadata as Record<string, unknown>)
          : {};
      data.metadata = { ...current, ...meta } as Prisma.InputJsonValue;

      // La metadata siempre cambia (lleva la fecha de importación), así que
      // eso solo no cuenta como aporte: si no completamos ningún campo ni
      // traemos columnas extra del otro CRM, el lead queda como estaba.
      const aportaExtras = Object.keys(row.extras).length > 0;
      if (Object.keys(data).length === 1 && !aportaExtras) continue;
      await this.prisma.db.lead.update({ where: { id: lead.id }, data });
      updated++;
    }
    return updated;
  }

  /** Deja rastro del origen y guarda las columnas que no supimos mapear. */
  private buildMetadata(
    row: PreparedRow,
    options: ImportOptions,
    importedAt: string,
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      importadoDesde: options.source ?? options.fileName ?? 'csv',
      importadoEn: importedAt,
    };
    // Anidadas a propósito: una columna llamada "tipo" en el CSV ajeno no debe
    // terminar enrutando el lead a otro agente (ver `inferAgentType`).
    if (Object.keys(row.extras).length > 0) {
      meta.datosOriginales = row.extras;
    }
    return meta;
  }

  /** Zona horaria de la empresa activa (para sugerir el prefijo telefónico). */
  private async companyTimezone(): Promise<string | null> {
    const company = await this.prisma.raw.company.findUnique({
      where: { id: TenantContext.requireCompanyId() },
      select: { timezone: true },
    });
    return company?.timezone ?? null;
  }
}

/** Parte un arreglo en lotes de `size`. */
function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
