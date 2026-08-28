import { Logger } from '@nestjs/common';
import { StartCallParams, VoiceProvider } from './voice-provider.interface';

const RETELL_URL = 'https://api.retellai.com/v2/create-phone-call';

export interface RetellConfig {
  apiKey: string;
  /** Número de negocio (Twilio) importado en Retell, en E.164. `from_number`. */
  fromNumber: string;
  /** Agente de voz de Retell a usar en la llamada. `override_agent_id`. */
  agentId?: string;
}

/**
 * Proveedor de llamadas contra Retell AI. Retell es un agente de voz completo:
 * corre la conversación con su propio prompt/voz/LLM (configurados en Retell).
 * Nosotros solo disparamos la llamada, le pasamos el contexto del lead como
 * variables dinámicas, y recibimos la transcripción por webhook.
 * Doc: https://docs.retellai.com/api-references/create-phone-call
 */
export class RetellVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger('Voice(retell)');

  constructor(private readonly config: RetellConfig) {}

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    const body: Record<string, unknown> = {
      from_number: this.config.fromNumber,
      to_number: params.to,
      metadata: params.metadata,
    };
    if (this.config.agentId) {
      body.override_agent_id = this.config.agentId;
    }
    if (params.dynamicVariables) {
      body.retell_llm_dynamic_variables = params.dynamicVariables;
    }

    const response = await fetch(RETELL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Retell respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw new Error(`Fallo al iniciar la llamada (Retell ${response.status})`);
    }

    const json = (await response.json()) as { call_id?: string };
    return { callId: json.call_id ?? 'desconocido' };
  }
}
