import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, Card, PageHeader, Select } from '../components/ui';
import type { AgentItem, PromptVersionItem } from '../types';

export function PromptsPage() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [versions, setVersions] = useState<PromptVersionItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);

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

  const activate = async (id: string) => {
    await api.post(`/panel/prompt-versions/${id}/activate`);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <PageHeader
        title="Versiones de prompt"
        subtitle="El playbook propone versiones; tú decides cuál se activa."
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

      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">v{v.version}</span>
                {v.isActive ? (
                  <Badge tone="green">activa</Badge>
                ) : (
                  <Badge tone="slate">propuesta</Badge>
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
                  {open === v.id ? 'ocultar' : 'ver'}
                </Button>
                {!v.isActive && (
                  <Button size="sm" onClick={() => activate(v.id)}>
                    Activar
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
