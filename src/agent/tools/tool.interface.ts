import Anthropic from '@anthropic-ai/sdk';
import { Lead } from '@prisma/client';
import { VoiceConfig } from '../../voice/voice-config';

/**
 * Contexto compartido de un turno del agente. Los tools de consulta acumulan
 * en `recordedFacts` los datos obtenidos (base del guardrail de salida); los
 * tools de acción marcan señales que el runner lee para cortar el bucle.
 */
export interface ToolContext {
  lead: Lead;
  agentId: string;
  conversationId: string;
  /** Textos de resultados de consulta de este turno (para validar salida). */
  recordedFacts: string[];
  /**
   * Número de WhatsApp de la empresa (de `channelsConfig.whatsapp.phoneNumber`),
   * si está configurado. Es un dato propio válido: el agente puede citarlo (p.
   * ej. al invitar por correo a seguir por WhatsApp) sin que el guardrail lo
   * bloquee. Ver `leadFactSources`.
   */
  companyWhatsApp?: string | null;
  /** Nombre de la empresa (tenant), para personalizar (p. ej. la llamada de voz). */
  companyName?: string | null;
  /** Config de voz de la empresa (voz/tono/idioma/velocidad/saludo) para las llamadas. */
  companyVoice?: VoiceConfig | null;
  /** El lead fue escalado a humano en este turno. */
  escalated: boolean;
  /** Se envió al menos un mensaje al cliente en este turno. */
  messageSent: boolean;
}

/** Resultado de ejecutar una herramienta. */
export interface ToolResult {
  /** Contenido del `tool_result` que vuelve al modelo. */
  content: string;
  isError?: boolean;
  /** Solicita terminar el bucle de decisión (p. ej. tras escalar). */
  stop?: boolean;
}

/** Una herramienta expuesta al modelo. */
export interface AgentTool {
  readonly name: string;
  /** Definición (schema) que ve el modelo. */
  readonly definition: Anthropic.Tool;
  execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult>;
}

/** Token de inyección para el arreglo de herramientas disponibles. */
export const AGENT_TOOLS = Symbol('AGENT_TOOLS');
