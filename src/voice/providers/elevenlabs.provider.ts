import { Logger } from '@nestjs/common';
import { StartCallParams, VoiceProvider } from './voice-provider.interface';

export const ELEVENLABS_API = 'https://api.elevenlabs.io';

export interface ElevenLabsConfig {
  apiKey: string;
  /** Agente de ElevenLabs Agents que conduce la llamada. */
  agentId: string;
  /** Número importado en ElevenLabs (Twilio o SIP trunk) desde el que se llama. */
  phoneNumberId: string;
}

/**
 * Tipo de cada número de ElevenLabs (Twilio o SIP trunk). No cambia, así que se
 * consulta una vez por número y proceso: cada tipo usa un endpoint distinto
 * para llamar.
 */
const tipoDeNumero = new Map<string, string>();

/** Endpoint de llamada saliente según el tipo de número. */
const OUTBOUND_PATH: Record<string, string> = {
  twilio: '/v1/convai/twilio/outbound-call',
  sip_trunk: '/v1/convai/sip-trunk/outbound-call',
};

/** Rango de velocidad que acepta ElevenLabs (1 = normal). */
const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;

/**
 * Qué campos deja cambiar cada agente por llamada (pestaña Security). Se
 * consulta como mucho cada 5 min: el dueño puede habilitar un campo y la
 * próxima llamada tiene que notarlo sin reiniciar el servidor.
 */
const PERMISOS_TTL_MS = 5 * 60 * 1000;
const permisosPorAgente = new Map<
  string,
  { at: number; permisos: OverridePermissions }
>();

/** Si una voz existe en la cuenta del agente (`agentId:voiceId`), por 1 h. */
const VOZ_TTL_MS = 60 * 60 * 1000;
const vozExiste = new Map<string, { at: number; existe: boolean }>();

/** Campos de la config de voz que el agente de ElevenLabs deja cambiar. */
export interface OverridePermissions {
  firstMessage: boolean;
  language: boolean;
  voiceId: boolean;
  speed: boolean;
}

const SIN_PERMISOS: OverridePermissions = {
  firstMessage: false,
  language: false,
  voiceId: false,
  speed: false,
};

/** Cómo se llama cada campo en el panel (Configuración → Voz del agente). */
const NOMBRE_CAMPO: Record<keyof OverridePermissions, string> = {
  firstMessage: 'saludo',
  language: 'idioma',
  voiceId: 'voz',
  speed: 'velocidad',
};

/**
 * Permisos de override del agente, desde su config
 * (`platform_settings.overrides.conversation_config_override`). Lo que no
 * venga en `true` se trata como no permitido.
 */
export function readOverridePermissions(agent: unknown): OverridePermissions {
  const get = (obj: unknown, key: string): unknown =>
    obj && typeof obj === 'object'
      ? (obj as Record<string, unknown>)[key]
      : undefined;
  const cco = get(
    get(get(agent, 'platform_settings'), 'overrides'),
    'conversation_config_override',
  );
  const agentOv = get(cco, 'agent');
  const ttsOv = get(cco, 'tts');
  return {
    firstMessage: get(agentOv, 'first_message') === true,
    language: get(agentOv, 'language') === true,
    voiceId: get(ttsOv, 'voice_id') === true,
    speed: get(ttsOv, 'speed') === true,
  };
}

/**
 * Config de voz de la empresa → `conversation_config_override`, SOLO con los
 * campos que el agente permite. ElevenLabs acepta la llamada aunque traiga un
 * override no habilitado y la corta al empezar la conversación ("Override for
 * field 'first_message' is not allowed by config"): mandarlo es perder la
 * llamada. `dropped` dice qué se dejó fuera, con el nombre del panel.
 */
export function buildElevenLabsOverride(
  ov: StartCallParams['overrides'],
  allowed: OverridePermissions,
): { override?: Record<string, unknown>; dropped: string[] } {
  const dropped: string[] = [];
  const agent: Record<string, unknown> = {};
  const tts: Record<string, unknown> = {};
  const poner = (
    campo: keyof OverridePermissions,
    destino: Record<string, unknown>,
    clave: string,
    valor: unknown,
  ) => {
    if (valor === undefined) {
      return;
    }
    if (allowed[campo]) {
      destino[clave] = valor;
    } else {
      dropped.push(NOMBRE_CAMPO[campo]);
    }
  };

  poner('firstMessage', agent, 'first_message', ov?.beginMessage || undefined);
  poner('language', agent, 'language', toElevenLabsLanguage(ov?.language));
  poner('voiceId', tts, 'voice_id', ov?.voiceId || undefined);
  // 1 es la velocidad normal: no hace falta pedir permiso para eso.
  poner(
    'speed',
    tts,
    'speed',
    typeof ov?.voiceSpeed === 'number' && ov.voiceSpeed !== 1
      ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, ov.voiceSpeed))
      : undefined,
  );

  const override: Record<string, unknown> = {};
  if (Object.keys(agent).length > 0) {
    override.agent = agent;
  }
  if (Object.keys(tts).length > 0) {
    override.tts = tts;
  }
  return {
    override: Object.keys(override).length > 0 ? override : undefined,
    dropped,
  };
}

/**
 * Proveedor de llamadas contra ElevenLabs Agents. Igual que Retell, es un
 * agente de voz completo: la conversación la conduce el agente configurado en
 * ElevenLabs (prompt, voz, LLM). Nosotros disparamos la llamada con el
 * contexto del lead como variables dinámicas y recibimos la transcripción por
 * el webhook post-llamada.
 * Doc: https://elevenlabs.io/docs/api-reference/twilio/outbound-call
 */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger('Voice(elevenlabs)');

  constructor(private readonly config: ElevenLabsConfig) {}

  async startCall(params: StartCallParams): Promise<{ callId: string }> {
    const path = await this.outboundPath();
    const override = await this.allowedOverride(params);

    let response = await this.post(path, this.body(params, override));
    // Red de seguridad: si aun así ElevenLabs rechaza la petición por la
    // config de voz (un valor que no acepta), se reintenta una vez con la
    // config propia del agente para que la llamada salga igual.
    if (override && response.status >= 400 && response.status < 500) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(
        `ElevenLabs rechazó la config de voz de la empresa (${response.status}: ` +
          `${detail.slice(0, 200)}). Se llama con la config del agente. Revisa ` +
          'que la voz sea de ElevenLabs y que los overrides estén habilitados ' +
          'en Security.',
      );
      response = await this.post(path, this.body(params, undefined));
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `ElevenLabs respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      // El detalle viaja en el mensaje para verlo en "Acciones del agente".
      throw new Error(
        `Fallo al iniciar la llamada (ElevenLabs ${response.status}): ` +
          `${detail.slice(0, 300) || '(sin detalle)'}`,
      );
    }

    const json = (await response.json()) as {
      success?: boolean;
      message?: string;
      conversation_id?: string | null;
      callSid?: string | null;
      sip_call_id?: string | null;
    };
    if (json.success === false) {
      throw new Error(
        `Fallo al iniciar la llamada (ElevenLabs): ${json.message ?? '(sin detalle)'}`,
      );
    }
    // El webhook post-llamada identifica la llamada por `conversation_id`.
    return {
      callId:
        json.conversation_id ??
        json.callSid ??
        json.sip_call_id ??
        'desconocido',
    };
  }

  private body(
    params: StartCallParams,
    override: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const clientData: Record<string, unknown> = {};
    if (params.dynamicVariables) {
      clientData.dynamic_variables = params.dynamicVariables;
    }
    if (override) {
      clientData.conversation_config_override = override;
    }
    return {
      agent_id: this.config.agentId,
      agent_phone_number_id: this.config.phoneNumberId,
      to_number: params.to,
      ...(Object.keys(clientData).length > 0
        ? { conversation_initiation_client_data: clientData }
        : {}),
    };
  }

  /**
   * La config de voz de la empresa, reducida a lo que el agente permite y a
   * una voz que exista en su cuenta. Lo que se deja fuera queda avisado en el
   * log; la llamada sale igual, con la config propia del agente.
   */
  private async allowedOverride(
    params: StartCallParams,
  ): Promise<Record<string, unknown> | undefined> {
    // Sin nada que cambiar no hace falta preguntarle nada al agente.
    const todo = buildElevenLabsOverride(params.overrides, {
      firstMessage: true,
      language: true,
      voiceId: true,
      speed: true,
    });
    if (!todo.override) {
      return undefined;
    }

    const permisos = await this.overridePermissions();
    let ov = params.overrides;
    const avisos: string[] = [];
    if (
      ov?.voiceId &&
      permisos.voiceId &&
      !(await this.voiceExists(ov.voiceId))
    ) {
      // Típico al pasar de Retell: queda elegida una voz "11labs-…" de allá.
      avisos.push(`la voz "${ov.voiceId}" no existe en esta cuenta`);
      ov = { ...ov, voiceId: undefined };
    }
    const { override, dropped } = buildElevenLabsOverride(ov, permisos);
    if (dropped.length > 0) {
      avisos.push(
        `el agente no permite cambiar ${dropped.join(', ')} (se habilita en ` +
          'su pestaña Security)',
      );
    }
    if (avisos.length > 0) {
      this.logger.warn(
        `Llamada con la config propia del agente en parte: ${avisos.join('; ')}.`,
      );
    }
    return override;
  }

  /** Permisos de override del agente (cacheados 5 min). */
  private async overridePermissions(): Promise<OverridePermissions> {
    const id = this.config.agentId;
    const cached = permisosPorAgente.get(id);
    if (cached && Date.now() - cached.at < PERMISOS_TTL_MS) {
      return cached.permisos;
    }
    try {
      const res = await fetch(
        `${ELEVENLABS_API}/v1/convai/agents/${encodeURIComponent(id)}`,
        { headers: { 'xi-api-key': this.config.apiKey } },
      );
      if (!res.ok) {
        throw new Error(`respondió ${res.status}`);
      }
      const permisos = readOverridePermissions(await res.json());
      permisosPorAgente.set(id, { at: Date.now(), permisos });
      return permisos;
    } catch (e) {
      // Sin saber qué permite, lo seguro es no mandar overrides: uno no
      // habilitado corta la conversación entera.
      this.logger.warn(
        `No se pudieron leer los permisos del agente ${id} ` +
          `(${(e as Error).message}): se llama con su config propia.`,
      );
      return SIN_PERMISOS;
    }
  }

  /**
   * ¿Existe la voz en la cuenta? Ante un error que no sea "no existe" se asume
   * que sí: no se descarta la voz de la empresa por una falla pasajera.
   */
  private async voiceExists(voiceId: string): Promise<boolean> {
    const key = `${this.config.agentId}:${voiceId}`;
    const cached = vozExiste.get(key);
    if (cached && Date.now() - cached.at < VOZ_TTL_MS) {
      return cached.existe;
    }
    try {
      const res = await fetch(
        `${ELEVENLABS_API}/v1/voices/${encodeURIComponent(voiceId)}`,
        { headers: { 'xi-api-key': this.config.apiKey } },
      );
      const existe = !(res.status === 400 || res.status === 404);
      vozExiste.set(key, { at: Date.now(), existe });
      return existe;
    } catch {
      return true;
    }
  }

  /** Endpoint de llamada según si el número es de Twilio o SIP trunk. */
  private async outboundPath(): Promise<string> {
    const id = this.config.phoneNumberId;
    let tipo = tipoDeNumero.get(id);
    if (!tipo) {
      const res = await fetch(
        `${ELEVENLABS_API}/v1/convai/phone-numbers/${encodeURIComponent(id)}`,
        { headers: { 'xi-api-key': this.config.apiKey } },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `Fallo al iniciar la llamada (ElevenLabs ${res.status} al leer el ` +
            `número ${id}): ${detail.slice(0, 200) || '(sin detalle)'}`,
        );
      }
      tipo = String(((await res.json()) as { provider?: string }).provider);
      tipoDeNumero.set(id, tipo);
    }
    const path = OUTBOUND_PATH[tipo];
    if (!path) {
      throw new Error(
        `Fallo al iniciar la llamada: el número ${id} de ElevenLabs es de tipo ` +
          `"${tipo}"; solo se puede llamar desde números Twilio o SIP trunk.`,
      );
    }
    return path;
  }

  private post(path: string, body: Record<string, unknown>) {
    return fetch(`${ELEVENLABS_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });
  }
}

/**
 * Idioma de la config de voz ('es-ES', 'es-419', 'multi', formato Retell) al
 * código que usa ElevenLabs ('es'). 'multi' no tiene equivalente: se omite y
 * el agente usa el suyo.
 */
export function toElevenLabsLanguage(language?: string): string | undefined {
  const base = language?.trim().toLowerCase().split(/[-_]/)[0];
  return base && /^[a-z]{2}$/.test(base) ? base : undefined;
}

/** Solo para tests: olvida números, permisos y voces ya consultados. */
export function resetElevenLabsCache(): void {
  tipoDeNumero.clear();
  permisosPorAgente.clear();
  vozExiste.clear();
}

/** Motivos de `call_initiation_failure`, para el historial del lead. */
const MOTIVO_FALLA: Record<string, string> = {
  busy: 'ocupado',
  'no-answer': 'no contestó',
};

/** Texto del historial para una llamada que no se llegó a conectar. */
export function describeCallFailure(reason?: string): string {
  const motivo = (reason && MOTIVO_FALLA[reason]) || 'motivo desconocido';
  return `La llamada no se conectó (${motivo}).`;
}

/**
 * Transcripción de ElevenLabs (lista de turnos) → texto del historial, con el
 * mismo formato de una línea por turno que traen Retell y Vapi. Los turnos sin
 * texto (llamadas a herramientas) se omiten.
 */
export function formatElevenLabsTranscript(turns: unknown): string | undefined {
  if (!Array.isArray(turns)) {
    return undefined;
  }
  const lineas = turns
    .map((t) => {
      const turn = (t ?? {}) as { role?: unknown; message?: unknown };
      const texto = typeof turn.message === 'string' ? turn.message.trim() : '';
      if (!texto) {
        return null;
      }
      return `${turn.role === 'agent' ? 'Agente' : 'Cliente'}: ${texto}`;
    })
    .filter((l): l is string => l !== null);
  return lineas.length > 0 ? lineas.join('\n') : undefined;
}
