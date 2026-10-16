import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { AlertService, PlatformIncidentRow } from '../types';
import { ChannelIcon } from './channels';
import { AgentsIcon } from './icons';
import { Badge, Card } from './ui';

function ServiceCell({ service }: { service: AlertService }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      {service === 'llm' ? (
        <AgentsIcon aria-hidden="true" className="h-4 w-4" />
      ) : (
        <ChannelIcon channel={service === 'voice' ? 'call' : service} className="h-4 w-4" />
      )}
      {t(`alerts.service.${service}`)}
    </span>
  );
}

/** Incidentes de proveedores de todas las empresas y de la plataforma. */
export function IncidentsCard() {
  const { t, i18n } = useTranslation();
  const { data, error } = usePolling<PlatformIncidentRow[]>(
    () => api.get<PlatformIncidentRow[]>('/platform/incidents').then((r) => r.data),
    30_000,
  );

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const duracion = (from: string, to: string) => {
    const min = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
    if (min < 60) return t('platform.incDurationMinutes', { count: min });
    const hours = Math.floor(min / 60);
    if (hours < 48) return t('platform.incDurationHours', { count: hours });
    return t('platform.incDurationDays', { count: Math.floor(hours / 24) });
  };

  return (
    <Card className="mt-6 overflow-x-auto p-0">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{t('platform.incidentsTitle')}</h2>
        <p className="text-xs text-slate-500">{t('platform.incidentsSubtitle')}</p>
      </div>
      {error && !data ? (
        <p className="px-4 py-6 text-sm text-rose-600">{t('platform.incidentsError')}</p>
      ) : !data ? (
        <p className="px-4 py-6 text-sm text-slate-500">{t('common.loading')}</p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{t('platform.incidentsEmpty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">{t('platform.incColStatus')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColService')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColAccount')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColReason')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColSince')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColDuration')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColFailures')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColAffected')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-4 py-2">
                  {r.resolvedAt ? (
                    <Badge tone="slate">{t('platform.incResolved')}</Badge>
                  ) : (
                    <Badge tone="rose">{t('platform.incOpen')}</Badge>
                  )}
                </td>
                <td className="px-4 py-2"><ServiceCell service={r.service} /></td>
                <td className="px-4 py-2 text-slate-700">
                  {r.companyName ?? t('platform.incAccountPlatform')}
                  <div className="text-xs text-slate-400">{r.providerLabel}</div>
                </td>
                <td className="min-w-[16rem] max-w-sm px-4 py-2 text-slate-700">
                  {r.reason}
                  {r.hint && <div className="text-xs text-slate-400">{r.hint}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fecha(r.openedAt)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                  {r.resolvedAt ? duracion(r.openedAt, r.resolvedAt) : t('platform.incOngoing')}
                </td>
                <td className="px-4 py-2 text-slate-600">{r.failureCount}</td>
                <td className="px-4 py-2 text-slate-600">
                  {r.scope === 'platform' ? r.affectedCompanies : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
