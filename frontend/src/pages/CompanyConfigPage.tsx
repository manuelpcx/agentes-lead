import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Button, Card, Field, Input, PageHeader, Textarea } from '../components/ui';
import type { CompanyConfig } from '../types';

export function CompanyConfigPage() {
  const [company, setCompany] = useState<CompanyConfig | null>(null);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get('/panel/company').then((r) => {
      const c: CompanyConfig = r.data;
      setCompany(c);
      setName(c.name);
      setTimezone(c.timezone);
      setBusinessHours(JSON.stringify(c.businessHours ?? {}, null, 2));
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
    await api.patch('/panel/company', { name, timezone, businessHours: hours });
    setMsg('Guardado.');
  };

  if (!company) {
    return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <PageHeader
        title="Configuración de la empresa"
        subtitle="Nombre, zona horaria y horario hábil de atención."
      />
      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
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
