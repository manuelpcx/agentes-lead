import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  cn,
} from '../components/ui';
import type { AgentFull, AgentMetricsRow, HandoffRow } from '../types';

const AGENT_TYPES = ['VENTAS', 'SOPORTE', 'COBRANZA', 'AGENDAMIENTO', 'CUSTOM'];
const CHANNELS = ['whatsapp', 'email', 'call'];
const LEAD_STATES = [
  'NUEVO',
  'CONTACTADO',
  'EN_CONVERSACION',
  'AGENDADO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
  'ESCALADO_HUMANO',
];

/** Estado editable de un agente en el formulario. */
interface FormState {
  name: string;
  type: string;
  description: string;
  channels: string[];
  leadStates: string[];
  priority: number;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'CUSTOM',
  description: '',
  channels: [],
  leadStates: [],
  priority: 0,
  isDefault: false,
};

function toForm(a: AgentFull): FormState {
  return {
    name: a.name,
    type: a.type,
    description: a.description ?? '',
    channels: a.channels,
    leadStates: a.leadStates,
    priority: a.priority,
    isDefault: a.isDefault,
  };
}

/** Casillas para alternar un valor dentro de un arreglo. */
function CheckGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <label
          key={opt}
          className={cn(
            'cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition',
            selected.includes(opt)
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-slate-300 text-slate-600 hover:border-slate-400',
          )}
        >
          <input
            type="checkbox"
            className="hidden"
            checked={selected.includes(opt)}
            onChange={() => onToggle(opt)}
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

function AgentForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: FormState;
  onSubmit: (f: FormState) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);

  const toggle = (field: 'channels' | 'leadStates', value: string) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(value)
        ? f[field].filter((v) => v !== value)
        : [...f[field], value],
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nombre">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Tipo">
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {AGENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Descripción"
        hint="Ayuda al clasificador a decidir cuándo derivarle."
      >
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>

      <Field label="Canales que atiende" hint="Ninguno = cualquiera.">
        <CheckGroup
          options={CHANNELS}
          selected={form.channels}
          onToggle={(v) => toggle('channels', v)}
        />
      </Field>

      <Field label="Estados de lead que maneja" hint="Ninguno = cualquiera.">
        <CheckGroup
          options={LEAD_STATES}
          selected={form.leadStates}
          onToggle={(v) => toggle('leadStates', v)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-6">
        <div className="w-28">
          <Field label="Prioridad">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.priority}
              onChange={(e) =>
                setForm({ ...form, priority: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <label className="mt-5 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          Agente por defecto (recibe lo no clasificado)
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

/** Celda de métrica dentro de la tabla comparada. */
function MetricCell({ value }: { value: number }) {
  return (
    <td className="py-2 text-right font-medium text-slate-800">{value}</td>
  );
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentFull[]>([]);
  const [metrics, setMetrics] = useState<AgentMetricsRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, m, h] = await Promise.all([
      api.get('/panel/agents').then((r) => r.data),
      api.get('/panel/agents/metrics').then((r) => r.data),
      api.get('/panel/handoffs').then((r) => r.data),
    ]);
    setAgents(a);
    setMetrics(m);
    setHandoffs(h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handle = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setCreating(false);
      setEditingId(null);
      await load();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? 'Ocurrió un error.';
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    }
  };

  const create = (f: FormState) => handle(() => api.post('/panel/agents', f));
  const update = (id: string, f: FormState) =>
    handle(() => api.patch(`/panel/agents/${id}`, f));
  const deactivate = (id: string) =>
    handle(() => api.delete(`/panel/agents/${id}`));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Agentes"
        subtitle="Configura, compara y observa los traspasos entre tus agentes."
        actions={
          !creating && (
            <Button
              onClick={() => {
                setCreating(true);
                setEditingId(null);
              }}
            >
              + Nuevo agente
            </Button>
          )
        }
      />

      {error && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Métricas comparadas */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Métricas comparadas
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-medium">Agente</th>
                <th className="py-2 text-right font-medium">Leads</th>
                <th className="py-2 text-right font-medium">Citas</th>
                <th className="py-2 text-right font-medium">Escal.</th>
                <th className="py-2 text-right font-medium">Msg. env.</th>
                <th className="px-4 py-2 text-right font-medium">Deriv.</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr
                  key={m.agentId}
                  className="border-t border-slate-50 hover:bg-slate-50/60"
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">
                        {m.name}
                      </span>
                      <span className="text-xs text-slate-400">{m.type}</span>
                      {m.isDefault && <Badge tone="brand">default</Badge>}
                      {!m.isActive && <Badge tone="slate">inactivo</Badge>}
                    </div>
                  </td>
                  <MetricCell value={m.leadsACargo} />
                  <MetricCell value={m.citasAgendadas} />
                  <MetricCell value={m.escalamientos} />
                  <MetricCell value={m.mensajesSalientes} />
                  <td className="px-4 py-2 text-right font-medium text-slate-800">
                    {m.derivacionesEnviadas}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Formulario de creación */}
      {creating && (
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">
            Nuevo agente
          </h3>
          <AgentForm
            initial={EMPTY_FORM}
            submitLabel="Crear"
            onSubmit={create}
            onCancel={() => setCreating(false)}
          />
        </Card>
      )}

      {/* Lista de agentes */}
      <div className="space-y-3">
        {agents.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{a.name}</span>
                  <Badge tone="slate">{a.type}</Badge>
                  {a.isDefault && <Badge tone="brand">default</Badge>}
                  {!a.isActive && <Badge tone="slate">inactivo</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Canales: {a.channels.join(', ') || 'cualquiera'} · Estados:{' '}
                  {a.leadStates.join(', ') || 'cualquiera'} · Prioridad:{' '}
                  {a.priority}
                </div>
                {a.description && (
                  <p className="mt-1 text-xs text-slate-400">{a.description}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(editingId === a.id ? null : a.id)}
                >
                  {editingId === a.id ? 'cerrar' : 'editar'}
                </Button>
                {a.isActive && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          `¿Desactivar "${a.name}"? Sus leads se reasignan al fallback.`,
                        )
                      ) {
                        deactivate(a.id);
                      }
                    }}
                  >
                    desactivar
                  </Button>
                )}
              </div>
            </div>

            {editingId === a.id && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <AgentForm
                  initial={toForm(a)}
                  submitLabel="Guardar"
                  onSubmit={(f) => update(a.id, f)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Handoffs recientes */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Traspasos recientes
        </h2>
        {handoffs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
            Sin traspasos aún.
          </p>
        ) : (
          <div className="space-y-2">
            {handoffs.map((h, i) => (
              <Card key={i} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-700">
                    →{' '}
                    <span className="font-medium text-slate-900">
                      {h.toAgentName}
                    </span>
                    {h.motivo && (
                      <span className="text-slate-400"> · {h.motivo}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(h.occurredAt).toLocaleString('es-CL')}
                  </span>
                </div>
                {h.resumen && (
                  <p className="mt-1 text-xs text-slate-500">{h.resumen}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
