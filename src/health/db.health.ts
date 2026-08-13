import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../common/prisma/prisma.service';

/** Verifica conectividad con PostgreSQL con un `SELECT 1`. */
@Injectable()
export class DbHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.raw.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'PostgreSQL no disponible',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
