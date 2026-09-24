import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { usePolling } from '../hooks/usePolling';
import { StatusBadge } from '../components/StatusBadge';
import { QualificationBadge } from '../components/QualificationBadge';
import { LeadFormModal } from '../components/LeadFormModal';
import { ImportLeadsModal } from '../components/ImportLeadsModal';
import { Badge, Button, Input, PageHeader, Select } from '../components/ui';
import type { LeadListItem, LeadStatus } from '../types';

const ESTADOS: (LeadStatus | '')[] = [
  '',
  'NUEVO',
  'CONTACTADO',
  'EN_CONVERSACION',
  'AGENDADO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
  'ESCALADO_HUMANO',
];

export function InboxPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useAuth((s) => s.selectedCompanyId);
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Debounce: la bandeja hace polling cada 4s, no hace falta pedir en cada tecla.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data: leads, error } = usePolling<LeadListItem[]>(
    () =>
      api
        .get('/panel/leads', {
          params: {
            ...(status ? { status } : {}),
            ...(query ? { q: query } : {}),
          },
        })
        .then((r) => r.data),
    4000,
    [companyId, status, query, nonce],
  );

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col p-4 md:p-6">
      <PageHeader
        title={t('inbox.title')}
        subtitle={t('inbox.subtitle')}
        actions={
          <>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus | '')}
              className="w-auto"
            >
              {ESTADOS.map((s) => (
                <option key={s} value={s}>
                  {s === '' ? t('leadStatus.allStatuses') : t(`leadStatus.${s}`)}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              {t('inbox.importLeads')}
            </Button>
            <Button onClick={() => setCreating(true)}>
              {t('inbox.newLead')}
            </Button>
          </>
        }
      />

      <div className="relative mb-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('inbox.searchPlaceholder')}
          className="pr-9"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label={t('inbox.clearSearch')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto scrollbar-slim pr-1">
        {leads?.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
            {query ? t('inbox.noResults', { q: query }) : t('inbox.empty')}
          </div>
        )}
        {leads?.map((lead) => (
          <button
            key={lead.id}
            onClick={() => navigate(`/leads/${lead.id}`)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-card transition hover:border-brand-200 hover:shadow-soft"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">
                  {lead.name ?? lead.phone ?? t('inbox.noName')}
                </span>
                <StatusBadge status={lead.status} />
                <QualificationBadge qualification={lead.qualification} />
                {lead.isPausedForHuman && (
                  <Badge tone="orange">{t('inbox.humanControl')}</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {lead.lastMessage
                  ? `${lead.lastMessage.direction === 'inbound' ? '←' : '→'} ${lead.lastMessage.content}`
                  : t('inbox.noMessages')}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">{lead.phone}</span>
          </button>
        ))}
      </div>

      {creating && (
        <LeadFormModal
          onClose={() => setCreating(false)}
          onSaved={() => setNonce((n) => n + 1)}
        />
      )}

      {importing && (
        <ImportLeadsModal
          onClose={() => setImporting(false)}
          onImported={() => setNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}
