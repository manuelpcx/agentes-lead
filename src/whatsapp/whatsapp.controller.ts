import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { SimulateInboundDto } from './dto/simulate-inbound.dto';

/** Mensaje entrante normalizado desde el payload de Meta. */
interface ParsedInbound {
  phoneNumberId: string;
  from: string;
  text: string;
}

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly inbound: WhatsappInboundService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Simulación de entrada (dev): autentica por empresa (HMAC) y despierta al
   * agente sin necesidad de la Cloud API de Meta.
   */
  @Post('simulate')
  @UseGuards(CompanyAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  simulate(@Body() dto: SimulateInboundDto): Promise<{ leadId: string }> {
    return this.inbound.handleIncoming(dto.phone, dto.text);
  }

  /** Verificación del webhook de Meta (suscripción). Devuelve el challenge. */
  @Get('webhook')
  verify(@Query() query: Record<string, string>): string {
    const verifyToken = this.config.get('WHATSAPP_VERIFY_TOKEN', {
      infer: true,
    });
    if (
      query['hub.mode'] === 'subscribe' &&
      verifyToken &&
      query['hub.verify_token'] === verifyToken
    ) {
      return query['hub.challenge'];
    }
    throw new ForbiddenException('Verificación de webhook fallida');
  }

  /**
   * Webhook de mensajes entrantes de Meta. Responde 200 de inmediato; por cada
   * mensaje resuelve la empresa por `phone_number_id` y despierta al agente
   * dentro de su `TenantContext`.
   *
   * NOTA: la verificación de firma (X-Hub-Signature-256 con el App Secret) se
   * añade al conectar credenciales reales de Meta (pendiente para producción).
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async metaWebhook(@Body() body: unknown): Promise<{ received: true }> {
    for (const msg of this.parseMetaPayload(body)) {
      const company = await this.prisma.raw.company.findFirst({
        where: {
          isActive: true,
          channelsConfig: {
            path: ['whatsapp', 'phoneNumberId'],
            equals: msg.phoneNumberId,
          },
        },
        select: { id: true },
      });
      if (!company) {
        continue; // sin empresa mapeada a ese número: ignorar
      }
      await TenantContext.run(
        { companyId: company.id, correlationId: randomUUID() },
        () => this.inbound.handleIncoming(`+${msg.from}`, msg.text),
      );
    }
    return { received: true };
  }

  /**
   * Webhook de mensajes entrantes de YCloud (BSP). Responde 200 de inmediato;
   * resuelve la empresa por el número de negocio (`to`) mapeado en
   * `channelsConfig.whatsapp.phoneNumber` y despierta al agente.
   * Doc: https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples
   *
   * NOTA: la verificación de firma del webhook de YCloud queda pendiente para
   * producción (igual que en el webhook de Meta).
   */
  @Post('ycloud/webhook')
  @HttpCode(HttpStatus.OK)
  async ycloudWebhook(@Body() body: unknown): Promise<{ received: true }> {
    if (this.pickString(body, 'type') !== 'whatsapp.inbound_message.received') {
      return { received: true }; // otros eventos (status, etc.): ignorar
    }
    const msg = this.pick(body, 'whatsappInboundMessage');
    if (this.pickString(msg, 'type') !== 'text') {
      return { received: true }; // por ahora solo texto
    }
    const rawFrom = this.pickString(msg, 'from');
    const to = this.pickString(msg, 'to');
    const text = this.pickString(this.pick(msg, 'text'), 'body');
    if (!rawFrom || !to || !text) {
      return { received: true };
    }
    const from = rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`;

    const company = await this.prisma.raw.company.findFirst({
      where: {
        isActive: true,
        channelsConfig: { path: ['whatsapp', 'phoneNumber'], equals: to },
      },
      select: { id: true },
    });
    if (company) {
      await TenantContext.run(
        { companyId: company.id, correlationId: randomUUID() },
        () => this.inbound.handleIncoming(from, text),
      );
    }
    return { received: true };
  }

  /** Extrae mensajes de texto del payload de Meta de forma segura. */
  private parseMetaPayload(body: unknown): ParsedInbound[] {
    const out: ParsedInbound[] = [];
    const entries = this.asArray(this.pick(body, 'entry'));
    for (const entry of entries) {
      for (const change of this.asArray(this.pick(entry, 'changes'))) {
        const value = this.pick(change, 'value');
        const phoneNumberId = this.pickString(
          this.pick(value, 'metadata'),
          'phone_number_id',
        );
        if (!phoneNumberId) {
          continue;
        }
        for (const message of this.asArray(this.pick(value, 'messages'))) {
          const from = this.pickString(message, 'from');
          const text = this.pickString(this.pick(message, 'text'), 'body');
          if (from && text) {
            out.push({ phoneNumberId, from, text });
          }
        }
      }
    }
    return out;
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

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
