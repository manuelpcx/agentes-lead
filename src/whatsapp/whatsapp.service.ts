import { Inject, Injectable } from '@nestjs/common';
import {
  WHATSAPP_PROVIDER,
  WhatsappProvider,
} from './providers/whatsapp-provider.interface';

/** Fachada de salida de WhatsApp. El agente envía mensajes a través de aquí. */
@Injectable()
export class WhatsappService {
  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsappProvider,
  ) {}

  send(to: string, text: string): Promise<void> {
    return this.provider.send(to, text);
  }
}
