import { Logger } from '@nestjs/common';
import { ProviderError } from '../../alerts/provider-error';
import { StartCallParams, VoiceProvider } from './voice-provider.interface';

const VAPI_URL = 'https://api.vapi.ai/call';

export interface VapiApiConfig {
  apiKey: string;
  phoneNumberId?: string;
  assistantId?: string;
}

/** Proveedor de llamadas contra la API de Vapi.ai. */
export class VapiVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger('Voice(vapi)');

  constructor(private readonly config: VapiApiConfig) {}

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    const response = await fetch(VAPI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        phoneNumberId: this.config.phoneNumberId,
        assistantId: this.config.assistantId,
        customer: { number: params.to },
        metadata: params.metadata,
        // Vapi inyecta variables al assistant vía assistantOverrides.
        assistantOverrides: params.dynamicVariables
          ? { variableValues: params.dynamicVariables }
          : undefined,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Vapi respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw new ProviderError(
        `Fallo al iniciar la llamada (Vapi ${response.status})`,
        response.status,
      );
    }

    const json = (await response.json()) as { id?: string };
    return { callId: json.id ?? 'desconocido' };
  }
}
