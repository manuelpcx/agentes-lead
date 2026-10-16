/** Canal cuyo proveedor se vigila. */
export type AlertService = 'whatsapp' | 'email' | 'voice' | 'llm';
/** De quién es la cuenta: de una empresa o de la plataforma. */
export type AlertScope = 'company' | 'platform';

/** La cuenta por la que salió un envío. */
export interface HealthTarget {
  service: AlertService;
  /** 'ycloud' | 'meta' | 'resend' | 'smtp' | 'retell' | 'vapi' | 'elevenlabs' | 'anthropic' */
  provider: string;
  scope: AlertScope;
  /**
   * Empresa del envío: dueña de la cuenta si `scope` es 'company'; empresa
   * afectada si es 'platform' (puede faltar: procesos sin empresa).
   */
  companyId?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  ycloud: 'YCloud',
  meta: 'Meta',
  resend: 'Resend',
  smtp: 'SMTP',
  retell: 'Retell',
  vapi: 'Vapi',
  elevenlabs: 'ElevenLabs',
  anthropic: 'Anthropic',
};

/** Nombre del proveedor para mostrarlo a una persona. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Una clave por cuenta: empresa (o plataforma) + canal + proveedor. */
export function incidentKey(t: HealthTarget): string {
  return t.scope === 'company'
    ? `company:${t.companyId ?? 'sin-empresa'}:${t.service}:${t.provider}`
    : `platform:${t.service}:${t.provider}`;
}
