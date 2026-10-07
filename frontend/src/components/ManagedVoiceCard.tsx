import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Badge, Card, cn } from './ui';

type Mode = 'byo' | 'managed' | 'none';

/** Lo que devuelve `GET /panel/voice/status`. */
interface VoiceStatus {
  mode: Mode;
  canCall: boolean;
  reason?: string;
  minutesUsed?: number;
  minutesLimit?: number;
  managedAvailable: boolean;
}

/**
 * Voz gestionada: los agentes llaman con la cuenta de voz de la plataforma
 * (nuestro número y nuestros agentes de voz), dentro de un tope mensual de
 * minutos. `advanced` es la tarjeta de siempre para conectar una cuenta propia.
 */
export function ManagedVoiceCard({
  advanced,
  refreshKey,
}: {
  advanced: ReactNode;
  /** Cambia cuando se guarda la cuenta propia: el modo puede cambiar. */
  refreshKey: number;
}) {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) =>
    t(`integrations.managedVoice.${key}`, opts);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    api
      .get<VoiceStatus>('/panel/voice/status')
      .then((r) => setStatus(r.data))
      .catch(() => setLoadError(true));
  };
  useEffect(load, [refreshKey]);

  const limit = status?.minutesLimit ?? 0;
  const used = status?.minutesUsed ?? 0;
  const incluida = status?.mode === 'managed' && limit > 0;
  const badge: { tone: 'green' | 'indigo' | 'slate'; label: string } | null =
    !status
      ? null
      : status.mode === 'byo'
        ? { tone: 'indigo', label: k('mode.byo') }
        : incluida
          ? { tone: 'green', label: k('mode.managed') }
          : { tone: 'slate', label: k('mode.none') };
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{k('title')}</h3>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <p className="mb-4 text-xs text-slate-500">{k('hint')}</p>

      {!status && !loadError && (
        <p className="text-sm text-slate-400">{t('common.loading')}</p>
      )}
      {loadError && (
        <p className="text-sm text-rose-600">
          {k('loadError')}{' '}
          <button type="button" onClick={load} className="font-medium underline">
            {t('common.retry')}
          </button>
        </p>
      )}

      {status && (
        <div className="space-y-4">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {status.mode === 'byo' && <p>{k('summary.byo')}</p>}
            {status.mode === 'none' && (
              <p>
                {k(status.managedAvailable ? 'summary.none' : 'summary.unavailable')}
              </p>
            )}
            {status.mode === 'managed' && limit === 0 && (
              <p>{k('summary.notIncluded')}</p>
            )}
            {incluida && (
              <>
                <p>{k('summary.minutes', { used, limit })}</p>
                <div
                  className="h-2 overflow-hidden rounded-full bg-slate-200"
                  role="progressbar"
                  aria-valuenow={used}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                >
                  <div
                    className={cn(
                      'h-full rounded-full',
                      pct >= 100
                        ? 'bg-rose-500'
                        : pct >= 80
                          ? 'bg-amber-500'
                          : 'bg-emerald-500',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {!status.canCall && status.reason && (
                  <p className="text-xs text-rose-600">{status.reason}</p>
                )}
                <p className="text-xs text-slate-500">{k('summary.noCallbacks')}</p>
              </>
            )}
          </div>

          <details className="rounded-xl border border-slate-200 p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {k('advanced.title')}
            </summary>
            <p className="mb-4 mt-2 text-xs text-slate-500">{k('advanced.hint')}</p>
            {advanced}
          </details>
        </div>
      )}
    </Card>
  );
}
