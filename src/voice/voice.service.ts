import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';
import {
  StartCallParams,
  VoiceProvider,
} from './providers/voice-provider.interface';
import { LogVoiceProvider } from './providers/log.provider';
import { VapiVoiceProvider } from './providers/vapi.provider';
import { RetellVoiceProvider } from './providers/retell.provider';

/**
 * Fachada de llamadas de voz. Resuelve el proveedor con las credenciales de la
 * empresa activa (BYO): Retell o Vapi con las llaves del cliente. Sin config, no
 * llama (log).
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger('VoiceService');

  constructor(private readonly credentials: CredentialsService) {}

  private async provider(): Promise<VoiceProvider> {
    const c = await this.credentials.get('voice');
    if (c?.isActive && c.secret) {
      if (c.provider === 'retell' && c.config.fromNumber) {
        return new RetellVoiceProvider({
          apiKey: c.secret,
          fromNumber: String(c.config.fromNumber),
          agentId: c.config.agentId ? String(c.config.agentId) : undefined,
        });
      }
      if (c.provider === 'vapi') {
        return new VapiVoiceProvider({
          apiKey: c.secret,
          phoneNumberId: c.config.phoneNumberId
            ? String(c.config.phoneNumberId)
            : undefined,
          assistantId: c.config.assistantId
            ? String(c.config.assistantId)
            : undefined,
        });
      }
    }
    this.logger.warn(
      'Voz no configurada para la empresa: no se llama (configúralo en el panel).',
    );
    return new LogVoiceProvider();
  }

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    return (await this.provider()).startCall(params);
  }
}
