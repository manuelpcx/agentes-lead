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

type Channel = 'whatsapp' | 'email' | 'voice';

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
];

interface Status {
  channel: string;
  provider: string;
  config: Record<string, unknown>;
  configured: boolean;
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
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        isActive: true,
      });
      setSecret('');
      setMsg('Guardado.');
      onSaved();
    } catch {
      setMsg('No se pudo guardar.');
    } finally {
      setSaving(false);
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

        {msg && <p className="text-sm text-slate-600">{msg}</p>}
        <Button onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
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
