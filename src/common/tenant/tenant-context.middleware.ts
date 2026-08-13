import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext, TenantStore } from './tenant-context';

/**
 * Abre el `TenantContext` al inicio de cada request y lo mantiene durante todo
 * el ciclo async (por eso va como middleware y no como interceptor: envolver
 * `next()` en `AsyncLocalStorage.run` propaga el contexto a guards, pipes,
 * handler y a todas las queries de Prisma).
 *
 * El `companyId` arranca vacío y lo completa `CompanyAuthGuard` tras autenticar
 * (mutando el mismo objeto de store, que es la referencia viva del contexto).
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    res.setHeader('x-correlation-id', correlationId);

    const store: TenantStore = { companyId: '', correlationId };
    TenantContext.run(store, () => next());
  }
}
