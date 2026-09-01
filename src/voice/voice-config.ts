/**
 * Configuración de voz por empresa (multiempresa). Vive en
 * `Company.channelsConfig.voice` y se aplica por llamada vía `agent_override` de
 * Retell (voz/velocidad/idioma/saludo) + la variable dinámica `tono`. Así un
 * único agente base de Retell sirve a todas las empresas, cada una con su voz y
 * su tono.
 */
export interface VoiceConfig {
  /** `voice_id` de Retell (del catálogo `list-voices`). */
  voiceId?: string;
  /** Tono/estilo del agente de voz; se inyecta en el prompt como {{tono}}. */
  tone?: string;
  /** Saludo inicial (puede usar variables {{nombre}}, {{empresa}}). */
  beginMessage?: string;
  /** Idioma de la voz (p. ej. 'es-ES', 'es-419', 'multi'). */
  language?: string;
  /** Velocidad de habla (0.5–2, 1 = normal). */
  speed?: number;
}

/** Tono por defecto cuando la empresa no configuró uno. */
export const DEFAULT_VOICE_TONE =
  'Cálido, cercano y profesional. Frases breves y naturales, una idea a la vez.';

/** Overrides que el provider traduce a la config por llamada del proveedor. */
export interface VoiceOverrides {
  voiceId?: string;
  voiceSpeed?: number;
  language?: string;
  beginMessage?: string;
}

/** Lee y valida la config de voz desde `channelsConfig` (tolerante a basura). */
export function parseVoiceConfig(channelsConfig: unknown): VoiceConfig {
  const cc = channelsConfig as { voice?: Record<string, unknown> } | null;
  const v = cc?.voice;
  if (!v || typeof v !== 'object') {
    return {};
  }
  const out: VoiceConfig = {};
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
  out.voiceId = str(v.voiceId);
  out.tone = str(v.tone);
  out.beginMessage = str(v.beginMessage);
  out.language = str(v.language);
  const speed = Number(v.speed);
  if (Number.isFinite(speed) && speed > 0) {
    out.speed = speed;
  }
  return out;
}

/** Traduce la config de voz de una empresa a overrides de llamada. */
export function voiceConfigToOverrides(cfg: VoiceConfig): VoiceOverrides {
  return {
    voiceId: cfg.voiceId,
    voiceSpeed: cfg.speed,
    language: cfg.language,
    beginMessage: cfg.beginMessage,
  };
}
