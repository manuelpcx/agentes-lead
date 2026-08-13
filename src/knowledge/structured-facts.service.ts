import { Injectable, NotFoundException } from '@nestjs/common';
import { FactCategory, Prisma, StructuredFact } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { UpsertFactDto } from './dto/upsert-fact.dto';

@Injectable()
export class StructuredFactsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un hecho. Si ya existe uno activo con la misma `key`, lo "cierra"
   * (fija su `validUntil` y lo desactiva) y crea el nuevo vigente. Así se
   * conserva historial y siempre hay a lo sumo un hecho vigente por clave.
   */
  async upsert(dto: UpsertFactDto): Promise<StructuredFact> {
    const companyId = TenantContext.requireCompanyId();
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;

    return this.prisma.db.$transaction(async (tx) => {
      await tx.structuredFact.updateMany({
        where: { key: dto.key, isActive: true },
        data: { isActive: false, validUntil: validFrom },
      });

      return tx.structuredFact.create({
        data: {
          companyId,
          key: dto.key,
          category: dto.category,
          value: dto.value as Prisma.InputJsonValue,
          validFrom,
          validUntil,
          isActive: true,
        },
      });
    });
  }

  /**
   * Devuelve el hecho vigente para una clave en un instante dado (por defecto
   * ahora): activo y dentro de su ventana de vigencia. `null` si no hay.
   * Base de la herramienta `consultarDato` (Fase 3).
   */
  async getCurrent(
    key: string,
    at: Date = new Date(),
  ): Promise<StructuredFact | null> {
    return this.prisma.db.structuredFact.findFirst({
      where: {
        key,
        isActive: true,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gte: at } }],
      },
      orderBy: { validFrom: 'desc' },
    });
  }

  /** Lista hechos, opcionalmente filtrando por categoría. */
  async list(category?: FactCategory): Promise<StructuredFact[]> {
    return this.prisma.db.structuredFact.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ key: 'asc' }, { validFrom: 'desc' }],
    });
  }

  /** Desactiva un hecho por id. */
  async deactivate(id: string): Promise<StructuredFact> {
    const fact = await this.prisma.db.structuredFact.findFirst({
      where: { id },
    });
    if (!fact) {
      throw new NotFoundException('Hecho estructurado no encontrado');
    }
    return this.prisma.db.structuredFact.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
