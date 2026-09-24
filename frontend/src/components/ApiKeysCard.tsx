import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useCurrentRole } from '../store/auth';
import { Badge, Button, Card, Field, Input, Select, cn } from './ui';
import type { ApiKeySummary, CreatedApiKey } from '../types';

/** Base de la API, la misma que usa el cliente axios del panel. */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Roles que se pueden dar a una llave. OWNER no: una llave no administra. */
const ROLES = ['SOLO_LECTURA', 'OPERADOR'] as const;

function estado(k: ApiKeySummary): { tone: 'green' | 'slate' | 'rose'; key: string } {
  if (k.revokedAt) return { tone: 'rose', key: 'revoked' };
  if (k.expiresAt && new Date(k.expiresAt) <= new Date()) {
    return { tone: 'slate', key: 'expired' };
  }
  return { tone: 'green', key: 'active' };
}

/**
 * Llaves de API de la empresa: las que usa el servidor MCP para entrar sin un
 * usuario humano delante. La llave en claro se ve UNA vez, al crearla — el
 * backend solo guarda su hash.
 */
export function ApiKeysCard() {
  const { t, i18n } = useTranslation();
  const role = useCurrentRole();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [name, setName] = useState('');
  const [keyRole, setKeyRole] = useState<string>('SOLO_LECTURA');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .get('/panel/api-keys')
      .then((r) => setKeys(r.data))
      .catch(() => setKeys([]));
  };
  useEffect(load, []);

  // Solo OWNER: una llave es acceso permanente a los datos de la empresa.
  if (role !== 'OWNER') return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<CreatedApiKey>('/panel/api-keys', {
        name: name.trim(),
        role: keyRole,
      });
      setCreated(data);
      setCopied(false);
      setName('');
      load();
    } catch {
      setError(t('integrations.apiKeys.createError'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm(t('integrations.apiKeys.confirmRevoke'))) return;
    await api.delete(`/panel/api-keys/${id}`);
    load();
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      // El portapapeles puede estar bloqueado; la llave igual está a la vista.
      setCopied(false);
    }
  };

  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '—';

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-900">
        {t('integrations.apiKeys.title')}
      </h2>
      <p className="mb-1 mt-0.5 text-xs text-slate-500">
        {t('integrations.apiKeys.subtitle')}
      </p>
      <Link
        to="/help"
        className="mb-4 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        {t('integrations.apiKeys.guide')} →
      </Link>

      {created && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
          <p className="text-xs font-medium text-emerald-800">
            {t('integrations.apiKeys.createdTitle', { name: created.name })}
          </p>
          <p className="mb-2 text-xs text-emerald-700">
            {t('integrations.apiKeys.createdOnce')}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-emerald-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-800">
              {created.key}
            </code>
            <Button size="sm" onClick={copy}>
              {copied
                ? t('integrations.apiKeys.copied')
                : t('integrations.apiKeys.copy')}
            </Button>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-emerald-800">
              {t('integrations.apiKeys.showConfig')}
            </summary>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(
                {
                  mcpServers: {
                    'agentes-lead': {
                      command: 'node',
                      args: ['/ruta/a/agentes-lead/mcp/server.mjs'],
                      env: {
                        // La misma base que usa el panel. Derivarla de
                        // `window.location` daría la URL del frontend, que en
                        // producción (Vercel + Railway) no es la de la API.
                        AGENTES_LEAD_URL: API_URL,
                        AGENTES_LEAD_API_KEY: created.key,
                      },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
          </details>
          <button
            onClick={() => setCreated(null)}
            className="mt-2 text-xs text-emerald-700 underline"
          >
            {t('integrations.apiKeys.hideKey')}
          </button>
        </div>
      )}

      <form onSubmit={submit} className="mb-4 grid gap-3 sm:grid-cols-[1fr,auto,auto] sm:items-end">
        <Field label={t('integrations.apiKeys.name')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('integrations.apiKeys.namePlaceholder')}
          />
        </Field>
        <Field label={t('integrations.apiKeys.permissions')}>
          <Select value={keyRole} onChange={(e) => setKeyRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`integrations.apiKeys.roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy
            ? t('integrations.apiKeys.creating')
            : t('integrations.apiKeys.create')}
        </Button>
      </form>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      {keys.length === 0 ? (
        <p className="text-xs text-slate-400">{t('integrations.apiKeys.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {keys.map((k) => {
            const e = estado(k);
            return (
              <li
                key={k.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {k.name}
                    </span>
                    <code className="font-mono text-xs text-slate-400">
                      {k.prefix}…
                    </code>
                    <Badge tone={e.tone}>
                      {t(`integrations.apiKeys.states.${e.key}`)}
                    </Badge>
                    <Badge tone="slate">
                      {t(`integrations.apiKeys.roles.${k.role}`)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {t('integrations.apiKeys.lastUsed')}: {fecha(k.lastUsedAt)}
                  </p>
                </div>
                {!k.revokedAt && (
                  <button
                    onClick={() => revoke(k.id)}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs font-medium text-rose-600',
                      'transition hover:bg-rose-50',
                    )}
                  >
                    {t('integrations.apiKeys.revoke')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
