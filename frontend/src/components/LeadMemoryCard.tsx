import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { LeadMemory } from '../types';
import { Button, Card, Input, Textarea } from './ui';

/**
 * Memoria del lead: el perfil que el agente arma solo y arrastra entre
 * conversaciones. Se muestra editable a propósito — el agente la deduce de lo
 * que se habló, y el equipo tiene que poder corregir algo mal entendido sin
 * esperar a la próxima conversación.
 */
export function LeadMemoryCard({
  leadId,
  memory,
  canWrite,
  onSaved,
}: {
  leadId: string;
  memory: LeadMemory;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(memory.summary ?? '');
  const [editing, setEditing] = useState(false);
  const [clave, setClave] = useState('');
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);

  // El detalle se refresca por polling cada 4 s: sin esto, el resumen que
  // reescribe el agente en segundo plano no se vería hasta recargar.
  useEffect(() => {
    if (!editing) {
      setSummary(memory.summary ?? '');
    }
  }, [memory.summary, editing]);

  const patch = async (body: Record<string, string>) => {
    setBusy(true);
    try {
      await api.patch(`/panel/leads/${leadId}/memory`, body);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const saveSummary = async () => {
    await patch({ summary: summary.trim() });
    setEditing(false);
  };

  const addFact = async (e: FormEvent) => {
    e.preventDefault();
    if (!clave.trim() || !valor.trim()) return;
    await patch({ clave: clave.trim(), valor: valor.trim() });
    setClave('');
    setValor('');
  };

  const insights = memory.insights ?? [];
  const vacia =
    !memory.summary && memory.facts.length === 0 && insights.length === 0;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-800">
        {t('leadDetail.memoryTitle')}
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        {t('leadDetail.memoryHint')}
      </p>

      {vacia && !editing && (
        <p className="mb-3 text-xs text-slate-400">
          {t('leadDetail.memoryEmpty')}
        </p>
      )}

      {editing ? (
        <div className="mb-3 space-y-2">
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={800}
            className="h-24 text-xs"
            placeholder={t('leadDetail.memorySummaryPlaceholder')}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveSummary} disabled={busy}>
              {t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSummary(memory.summary ?? '');
                setEditing(false);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        memory.summary && (
          <div className="mb-3">
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
              {memory.summary}
            </p>
            {canWrite && (
              <button
                onClick={() => setEditing(true)}
                className="mt-1 text-[11px] text-brand-600 hover:text-brand-700"
              >
                {t('leadDetail.memoryEdit')}
              </button>
            )}
          </div>
        )
      )}

      {insights.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-medium text-slate-500">
            {t('leadDetail.memoryInsights')}
          </p>
          <ul className="space-y-1">
            {insights.map((c) => (
              <li
                key={c.texto}
                className="rounded-lg border border-violet-100 bg-violet-50/60 p-2 text-xs text-slate-700"
              >
                {c.texto}{' '}
                <span className="text-[11px] text-slate-400">
                  {t('leadDetail.memoryInsightEvidence', {
                    count: c.evidencia.length,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {memory.facts.length > 0 && (
        <ul className="mb-3 space-y-1">
          {memory.facts.map((f) => (
            <li
              key={f.clave}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 p-2 text-xs"
            >
              <span className="text-slate-700">
                <span className="font-medium text-slate-500">{f.clave}: </span>
                {f.valor}
              </span>
              {canWrite && (
                <button
                  onClick={() => patch({ olvidar: f.clave })}
                  disabled={busy}
                  className="shrink-0 text-rose-500 hover:text-rose-600"
                >
                  {t('leadDetail.memoryForget')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <form onSubmit={addFact} className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder={t('leadDetail.memoryKeyPlaceholder')}
              maxLength={40}
              className="text-xs"
            />
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={t('leadDetail.memoryValuePlaceholder')}
              maxLength={200}
              className="text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={busy || !clave.trim() || !valor.trim()}
            >
              {t('leadDetail.memoryAddFact')}
            </Button>
            {!memory.summary && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[11px] text-brand-600 hover:text-brand-700"
              >
                {t('leadDetail.memoryWriteSummary')}
              </button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
