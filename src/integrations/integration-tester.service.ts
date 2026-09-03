import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService, IntegrationChannel } from './credentials.service';

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

  constructor(private readonly credentials: CredentialsService) {}

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
        return await this.testVoice(c.provider, c.secret);
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
  ): Promise<TestResult> {
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
}
