import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Button, Card, Field, Input, PageHeader, Textarea } from '../components/ui';
import type { CompanyConfig } from '../types';

/** Lee el phoneNumberId de WhatsApp guardado en channelsConfig (si existe). */
function readWhatsappId(cfg: Record<string, unknown> | undefined): string {
  const wa = (cfg?.whatsapp ?? {}) as Record<string, unknown>;
  return typeof wa.phoneNumberId === 'string' ? wa.phoneNumberId : '';
}

export function CompanyConfigPage() {
  const [company, setCompany] = useState<CompanyConfig | null>(null);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [whatsappId, setWhatsappId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get('/panel/company').then((r) => {
      const c: CompanyConfig = r.data;
      setCompany(c);
      setName(c.name);
      setTimezone(c.timezone);
      setBusinessHours(JSON.stringify(c.businessHours ?? {}, null, 2));
      setWhatsappId(readWhatsappId(c.channelsConfig));
    });
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    let hours: Record<string, unknown>;
    try {
      hours = JSON.parse(businessHours || '{}');
    } catch {
      setMsg('El horario debe ser JSON válido.');
      return;
    }
    // Preserva el resto de channelsConfig y actualiza solo el número de WhatsApp.
    const channelsConfig = {
      ...(company?.channelsConfig ?? {}),
      whatsapp: {
        ...((company?.channelsConfig?.whatsapp as Record<string, unknown>) ??
          {}),
        phoneNumberId: whatsappId.trim() || undefined,
      },
    };
    await api.patch('/panel/company', {
      name,
      timezone,
      businessHours: hours,
      channelsConfig,
    });
    setMsg('Guardado.');
  };

  if (!company) {
    return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <PageHeader
        title="Configuración de la empresa"
        subtitle="Identidad, horario de atención y canal de WhatsApp."
      />
      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          <Field label="Company ID" hint="Úsalo en el webhook de leads (X-Company-Id).">
            <Input value={company.id} readOnly className="bg-slate-50 font-mono text-xs" />
          </Field>

          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Zona horaria (IANA)">
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>

          <Field
            label="WhatsApp Phone Number ID"
            hint="El ID del número de Meta (WhatsApp → API Setup). Mapea los mensajes entrantes a esta empresa."
          >
            <Input
              value={whatsappId}
              onChange={(e) => setWhatsappId(e.target.value)}
              placeholder="ej. 123456789012345"
              className="font-mono text-xs"
            />
          </Field>

          <Field
            label="Horario hábil (JSON)"
            hint='Ej: {"days":{"mon":[{"start":"09:00","end":"18:00"}]}}'
          >
            <Textarea
              value={businessHours}
              onChange={(e) => setBusinessHours(e.target.value)}
              className="h-40 font-mono text-xs"
            />
          </Field>

          {msg && <p className="text-sm text-slate-600">{msg}</p>}
          <Button type="submit">Guardar</Button>
        </form>
      </Card>
    </div>
  );
}
