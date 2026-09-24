import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

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

function CopyValue({ value }: { value: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const codeRef = useRef<HTMLElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1500);
    } catch {
      // Sin permiso de portapapeles (navegador o política de la empresa): se
      // deja el texto seleccionado para que baste con Ctrl+C.
      const el = codeRef.current;
      const selection = window.getSelection();
      if (el && selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setState('manual');
    }
  };
  return (
    <div className="mt-1">
      <div className="flex items-start gap-2">
        <code
          ref={codeRef}
          className="min-w-0 flex-1 break-all rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-700"
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 py-1 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          {state === 'copied'
            ? t('integrations.webhook.copied')
            : t('integrations.webhook.copy')}
        </button>
      </div>
      {state === 'manual' && (
        <p className="mt-1 text-xs text-slate-500">
          {t('integrations.webhook.copyManual')}
        </p>
      )}
    </div>
  );
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
