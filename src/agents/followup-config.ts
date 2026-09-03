import { FollowUpChannel, parseLadder } from '../followup/channel-ladder';

/** Momento del contacto al que aplica una plantilla. */
export type TemplatePurpose = 'opening' | 'followup' | 'reactivation';

/** Referencia a una plantilla de WhatsApp aprobada. */
export interface AgentTemplateRef {
  name: string;
  language: string;
}

/** Config de seguimiento cruda guardada en `Agent.followupConfig`. */
export interface AgentFollowupConfig {
  channelLadder?: string[];
  delaysHours?: number[];
  maxAttempts?: number;
  firstContactDelayMin?: number;
  templates?: Partial<Record<TemplatePurpose, AgentTemplateRef>>;
}

/** Defaults globales (de env) usados como fallback de lo no configurado. */
export interface FollowupDefaults {
  ladder: FollowUpChannel[];
  delaysHours: number[];
  baseDelayHours: number;
  maxAttempts: number;
  template: AgentTemplateRef; // global; `name` puede venir vacío
}

/** Config efectiva ya resuelta (agente sobre defaults). */
export interface EffectiveFollowup {
  ladder: FollowUpChannel[];
  delaysHours: number[];
  baseDelayHours: number;
  maxAttempts: number;
  templates: Partial<Record<TemplatePurpose, AgentTemplateRef>>;
  firstContactDelayMin?: number;
}

const PURPOSES: TemplatePurpose[] = ['opening', 'followup', 'reactivation'];

function templateRef(v: unknown): AgentTemplateRef | undefined {
  if (!v || typeof v !== 'object') {
    return undefined;
  }
  const o = v as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) {
    return undefined;
  }
  const language =
    typeof o.language === 'string' && o.language.trim()
      ? o.language.trim()
      : 'es';
  return { name, language };
}

/** Lee y sanea `Agent.followupConfig` (tolerante a basura). */
export function parseAgentFollowupConfig(json: unknown): AgentFollowupConfig {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return {};
  }
  const o = json as Record<string, unknown>;
  const out: AgentFollowupConfig = {};

  if (Array.isArray(o.channelLadder)) {
    const ladder = o.channelLadder.filter(
      (x): x is string => typeof x === 'string',
    );
    if (ladder.length > 0) {
      out.channelLadder = ladder;
    }
  }
  if (Array.isArray(o.delaysHours)) {
    const delays = o.delaysHours
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (delays.length > 0) {
      out.delaysHours = delays;
    }
  }
  const ma = Number(o.maxAttempts);
  if (Number.isFinite(ma) && ma > 0) {
    out.maxAttempts = Math.floor(ma);
  }
  const fc = Number(o.firstContactDelayMin);
  if (Number.isFinite(fc) && fc >= 0) {
    out.firstContactDelayMin = Math.floor(fc);
  }
  if (o.templates && typeof o.templates === 'object') {
    const t = o.templates as Record<string, unknown>;
    const templates: Partial<Record<TemplatePurpose, AgentTemplateRef>> = {};
    for (const p of PURPOSES) {
      const ref = templateRef(t[p]);
      if (ref) {
        templates[p] = ref;
      }
    }
    if (Object.keys(templates).length > 0) {
      out.templates = templates;
    }
  }
  return out;
}

/** Combina la config del agente con los defaults globales. */
export function resolveEffectiveFollowup(
  cfg: AgentFollowupConfig,
  defaults: FollowupDefaults,
): EffectiveFollowup {
  const ladder =
    cfg.channelLadder && cfg.channelLadder.length > 0
      ? parseLadder(cfg.channelLadder.join(','))
      : defaults.ladder;
  const delaysHours =
    cfg.delaysHours && cfg.delaysHours.length > 0
      ? cfg.delaysHours
      : defaults.delaysHours;
  const templates: Partial<Record<TemplatePurpose, AgentTemplateRef>> = {
    ...(cfg.templates ?? {}),
  };
  // Si no hay plantilla de apertura, cae a la global (si tiene nombre).
  if (!templates.opening && defaults.template.name) {
    templates.opening = defaults.template;
  }
  return {
    ladder,
    delaysHours,
    baseDelayHours: defaults.baseDelayHours,
    maxAttempts: cfg.maxAttempts ?? defaults.maxAttempts,
    templates,
    firstContactDelayMin: cfg.firstContactDelayMin,
  };
}

/** Elige la plantilla del propósito, con fallback a la de apertura. */
export function pickTemplate(
  eff: EffectiveFollowup,
  purpose: TemplatePurpose,
): AgentTemplateRef | undefined {
  return eff.templates[purpose] ?? eff.templates.opening;
}
