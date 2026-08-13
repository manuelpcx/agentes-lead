import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Channel, Direction } from '@prisma/client';
import { TenantContext } from '../common/tenant/tenant-context';
import { InteractionsService } from '../interactions/interactions.service';

/**
 * Webhook de Vapi. Al finalizar una llamada, recibe el reporte con la
 * transcripción y la guarda como Interaction de canal `call`. La empresa y el
 * lead se correlacionan por la metadata que enviamos al iniciar la llamada.
 *
 * NOTA: la verificación de firma del webhook de Vapi se añade con credenciales
 * reales (pendiente para producción).
 */
@Controller('vapi')
export class VapiController {
  constructor(private readonly interactions: InteractionsService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: unknown): Promise<{ received: true }> {
    const message = this.pick(body, 'message');
    const type = this.pickString(message, 'type');
    if (type !== 'end-of-call-report') {
      return { received: true }; // ignoramos otros eventos por ahora
    }

    const call = this.pick(message, 'call');
    const metadata = this.pick(call, 'metadata');
    const companyId = this.pickString(metadata, 'companyId');
    const leadId = this.pickString(metadata, 'leadId');
    const callId = this.pickString(call, 'id') ?? 'desconocido';
    const transcript =
      this.pickString(message, 'transcript') ??
      this.pickString(this.pick(message, 'artifact'), 'transcript') ??
      '(sin transcripción)';

    if (!companyId || !leadId) {
      return { received: true }; // sin correlación: ignorar
    }

    await TenantContext.run({ companyId, correlationId: randomUUID() }, () =>
      this.interactions.register({
        leadId,
        channel: Channel.call,
        direction: Direction.inbound,
        content: transcript,
        agentId: null,
        metadata: { callId },
      }),
    );
    return { received: true };
  }

  private pick(obj: unknown, key: string): unknown {
    return obj && typeof obj === 'object'
      ? (obj as Record<string, unknown>)[key]
      : undefined;
  }

  private pickString(obj: unknown, key: string): string | undefined {
    const value = this.pick(obj, key);
    return typeof value === 'string' ? value : undefined;
  }
}
