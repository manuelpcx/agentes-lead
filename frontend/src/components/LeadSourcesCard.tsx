import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useCurrentRole } from '../store/auth';
import { Button, Card, Field, Input } from './ui';
import type { LeadSource, LeadSourcesView } from '../types';

/** Una fila editable: nombre + URL. */
interface Fila {
  nombre: string;
  url: string;
  ultimaCarga?: string;
}

/**
 * Fuentes de leads por API: las URLs del sistema del cliente desde donde el
 * botón "Cargar nuevos leads" de la bandeja trae leads. El token se guarda
 * cifrado y nunca vuelve al panel.
 */
export function LeadSourcesCard() {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [token, setToken] = useState('');
  const [tokenConfigurado, setTokenConfigurado] = useState(false);
  const [parametro, setParametro] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const aplicar = (v: LeadSourcesView) => {
    setFilas(v.fuentes.map((f: LeadSource) => ({ ...f })));
    setTokenConfigurado(v.tokenConfigurado);
    setParametro(v.parametroFecha ?? '');
  };

  useEffect(() => {
    api
      .get<LeadSourcesView>('/panel/lead-sources')
      .then((r) => aplicar(r.data))
      .catch(() => setFilas([]));
  }, []);

  // Solo OWNER: son URLs y un token de un sistema externo.
  if (role !== 'OWNER') return null;

  const editar = (i: number, campo: 'nombre' | 'url', valor: string) => {
    setSaved(false);
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { data } = await api.put<LeadSourcesView>('/panel/lead-sources', {
        fuentes: filas
          .filter((f) => f.nombre.trim() || f.url.trim())
          .map((f) => ({ nombre: f.nombre.trim(), url: f.url.trim() })),
        ...(token.trim() ? { token: token.trim() } : {}),
        parametroFecha: parametro.trim() || null,
      });
      aplicar(data);
      setToken('');
      setSaved(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })
        .response?.data?.message;
      setError(
        Array.isArray(msg) ? msg.join(' ') : (msg ?? t('leadSources.config.saveError')),
      );
    } finally {
      setBusy(false);
    }
  };

  const fecha = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : t('leadSources.config.never');

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-900">
        {t('leadSources.config.title')}
      </h2>
      <p className="mb-4 mt-0.5 text-xs text-slate-500">
        {t('leadSources.config.subtitle')}
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          {filas.length === 0 && (
            <p className="text-xs text-slate-500">{t('leadSources.config.empty')}</p>
          )}
          {filas.map((f, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <Field label={t('leadSources.config.name')}>
                  <Input
                    value={f.nombre}
                    onChange={(e) => editar(i, 'nombre', e.target.value)}
                    placeholder={t('leadSources.config.namePlaceholder')}
                    maxLength={60}
                  />
                </Field>
                <Field label={t('leadSources.config.url')}>
                  <Input
                    value={f.url}
                    onChange={(e) => editar(i, 'url', e.target.value)}
                    placeholder="https://api.tuempresa.cl/leads"
                    inputMode="url"
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSaved(false);
                    setFilas((fs) => fs.filter((_, j) => j !== i));
                  }}
                >
                  {t('leadSources.config.remove')}
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t('leadSources.config.lastLoad', { fecha: fecha(f.ultimaCarga) })}
              </p>
            </div>
          ))}
          {filas.length < 10 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFilas((fs) => [...fs, { nombre: '', url: '' }])}
            >
              {t('leadSources.config.add')}
            </Button>
          )}
        </div>

        <Field
          label={t('leadSources.config.token')}
          hint={
            tokenConfigurado
              ? t('leadSources.config.tokenSaved')
              : t('leadSources.config.tokenHint')
          }
        >
          <Input
            type="password"
            value={token}
            onChange={(e) => {
              setSaved(false);
              setToken(e.target.value);
            }}
            autoComplete="off"
            placeholder={tokenConfigurado ? '••••••••' : ''}
          />
        </Field>

        <Field
          label={t('leadSources.config.dateParam')}
          hint={t('leadSources.config.dateParamHint')}
        >
          <Input
            value={parametro}
            onChange={(e) => {
              setSaved(false);
              setParametro(e.target.value);
            }}
            placeholder="desde"
            maxLength={40}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? t('leadSources.config.saving') : t('leadSources.config.save')}
          </Button>
          {saved && (
            <span className="text-xs text-emerald-700">
              {t('leadSources.config.saved')}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
