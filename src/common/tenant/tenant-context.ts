import { AsyncLocalStorage } from 'node:async_hooks';

/** Datos que viajan con cada request/job durante todo su ciclo de vida. */
export interface TenantStore {
  /** Empresa dueña de la operación. Fuerza el aislamiento en Prisma. */
  companyId: string;
  /** Id de agente a cargo, cuando aplica. */
  agentId?: string;
  /** Id de correlación para trazar la operación de punta a punta en los logs. */
  correlationId: string;
}

/**
 * Contexto por-operación basado en AsyncLocalStorage. El guard (en HTTP) y el
 * processor (en la cola) abren este contexto; la extensión multi-tenant de
 * Prisma lo lee para inyectar/forzar `companyId` en cada query. Así ninguna
 * consulta puede "olvidarse" del tenant.
 */
export class TenantContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  /** Ejecuta `fn` con el store activo. Todo lo que ocurra dentro lo ve. */
  static run<T>(store: TenantStore, fn: () => T): T {
    return TenantContext.storage.run(store, fn);
  }

  /** Devuelve el store activo o `undefined` si no hay contexto (ej. bootstrap). */
  static get(): TenantStore | undefined {
    return TenantContext.storage.getStore();
  }

  /** Devuelve el `companyId` activo o `undefined`. */
  static getCompanyId(): string | undefined {
    const companyId = TenantContext.storage.getStore()?.companyId;
    return companyId ? companyId : undefined;
  }

  /**
   * Devuelve el `companyId` activo o lanza si no hay contexto de tenant. Se usa
   * en las escrituras (create), donde el `companyId` debe ir explícito por
   * exigencia de tipos (defensa en profundidad junto a la extensión de Prisma).
   */
  static requireCompanyId(): string {
    const companyId = TenantContext.getCompanyId();
    if (!companyId) {
      throw new Error('Operación sin contexto de tenant (companyId ausente)');
    }
    return companyId;
  }
}
