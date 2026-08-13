import { Logger } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';

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
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Meta respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw new Error(`Fallo al enviar WhatsApp (Meta ${response.status})`);
    }
  }
}
