import { Logger } from '@nestjs/common';
import {
  WhatsappProvider,
  WhatsappTemplateMessage,
} from './whatsapp-provider.interface';
import { whatsappSendError } from './send-error';

const GRAPH_VERSION = 'v21.0';

/**
 * Proveedor de WhatsApp contra la Cloud API de Meta. Envía mensajes de texto
 * al número indicado usando el `phoneNumberId` y el token de acceso.
 */
export class MetaCloudWhatsappProvider implements WhatsappProvider {
  private readonly logger = new Logger('WhatsApp(meta)');

  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
  ) {}

  async send(to: string, text: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async sendTemplate(
    to: string,
    template: WhatsappTemplateMessage,
  ): Promise<void> {
    const components =
      template.bodyParams.length > 0
        ? [
            {
              type: 'body',
              parameters: template.bodyParams.map((text) => ({
                type: 'text',
                text,
              })),
            },
          ]
        : [];
    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.languageCode },
        components,
      },
    });
  }

  /** POST común a la Cloud API; lanza si Meta responde con error. */
  private async post(body: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Meta respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw whatsappSendError('Meta', response.status, detail);
    }
  }
}
