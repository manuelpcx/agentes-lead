import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { LeadStatus } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { QUEUE_LEAD_FOLLOWUP } from '../queue/queue.constants';
import { FollowUpJobData } from './followup.job';

const TERMINAL_STATUSES: LeadStatus[] = [
  LeadStatus.CERRADO_GANADO,
  LeadStatus.CERRADO_PERDIDO,
  LeadStatus.ESCALADO_HUMANO,
];

/**
 * Cron cada 2 min: busca leads con `nextActionAt` vencido (en todas las
 * empresas, sin contexto de tenant) y encola un seguimiento por cada uno. El
 * `jobId` determinista (lead + próxima acción) evita duplicados mientras esa
 * acción siga pendiente. Frecuencia alta = baja latencia del primer contacto
 * (responder rápido).
 */
@Injectable()
export class FollowUpScheduler {
  private readonly logger = new Logger(FollowUpScheduler.name);
  private readonly enabled: boolean;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_LEAD_FOLLOWUP)
    private readonly queue: Queue<FollowUpJobData>,
  ) {
    this.enabled = config.get('FOLLOWUP_ENABLED', { infer: true });
  }

  @Cron('0 */2 * * * *')
  async sweep(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const due = await this.prisma.raw.lead.findMany({
      where: {
        nextActionAt: { lte: new Date() },
        isPausedForHuman: false,
        status: { notIn: TERMINAL_STATUSES },
      },
      select: { id: true, companyId: true, nextActionAt: true },
      take: 500,
    });

    for (const lead of due) {
      await this.queue.add(
        'followup',
        {
          companyId: lead.companyId,
          leadId: lead.id,
          correlationId: randomUUID(),
        },
        // El `jobId` NO puede llevar `:` (BullMQ lo prohíbe). Lleva la hora de
        // la próxima acción: un job fallido se conserva en Redis con su id, y
        // si el id fuera solo el del lead, BullMQ ignoraría en silencio todos
        // los `add` siguientes y el lead quedaría trabado para siempre. Al
        // reprogramarse (ver `deferAfterFailure`) el id cambia y vuelve a
        // encolarse. `removeOnComplete` libera el id al terminar.
        {
          jobId: `followup-${lead.id}-${lead.nextActionAt?.getTime() ?? 0}`,
          removeOnComplete: true,
        },
      );
    }

    if (due.length > 0) {
      this.logger.log(`Encolados ${due.length} seguimientos`);
    }
  }
}
