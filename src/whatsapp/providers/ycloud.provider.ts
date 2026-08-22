import { Logger } from '@nestjs/common';
import {
  WhatsappProvider,
  WhatsappTemplateMessage,
} from './whatsapp-provider.interface';

/**
 * Proveedor de WhatsApp vía YCloud (BSP). Envía texto con `sendDirectly`
 * (síncrono). `from` es el número de negocio (E.164) configurado por env.
 * Doc: https://docs.ycloud.com/reference/whatsapp_message-send-directly
 */
export class YCloudWhatsappProvider implements WhatsappProvider {
  private readonly logger = new Logger('WhatsApp(ycloud)');
  private readonly url =
    'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: string, text: string): Promise<void> {
    await this.post({ from: this.from, to, type: 'text', text: { body: text } });
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
      from: this.from,
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.languageCode },
        components,
      },
    });
  }

  /** POST común a `sendDirectly`; lanza si YCloud responde con error. */
  private async post(body: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `YCloud respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw new Error(`Fallo al enviar WhatsApp (YCloud ${response.status})`);
    }
  }
}
