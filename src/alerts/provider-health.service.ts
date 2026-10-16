import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ProviderIncident } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../common/rate-limit/rate-limit.guard';
import { HealthTarget, incidentKey, providerLabel } from './alerts.types';
import { IncidentNotifier } from './incident-notifier.service';
import { classifyProviderError } from './provider-error';

/** Fallos pasajeros seguidos que abren un incidente… */
export const TRANSIENT_THRESHOLD = 3;
/** …dentro de esta ventana, contada desde el primero. */
export const TRANSIENT_WINDOW_SECONDS = 15 * 60;

/** Lo mínimo de ioredis que usa la racha (así se prueba sin Redis). */
export interface StreakStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
}

function streakKey(key: string): string {
  return `provider-health:streak:${key}`;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/**
 * Salud de los proveedores externos, medida con los envíos reales. Cada punto
 * de salida (WhatsApp, correo, voz, IA) pasa su envío por `observe`: si una
 * cuenta empieza a fallar, se abre un incidente (uno por cuenta) y se avisa;
 * con el primer envío exitoso se cierra solo. Ver
 * docs/superpowers/specs/2026-10-08-alertas-proveedores-design.md.
 */
@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly store: StreakStore,
    private readonly notifier: IncidentNotifier,
  ) {}

  /**
   * Ejecuta un envío y anota si funcionó, sin cambiar su resultado: devuelve
   * lo mismo o relanza el mismo error. El registro corre en segundo plano y
   * nunca demora ni rompe el envío.
   */
  async observe<T>(target: HealthTarget, send: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await send();
    } catch (error) {
      this.background(() => this.failure(target, error));
      throw error;
    }
    this.background(() => this.success(target));
    return result;
  }

  /** Un envío funcionó: corta la racha y cierra el incidente abierto, si hay. */
  async success(target: HealthTarget, now = new Date()): Promise<void> {
    const key = incidentKey(target);
    await this.store.del(streakKey(key)).catch(() => 0);
    const open = await this.prisma.raw.providerIncident.findUnique({
      where: { openKey: key },
    });
    if (!open) return;
    const { count } = await this.prisma.raw.providerIncident.updateMany({
      where: { id: open.id, resolvedAt: null },
      data: { resolvedAt: now, openKey: null },
    });
    if (count !== 1) return; // otro proceso lo cerró primero
    this.logger.log(`Incidente cerrado: ${key}`);
    await this.notifier.resolved({ ...open, resolvedAt: now }, now);
  }

  /** Un envío falló: suma al incidente abierto o decide si abrir uno. */
  async failure(
    target: HealthTarget,
    error: unknown,
    now = new Date(),
  ): Promise<void> {
    const verdict = classifyProviderError(
      error,
      providerLabel(target.provider),
    );
    if (verdict.kind === 'request') return;

    const key = incidentKey(target);
    if (await this.bump(key, target, now)) return;

    let failures = 1;
    if (verdict.kind === 'transient') {
      failures = await this.streak(key);
      if (failures < TRANSIENT_THRESHOLD) return;
    }

    let created: ProviderIncident;
    try {
      created = await this.prisma.raw.providerIncident.create({
        data: {
          companyId:
            target.scope === 'company' ? (target.companyId ?? null) : null,
          scope: target.scope,
          service: target.service,
          provider: target.provider,
          kind: verdict.kind,
          reason: verdict.reason,
          hint: verdict.hint ?? null,
          failureCount: failures,
          affectedCompanyIds: target.companyId ? [target.companyId] : [],
          openedAt: now,
          lastFailureAt: now,
          key,
          openKey: key,
        },
      });
    } catch (e) {
      // Otro proceso lo abrió en el mismo instante: ese avisa, acá solo se suma.
      if (isUniqueViolation(e)) {
        await this.bump(key, target, now);
        return;
      }
      throw e;
    }
    this.logger.warn(`Incidente abierto: ${key} — ${verdict.reason}`);
    await this.notifier.opened(created, now);
  }

  /** Suma un fallo al incidente abierto de esa clave. Devuelve si lo había. */
  private async bump(
    key: string,
    target: HealthTarget,
    now: Date,
  ): Promise<boolean> {
    const open = await this.prisma.raw.providerIncident.findUnique({
      where: { openKey: key },
      select: { id: true, affectedCompanyIds: true },
    });
    if (!open) return false;
    const nuevaEmpresa =
      target.companyId && !open.affectedCompanyIds.includes(target.companyId);
    await this.prisma.raw.providerIncident.update({
      where: { id: open.id },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: now,
        ...(nuevaEmpresa && {
          affectedCompanyIds: [
            ...open.affectedCompanyIds,
            target.companyId as string,
          ],
        }),
      },
    });
    return true;
  }

  /** Fallos pasajeros seguidos en la ventana. Sin Redis: 0 (no abre). */
  private async streak(key: string): Promise<number> {
    try {
      const n = await this.store.incr(streakKey(key));
      if (n === 1) {
        await this.store.expire(streakKey(key), TRANSIENT_WINDOW_SECONDS);
      }
      return n;
    } catch (e) {
      this.logger.warn(
        `Racha de fallos sin Redis (${(e as Error).message}): no se cuenta.`,
      );
      return 0;
    }
  }

  private background(task: () => Promise<void>): void {
    void task().catch((e: Error) =>
      this.logger.warn(
        `No se pudo registrar la salud del proveedor: ${e.message}`,
      ),
    );
  }
}
