import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { ApiKeysCard } from '../components/ApiKeysCard';
import { WebhookSetup, type WebhookInfo } from '../components/WebhookSetup';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from '../components/ui';

type Channel = 'whatsapp' | 'email' | 'voice' | 'crm';

/** Canales que reciben webhooks del proveedor (y muestran cómo conectarlos). */
const WEBHOOK_CHANNELS: Channel[] = ['whatsapp', 'voice'];

interface FieldDef {
  key: string;
  /** Ruta i18n a `integrations.schemas.<channel>.fields.<key>`. */
  labelKey: string;
  ph?: string;
}

interface Schema {
  channel: Channel;
  /** Prefijo i18n: `integrations.schemas.<channel>`. */
  i18nKey: string;
  providers: { value: string; label: string }[];
  fields: Record<string, FieldDef[]>;
  /**
   * Proveedores que firman sus webhooks con un secreto DISTINTO de la API key
   * (p. ej. YCloud, al crear el endpoint de webhook). Si el proveedor elegido
   * está en esta lista, se muestra un campo extra para pegarlo.
   */
  webhookSecretProviders?: string[];
}

const SCHEMAS: Schema[] = [
  {
    channel: 'whatsapp',
    i18nKey: 'whatsapp',
    providers: [
      { value: 'ycloud', label: 'YCloud' },
      { value: 'meta', label: 'Meta Cloud API' },
    ],
    fields: {
      ycloud: [
        { key: 'from', labelKey: 'from', ph: '+56911111111' },
        { key: 'wabaId', labelKey: 'wabaId' },
      ],
      meta: [{ key: 'phoneNumberId', labelKey: 'phoneNumberId' }],
    },
    webhookSecretProviders: ['ycloud', 'meta'],
  },
  {
    channel: 'email',
    i18nKey: 'email',
    providers: [
      { value: 'resend', label: 'Resend' },
      { value: 'smtp', label: 'SMTP' },
    ],
    fields: {
      resend: [
        { key: 'from', labelKey: 'from', ph: 'Tu Empresa <no-reply@tu.cl>' },
      ],
      smtp: [
        { key: 'host', labelKey: 'host' },
        { key: 'port', labelKey: 'port', ph: '587' },
        { key: 'user', labelKey: 'user' },
        { key: 'from', labelKey: 'from' },
      ],
    },
  },
  {
    channel: 'voice',
    i18nKey: 'voice',
    providers: [
      { value: 'retell', label: 'Retell' },
      { value: 'vapi', label: 'Vapi' },
    ],
    fields: {
      retell: [
        { key: 'fromNumber', labelKey: 'fromNumber', ph: '+56911111111' },
        { key: 'agentId', labelKey: 'agentId' },
      ],
      vapi: [
        { key: 'phoneNumberId', labelKey: 'phoneNumberId' },
        { key: 'assistantId', labelKey: 'assistantId' },
      ],
    },
    webhookSecretProviders: ['vapi'],
  },
  {
    channel: 'crm',
    i18nKey: 'crm',
    providers: [{ value: 'webhook', label: '' }],
    fields: {
      webhook: [
        {
          key: 'url',
          labelKey: 'url',
          ph: 'https://tu-n8n.cl/webhook/crm-eventos',
        },
        {
          key: 'queryUrl',
          labelKey: 'queryUrl',
          ph: 'https://tu-n8n.cl/webhook/crm-consulta',
        },
      ],
    },
  },
];

interface Status {
  channel: string;
  provider: string;
  config: Record<string, unknown>;
  configured: boolean;
  webhookSecretConfigured: boolean;
  isActive: boolean;
}

function ChannelCard({
  schema,
  status,
  webhooks,
  webhooksFailed,
  onRetryWebhooks,
  onSaved,
}: {
  schema: Schema;
  status?: Status;
  /** URLs de webhook de este backend (null mientras cargan o si no aplican). */
  webhooks: WebhookInfo | null;
  webhooksFailed: boolean;
  onRetryWebhooks: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const s = `integrations.schemas.${schema.i18nKey}`;
  const [provider, setProvider] = useState(
    status?.provider || schema.providers[0].value,
  );
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Precarga la config (NO secreta) que vuelve del backend.
  useEffect(() => {
    if (status) {
      setProvider(status.provider);
      const c: Record<string, string> = {};
      Object.entries(status.config ?? {}).forEach(([k, v]) => {
        c[k] = v == null ? '' : String(v);
      });
      setConfig(c);
    }
  }, [status]);

  const fields = schema.fields[provider] ?? [];
  const providerLabel =
    schema.providers.find((p) => p.value === provider)?.label ?? provider;

  const save = async () => {
    setMsg(null);
    setSaving(true);
    try {
      await api.put(`/panel/integrations/${schema.channel}`, {
        provider,
        config,
        ...(secret.trim() ? { secret: secret.trim() } : {}),
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        isActive: true,
      });
      setSecret('');
      setWebhookSecret('');
      setMsg(t('integrations.saved'));
      setTestResult(null);
      onSaved();
    } catch {
      setMsg(t('integrations.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      const r = await api.post(`/panel/integrations/${schema.channel}/test`);
      setTestResult(r.data);
    } catch {
      setTestResult({ ok: false, message: t('integrations.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{t(`${s}.label`)}</h3>
        {status?.configured ? (
          <Badge tone="green">{t('integrations.configured')}</Badge>
        ) : (
          <Badge tone="slate">{t('integrations.notConfigured')}</Badge>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-500">{t(`${s}.hint`)}</p>

      <div className="space-y-4">
        <Field label={t('integrations.providerLabel')}>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {schema.providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label || t(`${s}.providerWebhook`)}
              </option>
            ))}
          </Select>
        </Field>

        {webhooks && (
          <WebhookSetup
            channel={schema.channel}
            provider={provider}
            providerLabel={providerLabel}
            info={webhooks}
          />
        )}
        {webhooksFailed && WEBHOOK_CHANNELS.includes(schema.channel) && (
          <p className="text-xs text-rose-600">
            {t('integrations.webhook.loadFailed')}{' '}
            <button
              type="button"
              onClick={onRetryWebhooks}
              className="font-medium underline"
            >
              {t('common.retry')}
            </button>
          </p>
        )}

        {fields.map((f) => (
          <Field key={f.key} label={t(`${s}.fields.${f.labelKey}`)}>
            <Input
              value={config[f.key] ?? ''}
              onChange={(e) =>
                setConfig((c) => ({ ...c, [f.key]: e.target.value }))
              }
              placeholder={f.ph}
              className="font-mono text-xs"
            />
          </Field>
        ))}

        <Field
          label={t(`${s}.secretLabel`)}
          hint={
            status?.configured
              ? t('integrations.secretHintExisting')
              : t('integrations.secretHintNew')
          }
        >
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={status?.configured ? '•••••••• (guardado)' : ''}
            className="font-mono text-xs"
            autoComplete="new-password"
          />
        </Field>

        {schema.webhookSecretProviders?.includes(provider) && (
          <Field
            label={t(`${s}.webhookSecretLabel`)}
            hint={t(`${s}.webhookSecretHint`)}
          >
            <div className="mb-2 flex items-center gap-2">
              {status?.webhookSecretConfigured ? (
                <Badge tone="green">{t('integrations.signatureVerified')}</Badge>
              ) : (
                <Badge tone="amber">{t('integrations.signatureUnverified')}</Badge>
              )}
            </div>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={
                status?.webhookSecretConfigured ? '•••••••• (guardado)' : ''
              }
              className="font-mono text-xs"
              autoComplete="new-password"
            />
          </Field>
        )}

        {msg && <p className="text-sm text-slate-600">{msg}</p>}
        {testResult && (
          <p
            className={
              testResult.ok
                ? 'text-sm text-emerald-600'
                : 'text-sm text-rose-600'
            }
          >
            {testResult.ok ? '✓ ' : '✗ '}
            {testResult.message}
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? t('integrations.saving') : t('integrations.save')}
          </Button>
          <Button
            variant="secondary"
            onClick={test}
            disabled={testing || !status?.configured}
          >
            {testing ? t('integrations.testing') : t('integrations.testConnection')}
          </Button>
        </div>
        {!status?.configured && (
          <p className="text-xs text-slate-400">
            {t('integrations.needCredentialsHint')}
          </p>
        )}
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookInfo | null>(null);
  const [webhooksFailed, setWebhooksFailed] = useState(false);

  const load = () => {
    api
      .get('/panel/integrations')
      .then((r) => setStatuses(r.data))
      .catch(() => setStatuses([]));
  };
  useEffect(load, []);
  // Las URLs no cambian al guardar: se piden una vez.
  const loadWebhooks = () => {
    setWebhooksFailed(false);
    api
      .get<WebhookInfo>('/panel/integrations/webhooks')
      .then((r) => setWebhooks(r.data))
      .catch((e: { response?: { status?: number } }) => {
        // 403: solo el dueño configura integraciones; los demás no ven la guía.
        setWebhooksFailed(e.response?.status !== 403);
      });
  };
  useEffect(loadWebhooks, []);

  const byChannel = (c: Channel) => statuses.find((s) => s.channel === c);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHeader title={t('integrations.title')} subtitle={t('integrations.subtitle')} />
      <div className="grid gap-6 md:grid-cols-2">
        {SCHEMAS.map((s) => (
          <ChannelCard
            key={s.channel}
            schema={s}
            status={byChannel(s.channel)}
            webhooks={webhooks}
            webhooksFailed={webhooksFailed}
            onRetryWebhooks={loadWebhooks}
            onSaved={load}
          />
        ))}
      </div>

      {/* Acceso por llave de API: lo usa el servidor MCP (ver `mcp/`). */}
      <div className="mt-6">
        <ApiKeysCard />
      </div>
    </div>
  );
}
