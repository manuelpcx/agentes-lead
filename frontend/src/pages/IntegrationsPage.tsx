import { useEffect, useState } from 'react';
import { api } from '../api/client';
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

interface FieldDef {
  key: string;
  label: string;
  ph?: string;
}

interface Schema {
  channel: Channel;
  label: string;
  hint: string;
  providers: { value: string; label: string }[];
  secretLabel: string;
  fields: Record<string, FieldDef[]>;
  /**
   * Proveedores que firman sus webhooks con un secreto DISTINTO de la API key
   * (p. ej. YCloud, al crear el endpoint de webhook). Si el proveedor elegido
   * está en esta lista, se muestra un campo extra para pegarlo.
   */
  webhookSecretProviders?: string[];
  webhookSecretLabel?: string;
  webhookSecretHint?: string;
}

const SCHEMAS: Schema[] = [
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    hint: 'Tu cuenta de YCloud (o Meta) y tu número. Necesario para enviar/recibir WhatsApp y crear plantillas.',
    providers: [
      { value: 'ycloud', label: 'YCloud' },
      { value: 'meta', label: 'Meta Cloud API' },
    ],
    secretLabel: 'API Key / Token',
    fields: {
      ycloud: [
        { key: 'from', label: 'Número de negocio (E.164)', ph: '+56911111111' },
        { key: 'wabaId', label: 'WABA ID (para plantillas)' },
      ],
      meta: [{ key: 'phoneNumberId', label: 'Phone Number ID' }],
    },
    webhookSecretProviders: ['ycloud'],
    webhookSecretLabel: 'Secreto de firma del webhook',
    webhookSecretHint:
      'Distinto de la API Key. Créalo en YCloud al configurar el endpoint de ' +
      'webhook (Webhook Endpoints → Create) y pega el "secret" que te den. ' +
      'Sin esto, los mensajes entrantes se aceptan sin verificar su firma.',
  },
  {
    channel: 'email',
    label: 'Correo',
    hint: 'Tu cuenta de Resend (o SMTP) para enviar correos.',
    providers: [
      { value: 'resend', label: 'Resend' },
      { value: 'smtp', label: 'SMTP' },
    ],
    secretLabel: 'API Key / Contraseña',
    fields: {
      resend: [
        { key: 'from', label: 'Remitente', ph: 'Tu Empresa <no-reply@tu.cl>' },
      ],
      smtp: [
        { key: 'host', label: 'Host' },
        { key: 'port', label: 'Puerto', ph: '587' },
        { key: 'user', label: 'Usuario' },
        { key: 'from', label: 'Remitente' },
      ],
    },
  },
  {
    channel: 'voice',
    label: 'Voz (llamadas)',
    hint: 'Tu cuenta de Retell (o Vapi) y tu número para las llamadas.',
    providers: [
      { value: 'retell', label: 'Retell' },
      { value: 'vapi', label: 'Vapi' },
    ],
    secretLabel: 'API Key',
    fields: {
      retell: [
        { key: 'fromNumber', label: 'Número (E.164)', ph: '+56911111111' },
        { key: 'agentId', label: 'Agent ID de Retell' },
      ],
      vapi: [
        { key: 'phoneNumberId', label: 'Phone Number ID' },
        { key: 'assistantId', label: 'Assistant ID' },
      ],
    },
  },
  {
    channel: 'crm',
    label: 'CRM',
    hint:
      'Conecta tu CRM (HubSpot, Pipedrive, Salesforce, el que sea) vía un webhook ' +
      '— normalmente el disparador de un flujo de n8n/Zapier que mapea el evento a ' +
      'tu CRM. El agente avisa cambios de estado, citas agendadas y promesas de pago.',
    providers: [
      { value: 'webhook', label: 'Webhook (n8n / Zapier / URL propia)' },
    ],
    secretLabel: 'Secreto de firma (lo defines tú)',
    fields: {
      webhook: [
        {
          key: 'url',
          label: 'URL del webhook',
          ph: 'https://tu-n8n.cl/webhook/crm-eventos',
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
  onSaved,
}: {
  schema: Schema;
  status?: Status;
  onSaved: () => void;
}) {
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
      setMsg('Guardado.');
      setTestResult(null);
      onSaved();
    } catch {
      setMsg('No se pudo guardar.');
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
      setTestResult({ ok: false, message: 'No se pudo probar la conexión.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{schema.label}</h3>
        {status?.configured ? (
          <Badge tone="green">Configurado</Badge>
        ) : (
          <Badge tone="slate">Sin configurar</Badge>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-500">{schema.hint}</p>

      <div className="space-y-4">
        <Field label="Proveedor">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {schema.providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
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
          label={schema.secretLabel}
          hint={
            status?.configured
              ? 'Ya hay un secreto guardado. Escribe uno nuevo solo si quieres reemplazarlo.'
              : 'Se guarda cifrado; nunca se muestra de vuelta.'
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
            label={schema.webhookSecretLabel ?? 'Secreto de firma del webhook'}
            hint={schema.webhookSecretHint}
          >
            <div className="mb-2 flex items-center gap-2">
              {status?.webhookSecretConfigured ? (
                <Badge tone="green">Firma verificada</Badge>
              ) : (
                <Badge tone="amber">Sin verificar</Badge>
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
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button
            variant="secondary"
            onClick={test}
            disabled={testing || !status?.configured}
          >
            {testing ? 'Probando…' : 'Probar conexión'}
          </Button>
        </div>
        {!status?.configured && (
          <p className="text-xs text-slate-400">
            Guarda las credenciales para poder probar la conexión.
          </p>
        )}
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const [statuses, setStatuses] = useState<Status[]>([]);

  const load = () => {
    api
      .get('/panel/integrations')
      .then((r) => setStatuses(r.data))
      .catch(() => setStatuses([]));
  };
  useEffect(load, []);

  const byChannel = (c: Channel) => statuses.find((s) => s.channel === c);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHeader
        title="Integraciones"
        subtitle="Conecta tus propias cuentas de WhatsApp, correo y voz. Los secretos se guardan cifrados y nunca se muestran."
      />
      <div className="grid gap-6 md:grid-cols-2">
        {SCHEMAS.map((s) => (
          <ChannelCard
            key={s.channel}
            schema={s}
            status={byChannel(s.channel)}
            onSaved={load}
          />
        ))}
      </div>
    </div>
  );
}
