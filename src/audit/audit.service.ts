import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

/** Entrada del log de auditoría. */
export interface AuditInput {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
}

/** Registra cambios sensibles hechos desde el panel (con usuario y valores). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: AuditInput): Promise<void> {
    await this.prisma.db.auditLog.create({
      data: {
        companyId: TenantContext.requireCompanyId(),
        userId: data.userId ?? null,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId ?? null,
        previousValue: data.previousValue,
        newValue: data.newValue,
      },
    });
  }
}
