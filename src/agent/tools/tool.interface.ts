import Anthropic from '@anthropic-ai/sdk';
import { AgentType, Lead } from '@prisma/client';
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
   * Mensajes que escribió el CLIENTE en el historial visible. Cuentan como
   * respaldo del guardrail: repetirle un dato que él mismo dio (su RUT, su
   * dirección, el número de su pedido) no es inventar una cifra.
   */
  clientMessages?: string[];
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
  /** Zona horaria efectiva del lead/empresa (para agendar por hora absoluta). */
  timezone?: string | null;
  /**
   * El turno es proactivo (seguimiento), no una respuesta a un mensaje del
   * cliente. Lo usa la derivación: en un seguimiento no hay mensaje al que
   * responder, así que el receptor debe contactar proactivamente (no encolar un
   * turno de respuesta ni avisar al cliente).
   */
  followUp?: boolean;
  /**
   * El turno de seguimiento cumple algo que pidió el propio lead (la llamada
   * que agendó). Aunque sea un seguimiento, no es una gestión proactiva: no
   * cuenta para los topes legales de cobranza.
   */
  requestedByLead?: boolean;
  /** Tipo del agente a cargo: el piso legal de cobranza depende de esto. */
  agentType?: AgentType;
  /** El lead fue escalado a humano en este turno. */
  escalated: boolean;
  /**
   * El lead fue derivado a otro agente en este turno. El seguimiento no debe
   * contar esto como un intento de contacto: la derivación reprograma al
   * receptor por su cuenta.
   */
  derived?: boolean;
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
