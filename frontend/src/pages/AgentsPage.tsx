import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Plantilla de WhatsApp aprobada, para elegir en el pool por propósito. */
interface TemplateOption {
  name: string;
  language: string;
}

type TemplatePurpose = 'opening' | 'followup' | 'reactivation';
const PURPOSES: TemplatePurpose[] = ['opening', 'followup', 'reactivation'];
const PURPOSE_I18N: Record<TemplatePurpose, string> = {
  opening: 'purposeOpening',
  followup: 'purposeFollowup',
  reactivation: 'purposeReactivation',
};

/** Sub-estado (crudo, como texto) de la config de seguimiento del formulario. */
interface FollowupUiState {
  channelLadder: string; // "email,whatsapp,whatsapp,email"
  delaysHours: string; // "12,48,72"
  maxAttempts: string;
  firstContactDelayMin: string;
  templates: Record<TemplatePurpose, string>; // nombre de plantilla o ''
}

const EMPTY_FOLLOWUP_UI: FollowupUiState = {
  channelLadder: '',
  delaysHours: '',
  maxAttempts: '',
  firstContactDelayMin: '',
  templates: { opening: '', followup: '', reactivation: '' },
};

/** Estado editable de un agente en el formulario. */
interface FormState {
  name: string;
  type: string;
  description: string;
  channels: string[];
  leadStates: string[];
  priority: number;
  isDefault: boolean;
  followupUi: FollowupUiState;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'CUSTOM',
  description: '',
  channels: [],
  leadStates: [],
  priority: 0,
  isDefault: false,
  followupUi: EMPTY_FOLLOWUP_UI,
};

/** Lee `followupConfig` (JSON del backend) a los campos de texto del formulario. */
function parseFollowupUi(cfg: Record<string, unknown> | undefined): FollowupUiState {
  if (!cfg || typeof cfg !== 'object') {
    return EMPTY_FOLLOWUP_UI;
  }
  const ladder = Array.isArray(cfg.channelLadder)
    ? (cfg.channelLadder as unknown[]).filter((x) => typeof x === 'string').join(',')
    : '';
  const delays = Array.isArray(cfg.delaysHours)
    ? (cfg.delaysHours as unknown[]).map(String).join(',')
    : '';
  const maxAttempts =
    typeof cfg.maxAttempts === 'number' ? String(cfg.maxAttempts) : '';
  const firstContactDelayMin =
    typeof cfg.firstContactDelayMin === 'number'
      ? String(cfg.firstContactDelayMin)
      : '';
  const rawTemplates = (cfg.templates ?? {}) as Record<string, unknown>;
  const templates = { opening: '', followup: '', reactivation: '' } as Record<
    TemplatePurpose,
    string
  >;
  for (const p of ['opening', 'followup', 'reactivation'] as TemplatePurpose[]) {
    const t = rawTemplates[p] as { name?: string } | undefined;
    if (t?.name) {
      templates[p] = t.name;
    }
  }
  return { channelLadder: ladder, delaysHours: delays, maxAttempts, firstContactDelayMin, templates };
}

/** Traduce el formulario a `followupConfig` (JSON) para el backend. */
function buildFollowupConfig(
  ui: FollowupUiState,
  templates: TemplateOption[],
): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};

  const ladder = ui.channelLadder
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ladder.length > 0) {
    cfg.channelLadder = ladder;
  }

  const delays = ui.delaysHours
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (delays.length > 0) {
    cfg.delaysHours = delays;
  }

  const maxAttempts = Number(ui.maxAttempts);
  if (ui.maxAttempts.trim() && Number.isFinite(maxAttempts) && maxAttempts > 0) {
    cfg.maxAttempts = Math.floor(maxAttempts);
  }

  const firstContact = Number(ui.firstContactDelayMin);
  if (
    ui.firstContactDelayMin.trim() &&
    Number.isFinite(firstContact) &&
    firstContact >= 0
  ) {
    cfg.firstContactDelayMin = Math.floor(firstContact);
  }

  const tpl: Record<string, unknown> = {};
  for (const p of ['opening', 'followup', 'reactivation'] as TemplatePurpose[]) {
    const name = ui.templates[p];
    if (name) {
      const found = templates.find((t) => t.name === name);
      tpl[p] = { name, language: found?.language ?? 'es' };
    }
  }
  if (Object.keys(tpl).length > 0) {
    cfg.templates = tpl;
  }

  return cfg;
}

function toForm(a: AgentFull): FormState {
  return {
    name: a.name,
    type: a.type,
    description: a.description ?? '',
    channels: a.channels,
    leadStates: a.leadStates,
    priority: a.priority,
    isDefault: a.isDefault,
    followupUi: parseFollowupUi(a.followupConfig),
  };
}

/** Casillas para alternar un valor dentro de un arreglo. */
function CheckGroup({
  options,
  labels,
  selected,
  onToggle,
}: {
  options: string[];
  labels: Record<string, string>;
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
          {labels[opt] ?? opt}
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
  templates,
}: {
  initial: FormState;
  onSubmit: (f: FormState) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
  templates: TemplateOption[];
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);

  const channelLabels = t('channels', { returnObjects: true }) as Record<string, string>;
  const leadStateLabels = t('leadStatus', { returnObjects: true }) as Record<string, string>;
  const typeLabels = t('assistant.typeLabels', { returnObjects: true }) as Record<
    string,
    string
  >;

  const toggle = (field: 'channels' | 'leadStates', value: string) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(value)
        ? f[field].filter((v) => v !== value)
        : [...f[field], value],
    }));

  const setFollowup = <K extends keyof FollowupUiState>(
    key: K,
    value: FollowupUiState[K],
  ) => setForm((f) => ({ ...f, followupUi: { ...f.followupUi, [key]: value } }));

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
        <Field label={t('agents.fieldName')}>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label={t('agents.fieldType')}>
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {AGENT_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {typeLabels[ty] ?? ty}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t('agents.fieldDescription')} hint={t('agents.fieldDescriptionHint')}>
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>

      <Field label={t('agents.fieldChannels')} hint={t('agents.fieldChannelsHint')}>
        <CheckGroup
          options={CHANNELS}
          labels={channelLabels}
          selected={form.channels}
          onToggle={(v) => toggle('channels', v)}
        />
      </Field>

      <Field label={t('agents.fieldLeadStates')} hint={t('agents.fieldLeadStatesHint')}>
        <CheckGroup
          options={LEAD_STATES}
          labels={leadStateLabels}
          selected={form.leadStates}
          onToggle={(v) => toggle('leadStates', v)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-6">
        <div className="w-28">
          <Field label={t('agents.fieldPriority')}>
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
          {t('agents.defaultCheckbox')}
        </label>
      </div>

      {/* ── Seguimiento propio del agente (opcional) ── */}
      <div className="border-t border-slate-200 pt-5">
        <h4 className="mb-1 text-sm font-semibold text-slate-800">
          {t('agents.followupSectionTitle')}
        </h4>
        <p className="mb-4 text-xs text-slate-500">
          {t('agents.followupSectionHint')}
        </p>

        <Field
          label={t('agents.channelLadderLabel')}
          hint={t('agents.channelLadderHint')}
        >
          <Input
            value={form.followupUi.channelLadder}
            onChange={(e) => setFollowup('channelLadder', e.target.value)}
            placeholder={t('agents.channelLadderPlaceholder')}
            className="font-mono text-xs"
          />
        </Field>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label={t('agents.delaysLabel')} hint={t('agents.delaysHint')}>
            <Input
              value={form.followupUi.delaysHours}
              onChange={(e) => setFollowup('delaysHours', e.target.value)}
              placeholder={t('agents.delaysPlaceholder')}
              className="font-mono text-xs"
            />
          </Field>
          <Field label={t('agents.maxAttemptsLabel')}>
            <Input
              type="number"
              min={1}
              value={form.followupUi.maxAttempts}
              onChange={(e) => setFollowup('maxAttempts', e.target.value)}
              placeholder={t('agents.maxAttemptsPlaceholder')}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label={t('agents.firstContactLabel')}
            hint={t('agents.firstContactHint')}
          >
            <Input
              type="number"
              min={0}
              value={form.followupUi.firstContactDelayMin}
              onChange={(e) =>
                setFollowup('firstContactDelayMin', e.target.value)
              }
              placeholder={t('agents.firstContactPlaceholder')}
              className="max-w-[10rem]"
            />
          </Field>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-slate-600">
            {t('agents.templatesLabel')}
          </p>
          {templates.length === 0 ? (
            <p className="text-xs text-slate-400">
              {t('agents.noTemplates', { link: t('nav.templates') })}
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {PURPOSES.map((p) => (
                <Field
                  key={p}
                  label={t(`agents.${PURPOSE_I18N[p]}`)}
                  hint={t(`agents.${PURPOSE_I18N[p]}Hint`)}
                >
                  <Select
                    value={form.followupUi.templates[p]}
                    onChange={(e) =>
                      setFollowup('templates', {
                        ...form.followupUi.templates,
                        [p]: e.target.value,
                      })
                    }
                  >
                    <option value="">
                      {p === 'opening'
                        ? t('agents.templateUseGlobal')
                        : t('agents.templateUseOpening')}
                    </option>
                    {templates.map((tpl) => (
                      <option key={tpl.name} value={tpl.name}>
                        {tpl.name} ({tpl.language})
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? t('agents.saving') : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('agents.cancel')}
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

/** Solo los campos que aceptan los DTOs del backend (whitelist estricta). */
function toPayload(f: FormState, templates: TemplateOption[]) {
  return {
    name: f.name,
    type: f.type,
    description: f.description,
    channels: f.channels,
    leadStates: f.leadStates,
    priority: f.priority,
    isDefault: f.isDefault,
    followupConfig: buildFollowupConfig(f.followupUi, templates),
  };
}

export function AgentsPage() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentFull[]>([]);
  const [metrics, setMetrics] = useState<AgentMetricsRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const channelLabels = t('channels', { returnObjects: true }) as Record<string, string>;
  const leadStateLabels = t('leadStatus', { returnObjects: true }) as Record<string, string>;

  const load = useCallback(async () => {
    const [a, m, h, tpl] = await Promise.all([
      api.get('/panel/agents').then((r) => r.data),
      api.get('/panel/agents/metrics').then((r) => r.data),
      api.get('/panel/handoffs').then((r) => r.data),
      api
        .get('/panel/whatsapp/templates')
        .then((r) => r.data)
        .catch(() => []),
    ]);
    setAgents(a);
    setMetrics(m);
    setHandoffs(h);
    setTemplates(
      (tpl as { name: string; language: string; status: string }[])
        .filter((x) => x.status === 'APPROVED')
        .map((x) => ({ name: x.name, language: x.language })),
    );
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
          ?.message ?? t('common.errorGeneric');
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    }
  };

  const create = (f: FormState) =>
    handle(() => api.post('/panel/agents', toPayload(f, templates)));
  const update = (id: string, f: FormState) =>
    handle(() =>
      api.patch(`/panel/agents/${id}`, toPayload(f, templates)),
    );
  const deactivate = (id: string) =>
    handle(() => api.delete(`/panel/agents/${id}`));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <PageHeader
        title={t('agents.title')}
        subtitle={t('agents.subtitle')}
        actions={
          !creating && (
            <Button
              onClick={() => {
                setCreating(true);
                setEditingId(null);
              }}
            >
              {t('agents.newAgent')}
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
            {t('agents.comparedMetrics')}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-medium">{t('agents.colAgent')}</th>
                <th className="py-2 text-right font-medium">{t('agents.colLeads')}</th>
                <th className="py-2 text-right font-medium">{t('agents.colAppointments')}</th>
                <th className="py-2 text-right font-medium">{t('agents.colEscalations')}</th>
                <th className="py-2 text-right font-medium">{t('agents.colMsgSent')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('agents.colHandoffs')}</th>
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
                      {m.isDefault && <Badge tone="brand">{t('agents.defaultBadge')}</Badge>}
                      {!m.isActive && <Badge tone="slate">{t('agents.inactiveBadge')}</Badge>}
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
            {t('agents.newAgentFormTitle')}
          </h3>
          <AgentForm
            initial={EMPTY_FORM}
            submitLabel={t('common.create')}
            onSubmit={create}
            onCancel={() => setCreating(false)}
            templates={templates}
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
                  {a.isDefault && <Badge tone="brand">{t('agents.defaultBadge')}</Badge>}
                  {!a.isActive && <Badge tone="slate">{t('agents.inactiveBadge')}</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {t('agents.channelsSummary', {
                    channels:
                      a.channels.map((c) => channelLabels[c] ?? c).join(', ') ||
                      t('agents.any'),
                    states:
                      a.leadStates.map((st) => leadStateLabels[st] ?? st).join(', ') ||
                      t('agents.any'),
                    priority: a.priority,
                  })}
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
                  {editingId === a.id ? t('agents.editClose') : t('agents.editOpen')}
                </Button>
                {a.isActive && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (confirm(t('agents.deactivateConfirm', { name: a.name }))) {
                        deactivate(a.id);
                      }
                    }}
                  >
                    {t('agents.deactivate')}
                  </Button>
                )}
              </div>
            </div>

            {editingId === a.id && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <AgentForm
                  initial={toForm(a)}
                  submitLabel={t('common.save')}
                  onSubmit={(f) => update(a.id, f)}
                  onCancel={() => setEditingId(null)}
                  templates={templates}
                />
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Handoffs recientes */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {t('agents.handoffsTitle')}
        </h2>
        {handoffs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
            {t('agents.noHandoffs')}
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
