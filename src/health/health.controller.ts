import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DbHealthIndicator } from './db.health';
import { RedisHealthIndicator } from './redis.health';

/** `GET /health`: liveness/readiness verificando Postgres y Redis. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DbHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.check('postgres'),
      () => this.redis.check('redis'),
    ]);
  }
}
