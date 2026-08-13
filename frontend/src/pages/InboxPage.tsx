import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { usePolling } from '../hooks/usePolling';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, PageHeader, Select } from '../components/ui';
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
  const navigate = useNavigate();
  const companyId = useAuth((s) => s.selectedCompanyId);
  const [status, setStatus] = useState<LeadStatus | ''>('');

  const { data: leads, error } = usePolling<LeadListItem[]>(
    () =>
      api
        .get('/panel/leads', { params: status ? { status } : {} })
        .then((r) => r.data),
    4000,
    [companyId, status],
  );

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col p-4 md:p-6">
      <PageHeader
        title="Bandeja de conversaciones"
        subtitle="Cada lead y su último mensaje, en vivo."
        actions={
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus | '')}
            className="w-auto"
          >
            {ESTADOS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'Todos los estados' : s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        }
      />

      {error && (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto scrollbar-slim pr-1">
        {leads?.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
            No hay leads todavía. Llegarán aquí apenas entren por el webhook.
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
                  {lead.name ?? lead.phone ?? 'Sin nombre'}
                </span>
                <StatusBadge status={lead.status} />
                {lead.isPausedForHuman && (
                  <Badge tone="orange">control humano</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {lead.lastMessage
                  ? `${lead.lastMessage.direction === 'inbound' ? '←' : '→'} ${lead.lastMessage.content}`
                  : 'Sin mensajes'}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">{lead.phone}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
