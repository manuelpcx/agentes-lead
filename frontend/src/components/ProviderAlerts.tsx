import { useEffect, useRef, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { AlertService, PanelAlerts } from '../types';
import { ChannelIcon } from './channels';
import { AgentsIcon } from './icons';
import { cn } from './ui';

/** Ícono del canal; la IA usa el del robot (agentes). */
function ServiceIcon({ service }: { service: AlertService }) {
  if (service === 'llm') {
    return <AgentsIcon aria-hidden="true" className="h-4 w-4 shrink-0" />;
  }
  return (
    <ChannelIcon
      channel={service === 'voice' ? 'call' : service}
      className="h-4 w-4"
    />
  );
}

/** "Desde hace 5 minutos / 2 horas / 3 días". */
function useSince() {
  const { t } = useTranslation();
  return (iso: string) => {
    const min = Math.max(
      1,
      Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
    );
    if (min < 60) return t('alerts.sinceMinutes', { count: min });
    const hours = Math.floor(min / 60);
    if (hours < 48) return t('alerts.sinceHours', { count: hours });
    return t('alerts.sinceDays', { count: Math.floor(hours / 24) });
  };
}

/**
 * Avisos de proveedores caídos, sobre todas las páginas. Rojo si la cuenta es
 * de la empresa (o si quien mira es administrador); ámbar, sin detalles, si
 * el problema es de la plataforma. Se cierran solos cuando el proveedor
 * vuelve a funcionar. Si la consulta falla (por ejemplo, un backend todavía
 * sin este endpoint), no muestra nada: un aviso no debe tapar el panel.
 *
 * Lectores de pantalla: las tarjetas no son regiones vivas (su "Desde hace…"
 * cambia cada minuto y se volvería a leer sin parar). Cada aviso NUEVO se
 * anuncia una sola vez en una región oculta que queda siempre montada.
 */
export function ProviderAlerts({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const since = useSince();
  const { data } = usePolling<PanelAlerts>(
    () => api.get<PanelAlerts>('/panel/alerts').then((r) => r.data),
    60_000,
    [companyId],
  );

  const anunciados = useRef(new Set<string>());
  const [anuncio, setAnuncio] = useState('');
  useEffect(() => {
    if (!data) return;
    const nuevos = [
      ...data.own.map((a) => ({
        id: a.id,
        texto: t(`alerts.problem.${a.service}`),
      })),
      ...data.platform.map((a) => ({
        id: a.id,
        texto: a.reason
          ? t(`alerts.problem.${a.service}`)
          : t(`alerts.platformProblem.${a.service}`),
      })),
    ].filter((a) => !anunciados.current.has(a.id));
    if (nuevos.length === 0) return;
    nuevos.forEach((a) => anunciados.current.add(a.id));
    setAnuncio(nuevos.map((a) => a.texto).join('. '));
  }, [data, t]);

  // Siempre montada (aunque no haya avisos): una región viva que aparece ya
  // con texto no se anuncia de forma confiable.
  const region = (
    <p className="sr-only" aria-live="assertive">
      {anuncio}
    </p>
  );

  if (!data || (data.own.length === 0 && data.platform.length === 0)) {
    // Fragmento también acá: así React conserva la misma región al pasar a
    // mostrar avisos, en vez de montarla de nuevo.
    return <>{region}</>;
  }

  const rojos = [
    ...data.own.map((a) => ({ ...a, platform: false })),
    ...data.platform
      .filter((a) => a.reason)
      .map((a) => ({ ...a, platform: true })),
  ];
  const ambar = data.platform.filter((a) => !a.reason);

  return (
    <>
      {region}
      <div className="space-y-2 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
        {rojos.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            <WarningCircle
              weight="fill"
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-rose-500"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                <span className="mr-1.5 inline-block align-[-2px]">
                  <ServiceIcon service={a.service} />
                </span>
                {t(`alerts.problem.${a.service}`)}
                {a.platform && (
                  <span className="ml-1.5 inline-block rounded-full bg-rose-100 px-2 py-0.5 align-middle text-[11px] font-medium">
                    {t('alerts.platformTag')}
                  </span>
                )}
              </p>
              <p className="mt-0.5">
                {a.providerLabel}: {a.reason}
                {a.hint ? ` ${a.hint}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-rose-600">
                {since(a.openedAt)}
                {a.failureCount !== undefined &&
                  ` · ${t('alerts.failures', { count: a.failureCount })}`}
              </p>
            </div>
            <Link
              to={a.platform ? '/platform' : '/integrations'}
              className="basis-full whitespace-nowrap rounded-lg py-1 pl-8 text-xs font-medium text-rose-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 sm:basis-auto sm:self-center sm:px-2"
            >
              {a.platform ? t('alerts.goPlatform') : t('alerts.goIntegrations')}
            </Link>
          </div>
        ))}
        {ambar.map((a) => (
          <div
            key={a.id}
            className={cn(
              'flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800',
            )}
          >
            <ServiceIcon service={a.service} />
            <p>{t(`alerts.platformProblem.${a.service}`)}</p>
          </div>
        ))}
      </div>
    </>
  );
}
