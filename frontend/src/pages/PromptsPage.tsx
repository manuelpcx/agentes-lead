import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import type { AgentItem, PromptVersionItem } from '../types';

export function PromptsPage() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [versions, setVersions] = useState<PromptVersionItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get('/panel/agents').then((r) => {
      setAgents(r.data);
      if (r.data[0]) setAgentId(r.data[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!agentId) return;
    const { data } = await api.get('/panel/prompt-versions', {
      params: { agentId },
    });
    setVersions(data);
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const active = versions.find((v) => v.isActive);

  // Sincroniza el borrador con la versión activa cada vez que cambia (al
  // cargar, cambiar de agente, o después de guardar/restablecer).
  useEffect(() => {
    setDraft(active?.content ?? '');
  }, [active?.id]);

  const activate = async (id: string) => {
    await api.post(`/panel/prompt-versions/${id}/activate`);
    load();
  };

  const save = async () => {
    setMsg(null);
    setSaving(true);
    try {
      await api.put(`/panel/prompt-versions/agent/${agentId}`, {
        content: draft,
      });
      setMsg(t('prompts.savedMsg'));
      load();
    } catch {
      setMsg(t('prompts.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    setMsg(null);
    setResetting(true);
    try {
      await api.post(`/panel/prompt-versions/agent/${agentId}/reset-to-default`);
      setMsg(t('prompts.resetMsg'));
      load();
    } catch {
      setMsg(t('prompts.resetError'));
    } finally {
      setResetting(false);
    }
  };

  const dirty = draft !== (active?.content ?? '');

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <PageHeader
        title={t('prompts.title')}
        subtitle={t('prompts.subtitle')}
        actions={
          <Select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-auto"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        }
      />

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            {t('prompts.activePromptTitle')}
            {active
              ? t('prompts.activeVersionSuffix', { version: active.version })
              : ''}
          </h3>
          {dirty && <Badge tone="amber">{t('prompts.unsaved')}</Badge>}
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-64 font-mono text-xs"
          placeholder={t('prompts.placeholder')}
        />
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={save} disabled={saving || !dirty || !draft.trim()}>
            {saving ? t('prompts.saving') : t('prompts.save')}
          </Button>
          <Button variant="secondary" onClick={resetToDefault} disabled={resetting}>
            {resetting ? t('prompts.resetting') : t('prompts.resetToDefault')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t('prompts.saveHint')}</p>
      </Card>

      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">v{v.version}</span>
                {v.isActive ? (
                  <Badge tone="green">{t('prompts.active')}</Badge>
                ) : (
                  <Badge tone="slate">{t('prompts.proposed')}</Badge>
                )}
                {v.changeReason && (
                  <span className="text-xs text-slate-400">
                    {v.changeReason}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(open === v.id ? null : v.id)}
                >
                  {open === v.id ? t('prompts.hide') : t('prompts.view')}
                </Button>
                {!v.isActive && (
                  <Button size="sm" onClick={() => activate(v.id)}>
                    {t('prompts.activate')}
                  </Button>
                )}
              </div>
            </div>
            {open === v.id && (
              <pre className="mt-3 max-h-72 overflow-auto scrollbar-slim whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                {v.content}
              </pre>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
