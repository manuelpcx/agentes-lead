import { Injectable, Logger } from '@nestjs/common';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { ProviderHealthService } from '../alerts/provider-health.service';
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

  constructor(
    private readonly credentials: CredentialsService,
    private readonly health: ProviderHealthService,
  ) {}

  /** El proveedor de la empresa y su nombre (null = log, no se vigila). */
  private async provider(): Promise<{
    provider: WhatsappProvider;
    name: string | null;
  }> {
    const c = await this.credentials.get('whatsapp');
    if (c?.isActive && c.secret) {
      if (c.provider === 'ycloud' && c.config.from) {
        return {
          name: 'ycloud',
          provider: new YCloudWhatsappProvider(c.secret, String(c.config.from)),
        };
      }
      if (c.provider === 'meta' && c.config.phoneNumberId) {
        return {
          name: 'meta',
          provider: new MetaCloudWhatsappProvider(
            c.secret,
            String(c.config.phoneNumberId),
          ),
        };
      }
    }
    this.logger.warn(
      'WhatsApp no configurado para la empresa: no se envía (configúralo en el panel).',
    );
    return { name: null, provider: new LogWhatsappProvider() };
  }

  async send(to: string, text: string): Promise<void> {
    const { provider, name } = await this.provider();
    return this.observe(name, () => provider.send(to, text));
  }

  /** Envía una plantilla aprobada (para iniciar fuera de la ventana de 24h). */
  async sendTemplate(
    to: string,
    template: WhatsappTemplateMessage,
  ): Promise<void> {
    const { provider, name } = await this.provider();
    return this.observe(name, () => provider.sendTemplate(to, template));
  }

  /** WhatsApp siempre es cuenta de la empresa (sus llaves). */
  private observe<T>(name: string | null, send: () => Promise<T>): Promise<T> {
    if (!name) return send();
    return this.health.observe(
      {
        service: 'whatsapp',
        provider: name,
        scope: 'company',
        companyId: TenantContext.getCompanyId(),
      },
      send,
    );
  }
}
