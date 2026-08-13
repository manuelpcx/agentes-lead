import { Logger } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp-provider.interface';

/**
 * Proveedor de WhatsApp para desarrollo: no envía nada real, solo registra el
 * mensaje. Permite probar el pipeline completo sin credenciales de Meta.
 */
export class LogWhatsappProvider implements WhatsappProvider {
  private readonly logger = new Logger('WhatsApp(log)');

  async send(to: string, text: string): Promise<void> {
    this.logger.log(`→ ${to}: ${text}`);
  }
}
