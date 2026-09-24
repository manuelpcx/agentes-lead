import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { CredentialsService } from '../integrations/credentials.service';
import {
  verifyMetaSignature,
  verifyYCloudSignature,
} from '../common/webhook-signature';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { parseInboundMessage } from './inbound-message';
import { SimulateInboundDto } from './dto/simulate-inbound.dto';

/** Mensaje entrante normalizado desde el payload de Meta. */
interface ParsedInbound {
  phoneNumberId: string;
  from: string;
  text: string;
  /** false = se registra en el historial pero no dispara un turno (reacciones). */
  wakeAgent: boolean;
}

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly inbound: WhatsappInboundService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly credentials: CredentialsService,
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
   * mensaje resuelve la empresa por `phone_number_id`, verifica la firma
   * (`X-Hub-Signature-256`, HMAC con el **App Secret** de la app de Meta de
   * ESA empresa) y despierta al agente dentro de su `TenantContext`.
   *
   * Sin App Secret configurado el mensaje se rechaza: aceptar sin firma
   * significaba que cualquiera que conociera el `phone_number_id` podía
   * "hablar" como un cliente y hacer que el agente le respondiera por el
   * WhatsApp de la empresa al número que quisiera.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async metaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    // Una entrega puede traer varios mensajes de la misma empresa: la firma se
    // verifica una vez por empresa y se recuerda para el resto del lote.
    const verificadas = new Set<string>();
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
      if (!verificadas.has(company.id)) {
        await this.assertMetaSignature(req, company.id);
        verificadas.add(company.id);
      }
      await TenantContext.run(
        { companyId: company.id, correlationId: randomUUID() },
        () =>
          this.inbound.handleIncoming(`+${msg.from}`, msg.text, {
            wakeAgent: msg.wakeAgent,
          }),
      );
    }
    return { received: true };
  }

  /** Lanza 401 si la firma de Meta no calza con el App Secret de la empresa. */
  private async assertMetaSignature(
    req: RawBodyRequest<Request>,
    companyId: string,
  ): Promise<void> {
    const cred = await this.credentials.getByCompanyId(companyId, 'whatsapp');
    if (cred?.provider !== 'meta' || !cred.webhookSecret) {
      this.logger.warn(
        `WhatsApp (Meta) sin App Secret configurado para companyId=${companyId}: ` +
          'mensaje RECHAZADO. Configúralo en Integraciones → WhatsApp → ' +
          '"Secreto de firma del webhook".',
      );
      throw new UnauthorizedException(
        'WhatsApp (Meta) sin App Secret configurado para esta empresa',
      );
    }
    if (
      !verifyMetaSignature(
        req.rawBody ?? Buffer.from(''),
        this.header(req, 'x-hub-signature-256'),
        cred.webhookSecret,
      )
    ) {
      throw new UnauthorizedException('Firma de Meta inválida');
    }
  }

  /**
   * Webhook de mensajes entrantes de YCloud (BSP). Responde 200 de inmediato;
   * resuelve la empresa por el número de negocio (`to`) mapeado en
   * `channelsConfig.whatsapp.phoneNumber` y despierta al agente.
   * Doc: https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples
   *
   * Verifica la firma (`YCloud-Signature`) contra el secreto del endpoint de
   * webhook de esa empresa (Integraciones → WhatsApp → "Secreto de firma del
   * webhook"; se genera al crear el webhook endpoint en YCloud, es DISTINTO de
   * la API key). Es **obligatorio**: sin secreto configurado el mensaje se
   * rechaza con 401 y queda avisado en los logs. Antes se aceptaba sin
   * verificar "para no cortar a quien no había migrado", y eso dejaba el
   * WhatsApp de esas empresas abierto a mensajes forjados.
   */
  @Post('ycloud/webhook')
  @HttpCode(HttpStatus.OK)
  async ycloudWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    if (this.pickString(body, 'type') !== 'whatsapp.inbound_message.received') {
      return { received: true }; // otros eventos (status, etc.): ignorar
    }
    const msg = this.pick(body, 'whatsappInboundMessage');
    const rawFrom = this.pickString(msg, 'from');
    const to = this.pickString(msg, 'to');
    const parsed = parseInboundMessage(msg);
    if (!rawFrom || !to || !parsed) {
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
    if (!company) {
      return { received: true };
    }

    const cred = await this.credentials.getByCompanyId(company.id, 'whatsapp');
    if (cred?.provider !== 'ycloud' || !cred.webhookSecret) {
      this.logger.warn(
        `WhatsApp (YCloud) sin secreto de firma configurado para companyId=` +
          `${company.id}: mensaje RECHAZADO. Configúralo en Integraciones → ` +
          'WhatsApp → "Secreto de firma del webhook".',
      );
      throw new UnauthorizedException(
        'WhatsApp (YCloud) sin secreto de firma configurado para esta empresa',
      );
    }
    if (
      !verifyYCloudSignature(
        req.rawBody ?? Buffer.from(''),
        this.header(req, 'ycloud-signature'),
        cred.webhookSecret,
      )
    ) {
      throw new UnauthorizedException('Firma de YCloud inválida');
    }

    await TenantContext.run(
      { companyId: company.id, correlationId: randomUUID() },
      () =>
        this.inbound.handleIncoming(from, parsed.text, {
          wakeAgent: parsed.wakeAgent,
        }),
    );
    return { received: true };
  }

  /**
   * Extrae los mensajes del payload de Meta de forma segura. Los que no son
   * texto (audios, fotos, botones) se normalizan en `parseInboundMessage`.
   */
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
          const parsed = parseInboundMessage(message);
          if (from && parsed) {
            out.push({ phoneNumberId, from, ...parsed });
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

  private header(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
