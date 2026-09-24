import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useCurrentRole } from '../store/auth';
import { usePolling } from '../hooks/usePolling';
import { StatusBadge } from '../components/StatusBadge';
import { QualificationBadge } from '../components/QualificationBadge';
import { LeadFormModal } from '../components/LeadFormModal';
import { LeadMemoryCard } from '../components/LeadMemoryCard';
import { Badge, Button, Card, Input, Textarea, cn } from '../components/ui';
import type { Interaction, LeadDetail } from '../types';

type Author = 'cliente' | 'agente' | 'humano' | 'system';

function classify(i: Interaction): Author {
  if (i.channel === 'system') return 'system';
  if (i.direction === 'inbound') return 'cliente';
  return i.agentId ? 'agente' : 'humano';
}

function Bubble({ i }: { i: Interaction }) {
  const { t } = useTranslation();
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
          {t(`leadDetail.author.${author}`)}
        </div>
        {i.content}
      </div>
    </div>
  );
}

export function LeadDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const canWrite = role === 'OWNER' || role === 'OPERADOR';

  const [nonce, setNonce] = useState(0);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');

  const { data } = usePolling<LeadDetail>(
    () => api.get(`/panel/leads/${id}`).then((r) => r.data),
    4000,
    [id, nonce],
  );

  // El hilo abre en el último mensaje, como cualquier chat. `pegadoAbajo`
  // evita dar el salto si la persona subió a leer historial: el polling de 4s
  // la estaría devolviendo al final cada vez.
  const threadRef = useRef<HTMLDivElement>(null);
  const pegadoAbajo = useRef(true);
  const totalMensajes = data?.interactions.length ?? 0;

  useEffect(() => {
    const el = threadRef.current;
    if (el && pegadoAbajo.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [totalMensajes, id]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    pegadoAbajo.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

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

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/panel/leads/${id}/notes`, { body: note.trim() });
      setNote('');
      reload();
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!confirm(t('leadDetail.confirmDeleteNote'))) return;
    await api.delete(`/panel/notes/${noteId}`);
    reload();
  };

  if (!data) {
    return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;
  }

  const { lead, interactions, agentActions, appointments, notes, memory } =
    data;
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-4 md:flex-row md:p-6">
      {/* Hilo */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/60 p-0">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            onClick={() => navigate('/leads')}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            {t('leadDetail.backToInbox')}
          </button>
          <span className="font-medium text-slate-900">
            {lead.name ?? lead.phone ?? t('leadDetail.defaultLeadLabel')}
          </span>
          <StatusBadge status={lead.status} />
          <QualificationBadge qualification={lead.qualification} />
        </div>

        <div
          ref={threadRef}
          onScroll={onThreadScroll}
          className="min-h-0 flex-1 space-y-2 overflow-auto scrollbar-slim p-4"
        >
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
                  ? t('leadDetail.replyPlaceholderActive')
                  : t('leadDetail.replyPlaceholderInactive')
              }
            />
            <Button type="submit" disabled={busy}>
              {t('leadDetail.send')}
            </Button>
          </form>
        )}
      </Card>

      {/* Panel lateral */}
      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-auto scrollbar-slim md:w-80">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              {t('leadDetail.sidebarTitle')}
            </h3>
            {canWrite && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {t('leadDetail.editLead')}
              </button>
            )}
          </div>
          <dl className="space-y-1 text-sm text-slate-600">
            <Row k={t('leadDetail.phone')} v={lead.phone} />
            <Row k={t('leadDetail.email')} v={lead.email} />
            <Row k={t('leadDetail.source')} v={lead.source} />
            <Row k={t('leadDetail.qualificationReason')} v={lead.qualificationReason} />
            <Row k={t('leadDetail.attempts')} v={String(lead.contactAttempts)} />
            <Row k={t('leadDetail.nextAction')} v={lead.nextActionType} />
          </dl>

          {canWrite && (
            <div className="mt-3">
              {lead.isPausedForHuman ? (
                <Button
                  onClick={() => action('release-control')}
                  disabled={busy}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  {t('leadDetail.returnToAgent')}
                </Button>
              ) : (
                <Button
                  onClick={() => action('take-control')}
                  disabled={busy}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                >
                  {t('leadDetail.takeControl')}
                </Button>
              )}
            </div>
          )}
        </Card>

        {/* Citas del lead */}
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            {t('leadDetail.appointmentsTitle')}
          </h3>
          {appointments.length === 0 ? (
            <p className="text-xs text-slate-400">
              {t('leadDetail.noAppointments')}
            </p>
          ) : (
            <ul className="space-y-2">
              {appointments.map((appt) => (
                <li
                  key={appt.id}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">
                      {appt.title}
                    </span>
                    <Badge
                      tone={
                        appt.status === 'CANCELADA'
                          ? 'rose'
                          : appt.status === 'CONFIRMADA'
                            ? 'green'
                            : 'slate'
                      }
                    >
                      {t(`calendar.statuses.${appt.status}`)}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    {dateTime(appt.startAt)}
                  </div>
                  {appt.location && (
                    <div className="text-slate-400">{appt.location}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <LeadMemoryCard
          leadId={lead.id}
          memory={memory}
          canWrite={canWrite}
          onSaved={reload}
        />

        {/* Notas internas */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {t('leadDetail.notesTitle')}
          </h3>
          <p className="mb-2 text-xs text-slate-400">{t('leadDetail.notesHint')}</p>

          {canWrite && (
            <form onSubmit={addNote} className="mb-3 space-y-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('leadDetail.notePlaceholder')}
                className="h-16 text-xs"
              />
              <Button size="sm" type="submit" disabled={busy || !note.trim()}>
                {t('leadDetail.addNote')}
              </Button>
            </form>
          )}

          {notes.length === 0 ? (
            <p className="text-xs text-slate-400">{t('leadDetail.noNotes')}</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border border-slate-100 bg-amber-50/60 p-2 text-xs"
                >
                  <p className="whitespace-pre-wrap text-slate-700">{n.body}</p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>
                      {n.authorName ? `${n.authorName} · ` : ''}
                      {dateTime(n.createdAt)}
                    </span>
                    {canWrite && (
                      <button
                        onClick={() => deleteNote(n.id)}
                        className="text-rose-500 hover:text-rose-600"
                      >
                        {t('leadDetail.deleteNote')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            {t('leadDetail.agentActionsTitle')}
          </h3>
          {agentActions.length === 0 ? (
            <p className="text-xs text-slate-400">{t('leadDetail.noActions')}</p>
          ) : (
            <ul className="space-y-2">
              {agentActions.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs"
                >
                  <div className="flex items-center gap-1 font-mono font-semibold text-slate-700">
                    {a.tool}
                    {a.isError && <Badge tone="rose">{t('leadDetail.errorTag')}</Badge>}
                  </div>
                  <div className="mt-0.5 break-words text-slate-500">
                    {t('leadDetail.inLabel')}: {JSON.stringify(a.input)}
                  </div>
                  <div className="break-words text-slate-500">
                    {t('leadDetail.outLabel')}: {a.output}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>

      {editing && (
        <LeadFormModal
          lead={lead}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
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
