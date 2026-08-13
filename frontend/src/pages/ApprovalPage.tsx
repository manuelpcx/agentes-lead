import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, Card, PageHeader, Textarea } from '../components/ui';
import type { ExampleItem, KnowledgeGapItem } from '../types';

export function ApprovalPage() {
  const [gaps, setGaps] = useState<KnowledgeGapItem[]>([]);
  const [examples, setExamples] = useState<ExampleItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [g, e] = await Promise.all([
      api.get('/panel/knowledge-gaps').then((r) => r.data),
      api.get('/panel/examples').then((r) => r.data),
    ]);
    setGaps(g);
    setExamples(e);
    setAnswers(
      Object.fromEntries(
        (g as KnowledgeGapItem[]).map((x) => [x.id, x.suggestedAnswer ?? '']),
      ),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approveGap = async (id: string) => {
    await api.post(`/panel/knowledge-gaps/${id}/approve`, {
      answer: answers[id],
    });
    load();
  };
  const rejectGap = async (id: string) => {
    await api.post(`/panel/knowledge-gaps/${id}/reject`);
    load();
  };
  const approveExample = async (id: string) => {
    await api.post(`/panel/examples/${id}/approve`);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Aprobación"
        subtitle="Nada entra a la base ni al few-shot sin tu visto bueno."
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Vacíos de conocimiento
        </h2>
        {gaps.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
            Nada pendiente. 🎉
          </p>
        )}
        <div className="space-y-3">
          {gaps.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{g.question}</span>
                <Badge tone="amber">{g.frequency}× preguntada</Badge>
              </div>
              <Textarea
                value={answers[g.id] ?? ''}
                onChange={(e) =>
                  setAnswers({ ...answers, [g.id]: e.target.value })
                }
                placeholder="Respuesta a agregar a la base de conocimiento…"
                className="mb-2 h-20"
              />
              <div className="flex gap-2">
                <Button onClick={() => approveGap(g.id)}>
                  Aprobar (indexar)
                </Button>
                <Button variant="secondary" onClick={() => rejectGap(g.id)}>
                  Rechazar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Ejemplos propuestos
        </h2>
        {examples.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
            Sin ejemplos pendientes.
          </p>
        )}
        <div className="space-y-2">
          {examples.map((ex) => (
            <Card key={ex.id} className="p-4 text-sm">
              <p className="text-slate-500">
                <span className="font-medium text-slate-600">Situación:</span>{' '}
                {ex.situation}
              </p>
              <p className="text-slate-800">
                <span className="font-medium text-slate-600">Respuesta:</span>{' '}
                {ex.agentResponse}
              </p>
              <p className="mb-2 text-xs text-slate-400">
                Resultado: {ex.outcome}
              </p>
              <Button onClick={() => approveExample(ex.id)}>
                Aprobar para few-shot
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
