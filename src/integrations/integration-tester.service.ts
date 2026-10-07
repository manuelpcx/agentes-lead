import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService, IntegrationChannel } from './credentials.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { PrismaService } from '../common/prisma/prisma.service';
import { deliverCrmEvent } from '../crm/crm-delivery';
import {
  parseVoiceConfig,
  voiceConfigToOverrides,
} from '../voice/voice-config';
import {
  buildElevenLabsOverride,
  readOverridePermissions,
} from '../voice/providers/elevenlabs.provider';

/** Resultado de probar una integración. */
export interface TestResult {
  ok: boolean;
  message: string;
}

/**
 * Prueba las credenciales de un canal haciendo una llamada ligera y autenticada
 * al proveedor (sin enviar nada al cliente). Valida que la API key sirva.
 */
@Injectable()
export class IntegrationTester {
  private readonly logger = new Logger('IntegrationTester');

  constructor(
    private readonly credentials: CredentialsService,
    private readonly prisma: PrismaService,
  ) {}

  async test(channel: IntegrationChannel): Promise<TestResult> {
    const c = await this.credentials.get(channel);
    if (!c || !c.secret) {
      return {
        ok: false,
        message: 'Aún no hay credenciales guardadas para este canal.',
      };
    }
    try {
      if (channel === 'whatsapp') {
        return await this.testWhatsapp(c.provider, c.secret, c.config);
      }
      if (channel === 'email') {
        return await this.testEmail(c.provider, c.secret);
      }
      if (channel === 'voice') {
        return await this.testVoice(c.provider, c.secret, c.config);
      }
      if (channel === 'crm') {
        return await this.testCrm(c.secret, c.config);
      }
      return { ok: false, message: 'Canal no soportado.' };
    } catch (e) {
      this.logger.warn(`Prueba de ${channel} falló: ${(e as Error).message}`);
      return { ok: false, message: 'No se pudo conectar con el proveedor.' };
    }
  }

  private async testWhatsapp(
    provider: string,
    secret: string,
    config: Record<string, unknown>,
  ): Promise<TestResult> {
    if (provider !== 'ycloud') {
      return {
        ok: true,
        message: 'Proveedor Meta: no se valida automáticamente aquí.',
      };
    }
    const qs = config.wabaId
      ? `?filter.wabaId=${String(config.wabaId)}&limit=1`
      : '?limit=1';
    const res = await fetch(
      `https://api.ycloud.com/v2/whatsapp/templates${qs}`,
      {
        headers: { 'X-API-Key': secret },
      },
    );
    if (res.ok) {
      return { ok: true, message: 'Conexión con YCloud correcta.' };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: 'API key de YCloud inválida (no autorizada).',
      };
    }
    return { ok: false, message: `YCloud respondió ${res.status}.` };
  }

  private async testEmail(
    provider: string,
    secret: string,
  ): Promise<TestResult> {
    if (provider !== 'resend') {
      return {
        ok: true,
        message: 'Proveedor SMTP: no se valida automáticamente aquí.',
      };
    }
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.ok) {
      return { ok: true, message: 'Conexión con Resend correcta.' };
    }
    if (res.status === 401) {
      return { ok: false, message: 'API key de Resend inválida.' };
    }
    return { ok: false, message: `Resend respondió ${res.status}.` };
  }

  private async testVoice(
    provider: string,
    secret: string,
    config: Record<string, unknown>,
  ): Promise<TestResult> {
    if (provider === 'elevenlabs') {
      return this.testElevenLabs(secret, config);
    }
    if (provider !== 'retell') {
      return {
        ok: true,
        message: 'Proveedor Vapi: no se valida automáticamente aquí.',
      };
    }
    const res = await fetch('https://api.retellai.com/list-voices', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.ok) {
      return { ok: true, message: 'Conexión con Retell correcta.' };
    }
    if (res.status === 401) {
      return { ok: false, message: 'API key de Retell inválida.' };
    }
    return { ok: false, message: `Retell respondió ${res.status}.` };
  }

  /**
   * ElevenLabs: lee el agente y el número configurados. Así la prueba valida
   * la API key y además que los dos IDs existan en esa cuenta, que es donde
   * suele estar el error.
   */
  private async testElevenLabs(
    secret: string,
    config: Record<string, unknown>,
  ): Promise<TestResult> {
    const agentId = typeof config.agentId === 'string' ? config.agentId : '';
    const phoneId =
      typeof config.phoneNumberId === 'string' ? config.phoneNumberId : '';
    if (!agentId || !phoneId) {
      return {
        ok: false,
        message: 'Faltan el Agent ID o el Phone Number ID de ElevenLabs.',
      };
    }
    const get = (path: string) =>
      fetch(`https://api.elevenlabs.io${path}`, {
        headers: { 'xi-api-key': secret },
      });
    const agent = await get(`/v1/convai/agents/${encodeURIComponent(agentId)}`);
    if (agent.status === 401) {
      return { ok: false, message: 'API key de ElevenLabs inválida.' };
    }
    if (!agent.ok) {
      return {
        ok: false,
        message: `No se encontró el agente ${agentId} en ElevenLabs (${agent.status}).`,
      };
    }
    const phone = await get(
      `/v1/convai/phone-numbers/${encodeURIComponent(phoneId)}`,
    );
    if (!phone.ok) {
      return {
        ok: false,
        message: `No se encontró el número ${phoneId} en ElevenLabs (${phone.status}).`,
      };
    }
    const { provider } = (await phone.json()) as { provider?: string };
    if (provider !== 'twilio' && provider !== 'sip_trunk') {
      return {
        ok: false,
        message: `El número es de tipo "${provider}": para llamar tiene que ser Twilio o SIP trunk.`,
      };
    }

    // La conexión está bien, pero si en Configuración hay voz/saludo/idioma/
    // velocidad que el agente no deja cambiar, las llamadas no los van a usar:
    // mejor enterarse acá que por una llamada que suena distinto.
    const company = await this.prisma.raw.company.findUnique({
      where: { id: TenantContext.requireCompanyId() },
      select: { channelsConfig: true },
    });
    const { dropped } = buildElevenLabsOverride(
      voiceConfigToOverrides(parseVoiceConfig(company?.channelsConfig)),
      readOverridePermissions(await agent.json()),
    );
    if (dropped.length > 0) {
      return {
        ok: true,
        message:
          `Conexión con ElevenLabs correcta, pero el agente no permite cambiar ` +
          `${dropped.join(', ')}. Habilítalo en la pestaña Security del agente ` +
          'o bórralo en Configuración → Voz del agente; mientras tanto, las ' +
          'llamadas usan el del agente.',
      };
    }
    return { ok: true, message: 'Conexión con ElevenLabs correcta.' };
  }

  /**
   * Manda un evento `test.ping` REAL, firmado, al webhook del CRM — a
   * diferencia de los demás (que solo hacen un GET liviano), esto además le
   * deja al cliente un ejemplo real del payload/firma para armar su workflow.
   */
  private async testCrm(
    secret: string,
    config: Record<string, unknown>,
  ): Promise<TestResult> {
    const url = config.url;
    if (typeof url !== 'string' || !url) {
      return { ok: false, message: 'Falta la URL del webhook del CRM.' };
    }
    const result = await deliverCrmEvent(url, secret, {
      companyId: TenantContext.requireCompanyId(),
      leadId: 'test-lead',
      externalId: null,
      event: 'test.ping',
      data: { mensaje: 'Ping de prueba desde el panel de Integraciones.' },
      occurredAt: new Date().toISOString(),
    });
    return { ok: result.ok, message: result.message };
  }
}
