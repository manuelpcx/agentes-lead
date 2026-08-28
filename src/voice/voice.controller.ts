import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantContext } from '../common/tenant/tenant-context';
import { VoiceInboundService } from './voice-inbound.service';

/**
 * Webhooks de proveedores de voz. Al finalizar/analizarse una llamada, se
 * recibe la transcripción; se guarda como Interaction `call` y (si hubo
 * conversación) se despierta al agente. La empresa y el lead se correlacionan
 * por la metadata que enviamos al iniciar la llamada.
 *
 * NOTA: la verificación de firma de los webhooks (Retell `x-retell-signature`,
 * Vapi) queda pendiente para producción, igual que en WhatsApp/YCloud. La
 * correlación exige companyId+leadId propios en la metadata, así que un POST
 * sin esos datos se ignora.
 */
@Controller('voice')
export class VoiceController {
  constructor(private readonly inbound: VoiceInboundService) {}

  /**
   * Webhook de Retell. Procesa `call_analyzed` (trae transcripción + análisis);
   * ignora `call_started`/`call_ended` para no duplicar.
   * Doc: https://docs.retellai.com/features/webhook
   */
  @Post('retell/webhook')
  @HttpCode(HttpStatus.OK)
  async retellWebhook(@Body() body: unknown): Promise<{ received: true }> {
    const event = this.pickString(body, 'event');
    if (event !== 'call_analyzed') {
      return { received: true };
    }
    const call = this.pick(body, 'call');
    const metadata = this.pick(call, 'metadata');
    const companyId = this.pickString(metadata, 'companyId');
    const leadId = this.pickString(metadata, 'leadId');
    if (!companyId || !leadId) {
      return { received: true };
    }
    const callId = this.pickString(call, 'call_id') ?? 'desconocido';
    const transcript = this.pickString(call, 'transcript');
    const analysis = this.pick(call, 'call_analysis');
    const summary = this.pickString(analysis, 'call_summary');

    await TenantContext.run({ companyId, correlationId: randomUUID() }, () =>
      this.inbound.handleCompletedCall({ leadId, callId, transcript, summary }),
    );
    return { received: true };
  }

  /**
   * Webhook de Vapi (proveedor alternativo). Procesa `end-of-call-report`.
   */
  @Post('vapi/webhook')
  @HttpCode(HttpStatus.OK)
  async vapiWebhook(@Body() body: unknown): Promise<{ received: true }> {
    const message = this.pick(body, 'message');
    if (this.pickString(message, 'type') !== 'end-of-call-report') {
      return { received: true };
    }
    const call = this.pick(message, 'call');
    const metadata = this.pick(call, 'metadata');
    const companyId = this.pickString(metadata, 'companyId');
    const leadId = this.pickString(metadata, 'leadId');
    if (!companyId || !leadId) {
      return { received: true };
    }
    const callId = this.pickString(call, 'id') ?? 'desconocido';
    const transcript =
      this.pickString(message, 'transcript') ??
      this.pickString(this.pick(message, 'artifact'), 'transcript');
    const summary = this.pickString(message, 'summary');

    await TenantContext.run({ companyId, correlationId: randomUUID() }, () =>
      this.inbound.handleCompletedCall({ leadId, callId, transcript, summary }),
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
