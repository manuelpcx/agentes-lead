import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { CredentialsService } from '../integrations/credentials.service';
import { ImportResult, LeadImportService } from '../import/lead-import.service';
import { prefixFromTimezone } from '../import/lead-mapping';
import { assertSafeOutboundUrl, UnsafeUrlError } from '../common/safe-url';
import { aTabla, extraerRegistros, mapeoAutomatico } from './lead-source-parse';

/** Canal de integración donde se guardan las fuentes y su token. */
const CANAL = 'leads' as const;
export const MAX_FUENTES = 10;
/** Una API lenta no puede dejar colgado el botón. */
const TIMEOUT_MS = 20_000;
/** Tope de la respuesta: 5.000 leads caben de sobra. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Nombre del parámetro de fecha: solo letras, números, `_`, `-` y `.`. */
const PARAMETRO = /^[A-Za-z0-9_.-]{1,40}$/;

export interface FuenteDeLeads {
  nombre: string;
  url: string;
  /** ISO de la última carga exitosa de esta fuente. */
  ultimaCarga?: string;
}

/** Lo que ve el panel: nunca el token. */
export interface VistaFuentes {
  fuentes: FuenteDeLeads[];
  parametroFecha: string | null;
  tokenConfigurado: boolean;
  /** Hay al menos una fuente: el botón "Cargar nuevos leads" se activa. */
  lista: boolean;
}

export interface GuardarFuentes {
  fuentes: Array<{ nombre: string; url: string }>;
  /** Si no viene, se conserva el guardado. */
  token?: string;
  parametroFecha?: string | null;
}

export interface ResultadoFuente {
  nombre: string;
  ok: boolean;
  /** Registros que devolvió la API. */
  recibidos: number;
  resultado?: ImportResult;
  error?: string;
}

export interface ResultadoCarga {
  fuentes: ResultadoFuente[];
}

/** Inyectables para probar sin red. */
export interface LeadSourcesIo {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<{ address: string }[]>;
}
export const LEAD_SOURCES_IO = Symbol('LEAD_SOURCES_IO');

/** Un problema de una fuente, con un mensaje para mostrar tal cual. */
class FuenteError extends Error {}

/**
 * Fuentes de leads por API: la empresa configura las URLs de su sistema (y un
 * token) en Integraciones, y el botón "Cargar nuevos leads" las consulta y
 * trae lo nuevo. Es la entrada "pull": nosotros vamos a buscar, ellos no tienen
 * que firmar ni enviar nada.
 *
 * Reutiliza entera la importación por archivo (`importTable`): la misma
 * validación de teléfonos y correos, la misma deduplicación por id, teléfono
 * o correo, y el mismo primer contacto escalonado. Lo único propio es traer
 * la respuesta y adaptarla (`lead-source-parse.ts`).
 */
@Injectable()
export class LeadSourcesService {
  private readonly logger = new Logger(LeadSourcesService.name);
  /** Empresas con una carga en curso: dos clics no cargan dos veces. */
  private readonly enCurso = new Set<string>();
  private readonly fetcher: typeof fetch;
  private readonly lookup?: LeadSourcesIo['lookup'];

  constructor(
    private readonly credentials: CredentialsService,
    private readonly imports: LeadImportService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(LEAD_SOURCES_IO) io?: LeadSourcesIo,
  ) {
    this.fetcher = io?.fetch ?? fetch;
    this.lookup = io?.lookup;
  }

  async ver(): Promise<VistaFuentes> {
    const cred = await this.credentials.get(CANAL);
    const fuentes = leerFuentes(cred?.config);
    const parametro = cred?.config?.parametroFecha;
    return {
      fuentes,
      parametroFecha: typeof parametro === 'string' ? parametro : null,
      tokenConfigurado: !!cred?.secret,
      lista: fuentes.length > 0,
    };
  }

  async guardar(dto: GuardarFuentes, userId: string): Promise<VistaFuentes> {
    const fuentes = Array.isArray(dto.fuentes) ? dto.fuentes : [];
    if (fuentes.length > MAX_FUENTES) {
      throw new BadRequestException(`Máximo ${MAX_FUENTES} fuentes.`);
    }
    const parametro = dto.parametroFecha?.trim() || null;
    if (parametro && !PARAMETRO.test(parametro)) {
      throw new BadRequestException(
        'El parámetro de fecha solo puede tener letras, números, "_", "-" y ".".',
      );
    }

    const actuales = leerFuentes((await this.credentials.get(CANAL))?.config);
    const urls = new Set<string>();
    const limpias: FuenteDeLeads[] = [];
    for (const f of fuentes) {
      const nombre = String(f?.nombre ?? '').trim();
      const url = String(f?.url ?? '').trim();
      if (!nombre || nombre.length > 60) {
        throw new BadRequestException(
          'Cada fuente necesita un nombre de hasta 60 caracteres.',
        );
      }
      await this.validarUrl(url, nombre);
      if (urls.has(url)) {
        throw new BadRequestException(`La URL ${url} está repetida.`);
      }
      urls.add(url);
      // La fecha de la última carga sigue a la URL, no al nombre.
      const previa = actuales.find((a) => a.url === url)?.ultimaCarga;
      limpias.push({ nombre, url, ...(previa ? { ultimaCarga: previa } : {}) });
    }

    await this.credentials.upsert(CANAL, {
      provider: 'api',
      config: {
        fuentes: limpias,
        ...(parametro ? { parametroFecha: parametro } : {}),
      },
      ...(dto.token?.trim() ? { secret: dto.token.trim() } : {}),
    });
    await this.audit.record({
      userId,
      action: 'configure_lead_sources',
      entity: 'Integration',
      newValue: {
        fuentes: limpias.map((f) => ({ nombre: f.nombre, url: f.url })),
        parametroFecha: parametro,
        tokenCambiado: !!dto.token?.trim(),
      } as Prisma.InputJsonValue,
    });
    return this.ver();
  }

  /** El botón: consulta cada fuente e importa lo nuevo. */
  async cargar(userId: string): Promise<ResultadoCarga> {
    const companyId = TenantContext.requireCompanyId();
    const cred = await this.credentials.get(CANAL);
    const fuentes = leerFuentes(cred?.config);
    if (fuentes.length === 0) {
      throw new BadRequestException(
        'No hay fuentes de leads configuradas. Agrégalas en Integraciones.',
      );
    }
    if (this.enCurso.has(companyId)) {
      throw new ConflictException(
        'Ya hay una carga en curso. Espera a que termine.',
      );
    }
    this.enCurso.add(companyId);
    try {
      const parametro =
        typeof cred?.config?.parametroFecha === 'string'
          ? cred.config.parametroFecha
          : null;
      const prefijo = prefixFromTimezone(await this.zonaHoraria(companyId));
      const resultados: ResultadoFuente[] = [];
      for (const fuente of fuentes) {
        resultados.push(
          await this.cargarFuente(
            fuente,
            cred?.secret,
            parametro,
            prefijo,
            userId,
          ),
        );
      }
      // Se guarda la nueva fecha solo de las fuentes que salieron bien.
      await this.credentials.upsert(CANAL, {
        provider: 'api',
        config: { ...(cred?.config ?? {}), fuentes },
      });
      return { fuentes: resultados };
    } finally {
      this.enCurso.delete(companyId);
    }
  }

  // ─────────────────────── privados ───────────────────────

  private async cargarFuente(
    fuente: FuenteDeLeads,
    token: string | undefined,
    parametro: string | null,
    prefijo: string,
    userId: string,
  ): Promise<ResultadoFuente> {
    const inicio = new Date();
    try {
      const url = await this.validarUrl(fuente.url, fuente.nombre);
      if (parametro && fuente.ultimaCarga) {
        url.searchParams.set(parametro, fuente.ultimaCarga);
      }
      const json = await this.traer(url, token);
      const registros = extraerRegistros(json);
      if (registros === null) {
        throw new FuenteError(
          'La respuesta no trae una lista de leads reconocible.',
        );
      }
      if (registros.length === 0) {
        fuente.ultimaCarga = inicio.toISOString();
        return { nombre: fuente.nombre, ok: true, recibidos: 0 };
      }
      const tabla = aTabla(registros);
      const mapping = mapeoAutomatico(tabla.headers);
      const campos = Object.values(mapping);
      if (!campos.includes('phone') && !campos.includes('email')) {
        throw new FuenteError(
          'No se reconoció teléfono ni correo en los campos que trae la API ' +
            `(${tabla.headers.slice(0, 12).join(', ')}).`,
        );
      }
      const resultado = await this.imports.importTable(
        tabla,
        {
          mapping,
          phonePrefix: prefijo,
          // "Solo lo nuevo": lo que ya existe no se toca.
          duplicates: 'skip',
          // Son leads para trabajar: el agente los contacta, escalonado.
          scheduleFirstContact: true,
          source: fuente.nombre,
        },
        userId,
        { action: 'import_leads_api', detalle: { fuente: fuente.nombre } },
      );
      fuente.ultimaCarga = inicio.toISOString();
      return {
        nombre: fuente.nombre,
        ok: true,
        recibidos: registros.length,
        resultado,
      };
    } catch (error) {
      const mensaje =
        error instanceof FuenteError || error instanceof BadRequestException
          ? error.message
          : `No se pudo cargar: ${(error as Error).message}`;
      this.logger.warn(`Fuente de leads "${fuente.nombre}" falló: ${mensaje}`);
      return { nombre: fuente.nombre, ok: false, recibidos: 0, error: mensaje };
    }
  }

  /** Solo https a hosts públicos: la URL la escribe el cliente (SSRF). */
  private async validarUrl(raw: string, nombre: string): Promise<URL> {
    try {
      return await assertSafeOutboundUrl(raw, {
        allowHttp: false,
        lookup: this.lookup,
      });
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        throw new BadRequestException(
          `La URL de "${nombre}" no se puede usar: ${error.message}.`,
        );
      }
      throw error;
    }
  }

  private async traer(url: URL, token: string | undefined): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetcher(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: 'application/json',
        },
        // Una redirección podría llevar a la red interna: no se sigue.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const e = error as Error;
      throw new FuenteError(
        e.name === 'TimeoutError' || e.name === 'AbortError'
          ? `La API no respondió en ${TIMEOUT_MS / 1000} s.`
          : `No se pudo conectar con la API (${e.message}).`,
      );
    }
    if (res.status >= 300 && res.status < 400) {
      throw new FuenteError(
        `La API redirige a otra dirección (${res.status}); configura la URL final.`,
      );
    }
    if (!res.ok) {
      throw new FuenteError(
        res.status === 401 || res.status === 403
          ? `La API rechazó el token (${res.status}). Revisa el token en Integraciones.`
          : `La API respondió ${res.status}.`,
      );
    }
    const largo = Number(res.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES) {
      throw new FuenteError('La respuesta es demasiado grande (más de 5 MB).');
    }
    const texto = await res.text();
    if (texto.length > MAX_BYTES) {
      throw new FuenteError('La respuesta es demasiado grande (más de 5 MB).');
    }
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      throw new FuenteError('La respuesta de la API no es JSON válido.');
    }
  }

  private async zonaHoraria(companyId: string): Promise<string | null> {
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return company?.timezone ?? null;
  }
}

/** Las fuentes guardadas, descartando lo que no calce. */
function leerFuentes(
  config: Record<string, unknown> | undefined,
): FuenteDeLeads[] {
  const raw = config?.fuentes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is FuenteDeLeads =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as FuenteDeLeads).nombre === 'string' &&
        typeof (f as FuenteDeLeads).url === 'string',
    )
    .map((f) => ({
      nombre: f.nombre,
      url: f.url,
      ...(typeof f.ultimaCarga === 'string'
        ? { ultimaCarga: f.ultimaCarga }
        : {}),
    }));
}
