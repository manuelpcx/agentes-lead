import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { parseInZone, safeTimezone } from '../followup/business-hours';

/**
 * Una llamada sin aviso de fin después de esto ya no cuenta como "en curso":
 * si el webhook nunca llegó, no puede bloquear las llamadas para siempre.
 */
const LLAMADA_EN_CURSO_MS = 15 * 60 * 1000;

export interface VoiceUsageCheck {
  allowed: boolean;
  /** Por qué no se puede llamar (texto para el agente y el panel). */
  reason?: string;
  minutesUsed: number;
  minutesLimit: number;
}

/**
 * Consumo de la voz gestionada por empresa: minutos del mes (cada llamada se
 * redondea al minuto hacia arriba, como cobra la telefonía), tope mensual y
 * llamadas en curso. Solo cuentan las llamadas por la cuenta de la plataforma
 * (`managed`): las de la cuenta propia de una empresa las paga ella.
 */
@Injectable()
export class VoiceUsageService {
  private readonly logger = new Logger(VoiceUsageService.name);
  readonly defaultLimit: number;
  readonly maxConcurrent: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.defaultLimit = config.get('VOICE_MONTHLY_MINUTES_DEFAULT', {
      infer: true,
    });
    this.maxConcurrent = config.get('VOICE_MAX_CONCURRENT_PER_COMPANY', {
      infer: true,
    });
  }

  /** ¿Puede la empresa hacer una llamada gestionada ahora? */
  async check(companyId: string, now = new Date()): Promise<VoiceUsageCheck> {
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { timezone: true, voiceMinutesLimit: true },
    });
    const minutesLimit = company?.voiceMinutesLimit ?? this.defaultLimit;
    const minutesUsed = await this.minutesUsed(
      companyId,
      company?.timezone ?? 'America/Santiago',
      now,
    );
    const base = { minutesUsed, minutesLimit };

    if (minutesLimit <= 0) {
      return {
        ...base,
        allowed: false,
        reason: 'Las llamadas no están incluidas en esta cuenta.',
      };
    }
    if (minutesUsed >= minutesLimit) {
      return {
        ...base,
        allowed: false,
        reason:
          `Se acabaron los minutos de llamadas de este mes (${minutesUsed} ` +
          `de ${minutesLimit}).`,
      };
    }
    const enCurso = await this.prisma.raw.voiceCall.count({
      where: {
        companyId,
        managed: true,
        endedAt: null,
        startedAt: { gte: new Date(now.getTime() - LLAMADA_EN_CURSO_MS) },
      },
    });
    if (enCurso >= this.maxConcurrent) {
      return {
        ...base,
        allowed: false,
        reason:
          `Ya hay ${enCurso} llamadas en curso (máximo ${this.maxConcurrent} ` +
          'a la vez).',
      };
    }
    return { ...base, allowed: true };
  }

  /** Minutos gestionados del mes calendario en curso (en la zona de la empresa). */
  async minutesUsed(
    companyId: string,
    timezone: string,
    now = new Date(),
  ): Promise<number> {
    const llamadas = await this.prisma.raw.voiceCall.findMany({
      where: {
        companyId,
        managed: true,
        startedAt: { gte: startOfMonth(now, timezone) },
      },
      select: { durationSecs: true },
    });
    return llamadas.reduce(
      (total, l) => total + Math.ceil((l.durationSecs ?? 0) / 60),
      0,
    );
  }

  /** Registra una llamada recién iniciada. Si falla, la llamada ya salió: solo avisa. */
  async recordStart(call: {
    companyId: string;
    leadId: string;
    provider: string;
    managed: boolean;
    callId: string;
  }): Promise<void> {
    try {
      await this.prisma.raw.voiceCall.create({ data: call });
    } catch (e) {
      this.logger.warn(
        `No se pudo registrar la llamada ${call.callId}: ${(e as Error).message}`,
      );
    }
  }

  /** La llamada que iniciamos con ese id en el proveedor, si existe. */
  findCall(provider: string, callId: string) {
    return this.prisma.raw.voiceCall.findUnique({
      where: { provider_callId: { provider, callId } },
    });
  }

  /** Marca el fin de una llamada (con su duración, si el proveedor la informa). */
  async recordEnd(
    provider: string,
    callId: string,
    end: { status: 'completed' | 'failed'; durationSecs?: number },
  ): Promise<void> {
    await this.prisma.raw.voiceCall.updateMany({
      where: { provider, callId },
      data: {
        status: end.status,
        endedAt: new Date(),
        ...(end.durationSecs !== undefined
          ? { durationSecs: Math.max(0, Math.round(end.durationSecs)) }
          : {}),
      },
    });
  }
}

/** Día 1 a las 00:00 del mes en curso, en la zona horaria dada. */
export function startOfMonth(now: Date, timezone: string): Date {
  const yearMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .slice(0, 7);
  return parseInZone(`${yearMonth}-01T00:00:00`, timezone) as Date;
}
