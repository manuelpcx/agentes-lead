import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Un valor para pegar en otro sistema (URL de webhook, registro DNS) con su
 * botón de copiar. Si el navegador no deja usar el portapapeles, lo deja
 * seleccionado para que baste con Ctrl+C.
 */
export function CopyValue({ value }: { value: string }) {
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
