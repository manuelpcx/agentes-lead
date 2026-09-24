import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Badge, Button, Card, PageHeader, Textarea } from '../components/ui';
import type { ComplianceIssueItem, ExampleItem, KnowledgeGapItem } from '../types';

export function ApprovalPage() {
  const { t } = useTranslation();
  const [gaps, setGaps] = useState<KnowledgeGapItem[]>([]);
  const [examples, setExamples] = useState<ExampleItem[]>([]);
  const [issues, setIssues] = useState<ComplianceIssueItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [g, e, i] = await Promise.all([
      api.get('/panel/knowledge-gaps').then((r) => r.data),
      api.get('/panel/examples').then((r) => r.data),
      api.get('/panel/compliance-issues').then((r) => r.data),
    ]);
    setGaps(g);
    setExamples(e);
    setIssues(i);
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
  const approveIssue = async (id: string) => {
    await api.post(`/panel/compliance-issues/${id}/approve`);
    load();
  };
  const rejectIssue = async (id: string) => {
    await api.post(`/panel/compliance-issues/${id}/reject`);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <PageHeader title={t('approval.title')} subtitle={t('approval.subtitle')} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('approval.complianceTitle')}
        </h2>
        <p className="mb-2 text-xs text-slate-400">{t('approval.complianceHint')}</p>
        {issues.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
            {t('approval.nothingPending')}
          </p>
        )}
        <div className="space-y-3">
          {issues.map((i) => (
            <Card key={i.id} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{i.issue}</span>
                <div className="flex items-center gap-2">
                  <Badge tone="slate">{i.agentName}</Badge>
                  <Badge tone="amber">{i.frequency}×</Badge>
                </div>
              </div>
              {i.evidence && (
                <p className="mb-2 text-xs italic text-slate-500">
                  "{i.evidence}"
                </p>
              )}
              <div className="flex gap-2">
                <Button onClick={() => approveIssue(i.id)}>
                  {t('approval.confirm')}
                </Button>
                <Button variant="secondary" onClick={() => rejectIssue(i.id)}>
                  {t('approval.discard')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('approval.knowledgeGapsTitle')}
        </h2>
        {gaps.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
            {t('approval.nothingPending')}
          </p>
        )}
        <div className="space-y-3">
          {gaps.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{g.question}</span>
                <Badge tone="amber">{t('approval.askedTimes', { n: g.frequency })}</Badge>
              </div>
              <Textarea
                value={answers[g.id] ?? ''}
                onChange={(e) =>
                  setAnswers({ ...answers, [g.id]: e.target.value })
                }
                placeholder={t('approval.answerPlaceholder')}
                className="mb-2 h-20"
              />
              <div className="flex gap-2">
                <Button onClick={() => approveGap(g.id)}>
                  {t('approval.approveIndex')}
                </Button>
                <Button variant="secondary" onClick={() => rejectGap(g.id)}>
                  {t('approval.reject')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('approval.examplesTitle')}
        </h2>
        {examples.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
            {t('approval.noExamples')}
          </p>
        )}
        <div className="space-y-2">
          {examples.map((ex) => (
            <Card key={ex.id} className="p-4 text-sm">
              <p className="text-slate-500">
                <span className="font-medium text-slate-600">
                  {t('approval.situation')}
                </span>{' '}
                {ex.situation}
              </p>
              <p className="text-slate-800">
                <span className="font-medium text-slate-600">
                  {t('approval.response')}
                </span>{' '}
                {ex.agentResponse}
              </p>
              <p className="mb-2 text-xs text-slate-400">
                {t('approval.outcome', { outcome: ex.outcome })}
              </p>
              <Button onClick={() => approveExample(ex.id)}>
                {t('approval.approveFewShot')}
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
