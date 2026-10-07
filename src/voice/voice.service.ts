import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentType } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import {
  StartCallParams,
  VoiceProvider,
} from './providers/voice-provider.interface';
import { LogVoiceProvider } from './providers/log.provider';
import { VapiVoiceProvider } from './providers/vapi.provider';
import { RetellVoiceProvider } from './providers/retell.provider';
import { ElevenLabsVoiceProvider } from './providers/elevenlabs.provider';
import { VoiceUsageService } from './voice-usage.service';

/** Por dónde llama una empresa. */
export type VoiceMode = 'byo' | 'managed' | 'none';

export interface VoiceAvailability {
  mode: VoiceMode;
  /** Se puede llamar ahora (con cuenta propia, o con minutos y cupo). */
  canCall: boolean;
  reason?: string;
  /** Solo en la voz gestionada. */
  minutesUsed?: number;
  minutesLimit?: number;
}

/** Cuentas de la plataforma para la voz gestionada (de las variables de entorno). */
interface ManagedVoiceConfig {
  apiKey: string;
  phoneNumberId: string;
  agentDefault: string;
  agentCobranza?: string;
  webhookSecret: string;
}

/**
 * Fachada de llamadas de voz de una empresa (la del contexto activo). Por
 * dónde llama, en orden:
 *  1. su cuenta propia, si la conectó (Integraciones → Voz → avanzado);
 *  2. la voz gestionada: la cuenta de ElevenLabs de la plataforma, con su
 *     número y un agente de voz por tipo, dentro del tope mensual de minutos
 *     y de llamadas simultáneas de la empresa;
 *  3. si no hay ninguna, no llama.
 * Cada llamada queda registrada (`VoiceCall`) para contar minutos y cerrar la
 * llamada cuando llega el webhook de fin.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger('VoiceService');
  private readonly managed: ManagedVoiceConfig | null;

  constructor(
    private readonly credentials: CredentialsService,
    private readonly usage: VoiceUsageService,
    config: ConfigService<EnvVars, true>,
  ) {
    const get = (k: keyof EnvVars) =>
      (config.get(k, { infer: true }) as string | undefined) || undefined;
    const apiKey = get('ELEVENLABS_API_KEY');
    const phoneNumberId = get('ELEVENLABS_PHONE_NUMBER_ID');
    const agentDefault = get('ELEVENLABS_AGENT_ID_DEFAULT');
    const webhookSecret = get('ELEVENLABS_WEBHOOK_SECRET');
    this.managed =
      apiKey && phoneNumberId && agentDefault && webhookSecret
        ? {
            apiKey,
            phoneNumberId,
            agentDefault,
            agentCobranza: get('ELEVENLABS_AGENT_ID_COBRANZA'),
            webhookSecret,
          }
        : null;
  }

  /** El servidor tiene la voz gestionada configurada. */
  get managedAvailable(): boolean {
    return this.managed !== null;
  }

  /** Secreto del webhook post-llamada del workspace de la plataforma. */
  get managedWebhookSecret(): string | undefined {
    return this.managed?.webhookSecret;
  }

  /** API key de ElevenLabs de la plataforma (para el catálogo de voces). */
  get managedApiKey(): string | undefined {
    return this.managed?.apiKey;
  }

  /** Por dónde llamaría la empresa activa y si puede hacerlo ahora. */
  async availability(): Promise<VoiceAvailability> {
    if (await this.byoProvider()) {
      return { mode: 'byo', canCall: true };
    }
    if (!this.managed) {
      return {
        mode: 'none',
        canCall: false,
        reason: 'Las llamadas no están configuradas.',
      };
    }
    const check = await this.usage.check(TenantContext.requireCompanyId());
    return {
      mode: 'managed',
      canCall: check.allowed,
      reason: check.reason,
      minutesUsed: check.minutesUsed,
      minutesLimit: check.minutesLimit,
    };
  }

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    const companyId = TenantContext.requireCompanyId();
    const leadId =
      typeof params.metadata.leadId === 'string'
        ? params.metadata.leadId
        : undefined;

    const byo = await this.byoProvider();
    if (byo) {
      const result = await byo.provider.startCall(params);
      if (leadId) {
        await this.usage.recordStart({
          companyId,
          leadId,
          provider: byo.name,
          managed: false,
          callId: result.callId,
        });
      }
      return result;
    }

    if (!this.managed) {
      this.logger.warn(
        'Voz no configurada para la empresa: no se llama (configúralo en el panel).',
      );
      return new LogVoiceProvider().startCall(params);
    }

    const check = await this.usage.check(companyId);
    if (!check.allowed) {
      throw new Error(
        `No se inició la llamada: ${check.reason} Sigue por WhatsApp o correo.`,
      );
    }
    const agentId =
      params.agentType === AgentType.COBRANZA && this.managed.agentCobranza
        ? this.managed.agentCobranza
        : this.managed.agentDefault;
    const result = await new ElevenLabsVoiceProvider({
      apiKey: this.managed.apiKey,
      agentId,
      phoneNumberId: this.managed.phoneNumberId,
    }).startCall(params);
    if (leadId) {
      await this.usage.recordStart({
        companyId,
        leadId,
        provider: 'elevenlabs',
        managed: true,
        callId: result.callId,
      });
    }
    return result;
  }

  /** La cuenta de voz propia de la empresa, si la conectó completa. */
  private async byoProvider(): Promise<{
    provider: VoiceProvider;
    name: string;
  } | null> {
    const c = await this.credentials.get('voice');
    if (!c?.isActive || !c.secret) {
      return null;
    }
    if (c.provider === 'retell' && c.config.fromNumber) {
      return {
        name: 'retell',
        provider: new RetellVoiceProvider({
          apiKey: c.secret,
          fromNumber: String(c.config.fromNumber),
          agentId: c.config.agentId ? String(c.config.agentId) : undefined,
        }),
      };
    }
    if (c.provider === 'vapi') {
      return {
        name: 'vapi',
        provider: new VapiVoiceProvider({
          apiKey: c.secret,
          phoneNumberId: c.config.phoneNumberId
            ? String(c.config.phoneNumberId)
            : undefined,
          assistantId: c.config.assistantId
            ? String(c.config.assistantId)
            : undefined,
        }),
      };
    }
    if (
      c.provider === 'elevenlabs' &&
      c.config.agentId &&
      c.config.phoneNumberId
    ) {
      return {
        name: 'elevenlabs',
        provider: new ElevenLabsVoiceProvider({
          apiKey: c.secret,
          agentId: String(c.config.agentId),
          phoneNumberId: String(c.config.phoneNumberId),
        }),
      };
    }
    return null;
  }
}
