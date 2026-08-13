import { Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Modelos con alcance de tenant: toda operación sobre ellos se filtra/inyecta
 * por `companyId`. `Company` queda FUERA a propósito: es la raíz del tenancy y
 * se resuelve por id o por credencial, sin filtro de empresa.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Agent',
  'Lead',
  'Interaction',
  'Conversation',
  'KnowledgeDocument',
  'KnowledgeChunk',
  'StructuredFact',
  'PromptVersion',
  'AgentAction',
  'AuditLog',
  'Appointment',
  'KnowledgeGap',
  'ExampleLibrary',
  'AgentMetric',
]);

/** Operaciones de escritura donde el `companyId` va en `data`. */
const DATA_INJECT_OPS = new Set<string>([
  'create',
  'createMany',
  'createManyAndReturn',
]);

/** Operaciones donde el `companyId` va como filtro en `where`. */
const WHERE_INJECT_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

export type OperationArgs = {
  data?: unknown;
  where?: Record<string, unknown>;
  create?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Inyecta `companyId` en un objeto de datos (respeta el que ya venga puesto). */
function injectCompanyIdIntoData(
  data: Record<string, unknown>,
  companyId: string,
): void {
  if (data.companyId === undefined) {
    data.companyId = companyId;
  }
}

/**
 * Lógica pura de aislamiento por tenant, extraída para poder testearla sin un
 * cliente Prisma real. Muta y devuelve los `args` aplicando el `companyId`
 * según el tipo de operación. Si el modelo no es tenant-scoped o no hay
 * `companyId`, devuelve los `args` sin tocar.
 */
export function applyTenantScope(
  model: string,
  operation: string,
  args: OperationArgs,
  companyId: string | undefined,
): OperationArgs {
  if (!companyId || !TENANT_SCOPED_MODELS.has(model)) {
    return args;
  }

  if (DATA_INJECT_OPS.has(operation)) {
    const data = args.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        injectCompanyIdIntoData(item as Record<string, unknown>, companyId);
      }
    } else if (data && typeof data === 'object') {
      injectCompanyIdIntoData(data as Record<string, unknown>, companyId);
    }
  } else if (operation === 'upsert') {
    if (args.create && typeof args.create === 'object') {
      injectCompanyIdIntoData(args.create, companyId);
    }
    args.where = { ...(args.where ?? {}), companyId };
  }

  if (WHERE_INJECT_OPS.has(operation)) {
    args.where = { ...(args.where ?? {}), companyId };
  }

  return args;
}

/**
 * Extensión de Prisma que fuerza el aislamiento multi-tenant. Lee el
 * `companyId` del `TenantContext` (AsyncLocalStorage) en tiempo de ejecución;
 * si no hay contexto activo (p. ej. bootstrap/seed/tests), deja pasar la query
 * sin tocar — el aislamiento del camino HTTP/worker lo garantiza el guard y el
 * processor, que siempre abren contexto.
 *
 * Nota: se apoya en `extendedWhereUnique` (GA en Prisma 5) para poder añadir
 * `companyId` al `where` incluso en operaciones por clave única.
 */
export const tenantExtension = Prisma.defineExtension({
  name: 'multi-tenant',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const companyId = TenantContext.getCompanyId();
        const scopedArgs = applyTenantScope(
          model,
          operation,
          (args ?? {}) as OperationArgs,
          companyId,
        );
        return query(scopedArgs as unknown as typeof args);
      },
    },
  },
});
