import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { EmailMessage } from './providers/email-provider.interface';
import { LogEmailProvider } from './providers/log.provider';
import { ResendEmailProvider } from './providers/resend.provider';
import { byoEmailProvider } from './byo-email';
import { ManagedEmailService } from './managed-email.service';
import { EmailQuotaService } from './email-quota.service';

/**
 * Fachada de envío de correo de una empresa (la del contexto activo). Por
 * dónde sale, en orden:
 *  1. su cuenta propia, si la conectó (Integraciones → Correo → avanzado);
 *  2. la cuenta de Resend de la plataforma con su dominio, si ya está verificado;
 *  3. la misma cuenta desde el dominio compartido de la plataforma, con el
 *     nombre de la empresa como remitente (mientras verifica el suyo);
 *  4. si no hay nada de eso, no se envía (queda en el log).
 * Los envíos por la cuenta de la plataforma respetan el tope diario por empresa.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(
    private readonly credentials: CredentialsService,
    private readonly managed: ManagedEmailService,
    private readonly quota: EmailQuotaService,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const byo = byoEmailProvider(await this.credentials.get('email'));
    if (byo) {
      return byo.send(message);
    }

    const companyId = TenantContext.requireCompanyId();
    const sender = await this.managed.platformSender(companyId);
    const apiKey = this.managed.platformApiKey;
    if (!sender || !apiKey) {
      this.logger.warn(
        'Correo no configurado para la empresa: no se envía (configúralo en el panel).',
      );
      return new LogEmailProvider().send(message);
    }

    const cupo = await this.quota.consume(companyId);
    if (!cupo.allowed) {
      throw new Error(
        `Límite diario de correos alcanzado (${cupo.limit} por día): no se ` +
          'envió. Se reanuda mañana.',
      );
    }
    await new ResendEmailProvider(apiKey, sender.from).send({
      ...message,
      replyTo: message.replyTo ?? sender.replyTo,
      // La empresa en cada envío: los eventos de Resend (rebotes, quejas)
      // vuelven con estas etiquetas y así se sabe de quién son.
      tags: { ...message.tags, company_id: companyId },
    });
  }
}
