import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StartCallParams, VoiceProvider } from './voice-provider.interface';

/** Proveedor de llamadas para desarrollo: no llama, registra y devuelve un id. */
export class LogVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger('Voice(log)');

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    const callId = `stub-${randomUUID()}`;
    this.logger.log(
      `Llamada simulada a ${params.to} (callId=${callId})` +
        (params.dynamicVariables
          ? ` vars=${JSON.stringify(params.dynamicVariables)}`
          : ''),
    );
    return { callId };
  }
}
