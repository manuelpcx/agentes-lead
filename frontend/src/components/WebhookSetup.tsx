import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CopyValue } from './CopyValue';

/** URLs de webhook que devuelve `GET /panel/integrations/webhooks`. */
export interface WebhookInfo {
  baseUrl: string;
  /** La URL es de un servidor local: ningún proveedor externo llega a ella. */
  local: boolean;
  whatsapp: {
    ycloud: { url: string; events: string[] };
    meta: { url: string; verifyToken: string | null; fields: string[] };
  };
  voice: {
    retell: { url: string; events: string[] };
    vapi: { url: string; events: string[] };
    elevenlabs: { url: string; events: string[]; variables: string[] };
  };
}

interface Step {
  text: string;
  /** Valor que el cliente tiene que pegar en el proveedor (con botón copiar). */
  copy?: string;
  /** Nombre técnico que tiene que elegir tal cual (evento, campo). */
  code?: string;
  warn?: boolean;
}

/** Pasos para conectar el webhook del proveedor elegido; null si no aplica. */
function stepsFor(
  channel: string,
  provider: string,
  info: WebhookInfo,
  t: TFunction,
): Step[] | null {
  const k = (key: string) => t(`integrations.webhook.${provider}.${key}`);
  if (channel === 'whatsapp' && provider === 'ycloud') {
    return [
      { text: k('url'), copy: info.whatsapp.ycloud.url },
      { text: k('event'), code: info.whatsapp.ycloud.events.join(', ') },
      { text: k('secret') },
      { text: k('number') },
    ];
  }
  if (channel === 'whatsapp' && provider === 'meta') {
    const token = info.whatsapp.meta.verifyToken;
    return [
      { text: k('url'), copy: info.whatsapp.meta.url },
      token
        ? { text: k('token'), copy: token }
        : { text: k('tokenMissing'), warn: true },
      { text: k('field'), code: info.whatsapp.meta.fields.join(', ') },
      { text: k('secret') },
    ];
  }
  if (channel === 'voice' && provider === 'retell') {
    return [
      { text: k('url'), copy: info.voice.retell.url },
      { text: k('event'), code: info.voice.retell.events.join(', ') },
      { text: k('secret') },
    ];
  }
  if (channel === 'voice' && provider === 'elevenlabs') {
    const el = info.voice.elevenlabs;
    return [
      { text: k('url'), copy: el.url },
      { text: k('event'), code: el.events.join(', ') },
      { text: k('secret') },
      {
        text: k('variables'),
        code: el.variables.map((v) => `{{${v}}}`).join(' '),
      },
      { text: k('overrides') },
    ];
  }
  if (channel === 'voice' && provider === 'vapi') {
    return [
      { text: k('url'), copy: info.voice.vapi.url },
      { text: k('event'), code: info.voice.vapi.events.join(', ') },
      { text: k('secret') },
    ];
  }
  return null;
}

/**
 * Cómo conectar el webhook del proveedor: la URL de este backend lista para
 * copiar y los pasos en el panel del proveedor. Sin esto, el cliente no tiene
 * cómo saber qué ruta usar.
 */
export function WebhookSetup({
  channel,
  provider,
  providerLabel,
  info,
}: {
  channel: string;
  provider: string;
  providerLabel: string;
  info: WebhookInfo;
}) {
  const { t } = useTranslation();
  const steps = stepsFor(channel, provider, info, t);
  if (!steps) {
    return null;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold text-slate-700">
        {t('integrations.webhook.title')}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {t(`integrations.webhook.intro.${channel}`, { provider: providerLabel })}
      </p>
      {info.local && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-700">
          {t('integrations.webhook.local', { provider: providerLabel })}
        </p>
      )}
      <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs text-slate-600">
        {steps.map((s, i) => (
          <li key={i}>
            <span className={s.warn ? 'text-amber-700' : undefined}>
              {s.text}
            </span>
            {s.copy && <CopyValue value={s.copy} />}
            {s.code && (
              <code className="ml-1 rounded bg-white px-1 py-0.5 font-mono text-slate-700">
                {s.code}
              </code>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
