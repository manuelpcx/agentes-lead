import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Channel, Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import {
  verifyElevenLabsSignature,
  verifyRetellSignature,
  verifySharedSecret,
} from '../common/webhook-signature';
import { VoiceInboundService } from './voice-inbound.service';
import { VoiceService } from './voice.service';
import { VoiceUsageService } from './voice-usage.service';
import {
  describeCallFailure,
  formatElevenLabsTranscript,
} from './providers/elevenlabs.provider';

/**
 * Webhooks de proveedores de voz. Al finalizar/analizarse una llamada, se
 * recibe la transcripción; se guarda como Interaction `call` y (si hubo
 * conversación) se despierta al agente. La empresa y el lead se correlacionan
 * por la metadata que enviamos al iniciar la llamada.
 *
 * El webhook de Retell verifica su firma (`x-retell-signature`) contra la API
 * key de Retell de la empresa (ya la tiene guardada para llamar; cero pasos
 * extra). El de Vapi verifica el "Server URL Secret" (`x-vapi-secret`) que la
 * empresa configura en Integraciones → Voz como secreto de webhook. El de
 * ElevenLabs verifica su firma HMAC (`elevenlabs-signature`) con el secreto
 * del webhook post-llamada, también guardado en Integraciones → Voz.
 */
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly inbound: VoiceInboundService,
    private readonly credentials: CredentialsService,
    private readonly prisma: PrismaService,
    private readonly voice: VoiceService,
    private readonly usage: VoiceUsageService,
  ) {}

  /**
   * Webhook de Retell. Procesa `call_analyzed` (trae transcripción + análisis);
   * ignora `call_started`/`call_ended` para no duplicar.
   * Doc: https://docs.retellai.com/features/webhook
   */
  @Post('retell/webhook')
  @HttpCode(HttpStatus.OK)
  async retellWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
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

    // Verifica la firma con la API key de Retell de ESA empresa (BYO). Si
    // alguien forjó el companyId, la firma no calzará con la clave real.
    const cred = await this.credentials.getByCompanyId(companyId, 'voice');
    if (cred?.provider !== 'retell' || !cred.secret) {
      throw new UnauthorizedException(
        'Voz (Retell) no configurada para esta empresa',
      );
    }
    if (
      !verifyRetellSignature(
        req.rawBody ?? Buffer.from(''),
        this.header(req, 'x-retell-signature'),
        cred.secret,
      )
    ) {
      throw new UnauthorizedException('Firma de Retell inválida');
    }

    const callId = this.pickString(call, 'call_id') ?? 'desconocido';
    const transcript = this.pickString(call, 'transcript');
    const analysis = this.pick(call, 'call_analysis');
    const summary = this.pickString(analysis, 'call_summary');

    await TenantContext.run({ companyId, correlationId: randomUUID() }, () =>
      this.inbound.handleCompletedCall({ leadId, callId, transcript, summary }),
    );
    await this.usage.recordEnd('retell', callId, { status: 'completed' });
    return { received: true };
  }

  /**
   * Webhook de Vapi (proveedor alternativo). Procesa `end-of-call-report`.
   *
   * Vapi no firma el cuerpo: manda el "Server URL Secret" configurado en el
   * assistant tal cual, en el header `x-vapi-secret`. Se compara en tiempo
   * constante con el secreto de webhook de la empresa que dice el
   * `metadata.companyId` — si alguien forjó ese id, no conoce el secreto de
   * esa empresa. Sin secreto configurado se rechaza: antes se aceptaba
   * cualquier cuerpo y cualquiera podía escribir "resultados de llamada" en
   * cualquier empresa.
   */
  @Post('vapi/webhook')
  @HttpCode(HttpStatus.OK)
  async vapiWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
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

    const cred = await this.credentials.getByCompanyId(companyId, 'voice');
    if (cred?.provider !== 'vapi' || !cred.webhookSecret) {
      throw new UnauthorizedException(
        'Voz (Vapi) sin secreto de webhook configurado para esta empresa',
      );
    }
    if (
      !verifySharedSecret(this.header(req, 'x-vapi-secret'), cred.webhookSecret)
    ) {
      throw new UnauthorizedException('Secreto de Vapi inválido');
    }

    const callId = this.pickString(call, 'id') ?? 'desconocido';
    const transcript =
      this.pickString(message, 'transcript') ??
      this.pickString(this.pick(message, 'artifact'), 'transcript');
    const summary = this.pickString(message, 'summary');

    await TenantContext.run({ companyId, correlationId: randomUUID() }, () =>
      this.inbound.handleCompletedCall({ leadId, callId, transcript, summary }),
    );
    await this.usage.recordEnd('vapi', callId, { status: 'completed' });
    return { received: true };
  }

  /**
   * Webhook post-llamada de ElevenLabs Agents. Procesa
   * `post_call_transcription` (transcripción + resumen) y
   * `call_initiation_failure` (ocupado, no contestó); ignora el resto.
   *
   * ElevenLabs no devuelve metadata propia en la falla de llamada, así que la
   * empresa y el lead salen de la llamada que registramos al iniciarla
   * (`VoiceCall`, o la interacción de las llamadas anteriores a esa tabla),
   * no del cuerpo. La firma se verifica con el secreto del webhook de la
   * plataforma si la llamada fue gestionada, o con el de ESA empresa si salió
   * por su cuenta propia. Con la duración se cuentan los minutos del mes.
   * Doc: https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
   */
  @Post('elevenlabs/webhook')
  @HttpCode(HttpStatus.OK)
  async elevenlabsWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const type = this.pickString(body, 'type');
    if (
      type !== 'post_call_transcription' &&
      type !== 'call_initiation_failure'
    ) {
      return { received: true };
    }
    const data = this.pick(body, 'data');
    const conversationId = this.pickString(data, 'conversation_id');
    if (!conversationId) {
      return { received: true };
    }

    const llamada = await this.findElevenLabsCall(conversationId);
    if (!llamada) {
      return { received: true }; // no es una llamada que hayamos iniciado
    }

    const secret = llamada.managed
      ? this.voice.managedWebhookSecret
      : await this.credentials
          .getByCompanyId(llamada.companyId, 'voice')
          .then((c) =>
            c?.provider === 'elevenlabs' ? c.webhookSecret : undefined,
          );
    if (!secret) {
      throw new UnauthorizedException(
        'Voz (ElevenLabs) sin secreto de webhook configurado',
      );
    }
    if (
      !verifyElevenLabsSignature(
        req.rawBody ?? Buffer.from(''),
        this.header(req, 'elevenlabs-signature'),
        secret,
      )
    ) {
      throw new UnauthorizedException('Firma de ElevenLabs inválida');
    }

    const fallo = type === 'call_initiation_failure';
    const duracion = Number(
      this.pick(this.pick(data, 'metadata'), 'call_duration_secs'),
    );
    await this.usage.recordEnd('elevenlabs', conversationId, {
      status: fallo ? 'failed' : 'completed',
      durationSecs: fallo
        ? 0
        : Number.isFinite(duracion)
          ? duracion
          : undefined,
    });

    const completed = fallo
      ? {
          leadId: llamada.leadId,
          callId: conversationId,
          summary: describeCallFailure(this.pickString(data, 'failure_reason')),
        }
      : {
          leadId: llamada.leadId,
          callId: conversationId,
          transcript: formatElevenLabsTranscript(this.pick(data, 'transcript')),
          summary: this.pickString(
            this.pick(data, 'analysis'),
            'transcript_summary',
          ),
        };
    await TenantContext.run(
      { companyId: llamada.companyId, correlationId: randomUUID() },
      () => this.inbound.handleCompletedCall(completed),
    );
    return { received: true };
  }

  /**
   * La llamada de ElevenLabs que iniciamos: primero en `VoiceCall`; si no,
   * en las interacciones (llamadas de antes de que existiera esa tabla, que
   * siempre salieron por la cuenta propia de la empresa).
   */
  private async findElevenLabsCall(
    conversationId: string,
  ): Promise<{ companyId: string; leadId: string; managed: boolean } | null> {
    const call = await this.usage.findCall('elevenlabs', conversationId);
    if (call) {
      return {
        companyId: call.companyId,
        leadId: call.leadId,
        managed: call.managed,
      };
    }
    const legado = await this.prisma.raw.interaction.findFirst({
      where: {
        channel: Channel.call,
        direction: Direction.outbound,
        metadata: { path: ['callId'], equals: conversationId },
      },
      select: { companyId: true, leadId: true },
    });
    return legado ? { ...legado, managed: false } : null;
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

  private header(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
