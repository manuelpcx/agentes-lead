import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { EnvVars } from '../common/config/env.validation';
import { TenantContext } from '../common/tenant/tenant-context';
import { ProviderHealthService } from '../alerts/provider-health.service';

/** Entrada de un turno del modelo: system + historial + herramientas. */
export interface CreateMessageInput {
  /**
   * Texto plano, o bloques. Con bloques, el primero puede llevar
   * `cache_control` para que la API reutilice ese prefijo (herramientas
   * incluidas) en las siguientes iteraciones del turno.
   */
  system: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  /** Por defecto 'auto' (el SDK). Pásalo para forzar el uso de alguna tool. */
  toolChoice?: Anthropic.ToolChoice;
}

/**
 * Envoltura del SDK de Anthropic. Si no hay `ANTHROPIC_API_KEY`, el cliente
 * queda nulo y `isConfigured()` devuelve false: el agente degrada a
 * escalamiento en vez de romper. Se deja el thinking en adaptive (default en
 * sonnet-5); NO se desactiva (desactivarlo tiene fallos conocidos de tool-calls).
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  /** Para tareas de fondo; si no se configura, el mismo `model`. */
  private readonly backgroundModel: string;
  private readonly effort: EnvVars['ANTHROPIC_EFFORT'];
  private readonly maxTokens: number;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly health: ProviderHealthService,
  ) {
    const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('ANTHROPIC_MODEL', { infer: true });
    this.backgroundModel =
      config.get('ANTHROPIC_BACKGROUND_MODEL', { infer: true }) || this.model;
    this.effort = config.get('ANTHROPIC_EFFORT', { infer: true });
    this.maxTokens = config.get('ANTHROPIC_MAX_TOKENS', { infer: true });
    this.client = apiKey ? new Anthropic({ apiKey }) : null;

    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY ausente: el agente degradará a escalamiento humano',
      );
    }
  }

  /** true si hay credenciales para invocar el modelo. */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Completa un prompt simple (sin herramientas) y devuelve el texto. Lanza si
   * no hay cliente.
   *
   * `background: true` es para tareas simples y de mucho volumen fuera de la
   * conversación (resumir la memoria, elegir agente): van al modelo de
   * `ANTHROPIC_BACKGROUND_MODEL`. El análisis nocturno y el playbook quedan
   * en el principal: detectar fallas de cumplimiento y redactar un prompt
   * piden el mejor juicio, y corren pocas veces.
   */
  async complete(
    system: string,
    userText: string,
    opts: { background?: boolean } = {},
  ): Promise<string> {
    const client = this.client;
    if (!client) {
      throw new Error(
        'Anthropic no está configurado (falta ANTHROPIC_API_KEY)',
      );
    }
    const response = await this.observe(() =>
      client.messages.create({
        model: opts.background ? this.backgroundModel : this.model,
        max_tokens: this.maxTokens,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: userText }],
      }),
    );
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  /** Ejecuta un turno del modelo con herramientas. Lanza si no hay cliente. */
  async createMessage(input: CreateMessageInput): Promise<Anthropic.Message> {
    const client = this.client;
    if (!client) {
      throw new Error(
        'Anthropic no está configurado (falta ANTHROPIC_API_KEY)',
      );
    }
    return this.observe(() =>
      client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        output_config: { effort: this.effort },
        system: input.system,
        tools: input.tools,
        tool_choice: input.toolChoice,
        messages: input.messages,
      }),
    );
  }

  /** La IA siempre es cuenta de la plataforma. */
  private observe<T>(send: () => Promise<T>): Promise<T> {
    return this.health.observe(
      {
        service: 'llm',
        provider: 'anthropic',
        scope: 'platform',
        companyId: TenantContext.getCompanyId(),
      },
      send,
    );
  }
}
