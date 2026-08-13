import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StartCallParams, VapiProvider } from './vapi-provider.interface';

/** Proveedor de llamadas para desarrollo: no llama, registra y devuelve un id. */
export class LogVapiProvider implements VapiProvider {
  private readonly logger = new Logger('Vapi(log)');

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    const callId = `stub-${randomUUID()}`;
    this.logger.log(`Llamada simulada a ${params.to} (callId=${callId})`);
    return { callId };
  }
}
