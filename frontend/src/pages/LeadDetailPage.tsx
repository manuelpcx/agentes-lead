import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useCurrentRole } from '../store/auth';
import { usePolling } from '../hooks/usePolling';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, Input, cn } from '../components/ui';
import type { Interaction, LeadDetail } from '../types';

type Author = 'cliente' | 'agente' | 'humano' | 'system';

function classify(i: Interaction): Author {
  if (i.channel === 'system') return 'system';
  if (i.direction === 'inbound') return 'cliente';
  return i.agentId ? 'agente' : 'humano';
}

const AUTHOR_LABEL: Record<Author, string> = {
  cliente: 'Cliente',
  agente: 'Agente',
  humano: 'Operador',
  system: 'Sistema',
};

function Bubble({ i }: { i: Interaction }) {
  const author = classify(i);
  if (author === 'system') {
    return (
      <div className="my-1 text-center text-xs italic text-slate-400">
        {i.content}
      </div>
    );
  }
  const alignRight = author !== 'cliente';
  const color =
    author === 'agente'
      ? 'bg-brand-600 text-white'
      : author === 'humano'
        ? 'bg-emerald-600 text-white'
        : 'bg-white text-slate-800 border border-slate-200';
  return (
    <div className={cn('flex', alignRight ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          color,
        )}
      >
        <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-70">
          {AUTHOR_LABEL[author]}
        </div>
        {i.content}
      </div>
    </div>
  );
}

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const canWrite = role === 'OWNER' || role === 'OPERADOR';

  const [nonce, setNonce] = useState(0);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const { data } = usePolling<LeadDetail>(
    () => api.get(`/panel/leads/${id}`).then((r) => r.data),
    4000,
    [id, nonce],
  );

  const reload = () => setNonce((n) => n + 1);

  const action = async (path: string) => {
    setBusy(true);
    try {
      await api.post(`/panel/leads/${id}/${path}`);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/panel/leads/${id}/reply`, { text: reply });
      setReply('');
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  }

  const { lead, interactions, agentActions } = data;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-4 md:flex-row md:p-6">
      {/* Hilo */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/60 p-0">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← Bandeja
          </button>
          <span className="font-medium text-slate-900">
            {lead.name ?? lead.phone ?? 'Lead'}
          </span>
          <StatusBadge status={lead.status} />
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto scrollbar-slim p-4">
          {interactions.map((i) => (
            <Bubble key={i.id} i={i} />
          ))}
        </div>

        {canWrite && (
          <form
            onSubmit={sendReply}
            className="flex gap-2 border-t border-slate-200 bg-white p-3"
          >
            <Input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={
                lead.isPausedForHuman
                  ? 'Escribe una respuesta…'
                  : 'Toma el control para responder'
              }
            />
            <Button type="submit" disabled={busy}>
              Enviar
            </Button>
          </form>
        )}
      </Card>

      {/* Panel lateral */}
      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-auto scrollbar-slim md:w-80">
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Lead</h3>
          <dl className="space-y-1 text-sm text-slate-600">
            <Row k="Teléfono" v={lead.phone} />
            <Row k="Email" v={lead.email} />
            <Row k="Origen" v={lead.source} />
            <Row k="Intentos" v={String(lead.contactAttempts)} />
            <Row k="Próx. acción" v={lead.nextActionType} />
          </dl>

          {canWrite && (
            <div className="mt-3">
              {lead.isPausedForHuman ? (
                <Button
                  onClick={() => action('release-control')}
                  disabled={busy}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  Devolver al agente
                </Button>
              ) : (
                <Button
                  onClick={() => action('take-control')}
                  disabled={busy}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                >
                  Tomar control
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            Acciones del agente
          </h3>
          {agentActions.length === 0 ? (
            <p className="text-xs text-slate-400">Sin acciones registradas.</p>
          ) : (
            <ul className="space-y-2">
              {agentActions.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs"
                >
                  <div className="flex items-center gap-1 font-mono font-semibold text-slate-700">
                    {a.tool}
                    {a.isError && <Badge tone="rose">error</Badge>}
                  </div>
                  <div className="mt-0.5 break-words text-slate-500">
                    in: {JSON.stringify(a.input)}
                  </div>
                  <div className="break-words text-slate-500">
                    out: {a.output}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{k}</dt>
      <dd className="truncate text-right">{v ?? '—'}</dd>
    </div>
  );
}
