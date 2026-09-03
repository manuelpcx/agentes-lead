import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';
import {
  WhatsappProvider,
  WhatsappTemplateMessage,
} from './providers/whatsapp-provider.interface';
import { LogWhatsappProvider } from './providers/log.provider';
import { MetaCloudWhatsappProvider } from './providers/meta-cloud.provider';
import { YCloudWhatsappProvider } from './providers/ycloud.provider';

/**
 * Fachada de salida de WhatsApp. Resuelve el proveedor con las credenciales de
 * la empresa activa (BYO): YCloud o Meta con las llaves que el cliente configuró
 * en el panel. Si la empresa no tiene WhatsApp configurado, no envía (log).
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsappService');

  constructor(private readonly credentials: CredentialsService) {}

  private async provider(): Promise<WhatsappProvider> {
    const c = await this.credentials.get('whatsapp');
    if (c?.isActive && c.secret) {
      if (c.provider === 'ycloud' && c.config.from) {
        return new YCloudWhatsappProvider(c.secret, String(c.config.from));
      }
      if (c.provider === 'meta' && c.config.phoneNumberId) {
        return new MetaCloudWhatsappProvider(
          c.secret,
          String(c.config.phoneNumberId),
        );
      }
    }
    this.logger.warn(
      'WhatsApp no configurado para la empresa: no se envía (configúralo en el panel).',
    );
    return new LogWhatsappProvider();
  }

  async send(to: string, text: string): Promise<void> {
    return (await this.provider()).send(to, text);
  }

  /** Envía una plantilla aprobada (para iniciar fuera de la ventana de 24h). */
  async sendTemplate(
    to: string,
    template: WhatsappTemplateMessage,
  ): Promise<void> {
    return (await this.provider()).sendTemplate(to, template);
  }
}
