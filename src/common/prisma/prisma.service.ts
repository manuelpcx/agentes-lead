import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant.extension';

/** Aplica la extensión multi-tenant sobre el cliente base. */
function createExtendedClient(root: PrismaClient) {
  return root.$extends(tenantExtension);
}

/** Tipo del cliente Prisma ya extendido con aislamiento por tenant. */
export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

/**
 * Servicio de acceso a datos. Expone:
 *  - `db`: cliente con la extensión multi-tenant (usar SIEMPRE para negocio).
 *  - `raw`: cliente crudo sin extensión (solo para health/ping y operaciones
 *    de infraestructura que no pertenecen a ningún tenant).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly root: PrismaClient;
  readonly db: ExtendedPrismaClient;

  constructor() {
    this.root = new PrismaClient({
      log: [
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
    });
    this.db = createExtendedClient(this.root);
  }

  async onModuleInit(): Promise<void> {
    await this.root.$connect();
    this.logger.log('Conexión a PostgreSQL establecida');
  }

  async onModuleDestroy(): Promise<void> {
    await this.root.$disconnect();
  }

  /** Cliente crudo (sin filtro de tenant). Uso restringido a infraestructura. */
  get raw(): PrismaClient {
    return this.root;
  }
}
