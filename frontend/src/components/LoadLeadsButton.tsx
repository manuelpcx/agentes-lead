import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { Badge, Button, Modal } from './ui';
import type { LeadSourceLoadResult, LeadSourcesView } from '../types';

/**
 * Botón "Cargar nuevos leads": consulta las APIs que la empresa configuró en
 * Integraciones y trae lo nuevo. Desactivado mientras no haya ninguna fuente.
 */
export function LoadLeadsButton({ onLoaded }: { onLoaded: () => void }) {
  const { t } = useTranslation();
  const companyId = useAuth((s) => s.selectedCompanyId);
  const [lista, setLista] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultados, setResultados] = useState<LeadSourceLoadResult[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<LeadSourcesView>('/panel/lead-sources')
      .then((r) => setLista(r.data.lista))
      .catch(() => setLista(false));
  }, [companyId]);

  const cargar = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ fuentes: LeadSourceLoadResult[] }>(
        '/panel/lead-sources/load',
      );
      setResultados(data.fuentes);
      onLoaded();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      setError(msg ?? t('leadSources.load.error'));
      setResultados([]);
    } finally {
      setBusy(false);
    }
  };

  const creados = (resultados ?? []).reduce(
    (n, r) => n + (r.resultado?.created ?? 0),
    0,
  );

  return (
    <>
      <span title={lista ? undefined : t('leadSources.load.disabledHint')}>
        <Button
          variant="secondary"
          onClick={cargar}
          disabled={!lista || busy}
        >
          {busy ? t('leadSources.load.loading') : t('leadSources.load.button')}
        </Button>
      </span>
      {resultados !== null && (
        <Modal
          title={t('leadSources.load.title')}
          onClose={() => setResultados(null)}
        >
          {error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                {t('leadSources.load.summary', { count: creados })}
              </p>
              <ul className="space-y-2">
                {resultados.map((r) => (
                  <li
                    key={r.nombre}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">
                        {r.nombre}
                      </span>
                      <Badge tone={r.ok ? 'green' : 'rose'}>
                        {r.ok ? t('leadSources.load.ok') : t('leadSources.load.failed')}
                      </Badge>
                    </div>
                    {r.ok ? (
                      <p className="mt-1 text-slate-600">
                        {t('leadSources.load.detail', {
                          recibidos: r.recibidos,
                          creados: r.resultado?.created ?? 0,
                          existentes: r.resultado?.skipped ?? 0,
                          errores: r.resultado?.failed ?? 0,
                        })}
                      </p>
                    ) : (
                      <p className="mt-1 text-rose-600">{r.error}</p>
                    )}
                    {(r.resultado?.errors ?? []).slice(0, 3).map((e) => (
                      <p key={e.row} className="mt-1 text-xs text-slate-500">
                        {t('leadSources.load.rowError', { row: e.row, reason: e.reason })}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">
                {t('leadSources.load.footer')}{' '}
                <Link to="/integrations" className="underline">
                  {t('leadSources.load.configure')}
                </Link>
              </p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
