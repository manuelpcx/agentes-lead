import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';

interface Template {
  name: string;
  language: string;
  category: string;
  status: string;
  reason?: string;
  body?: string;
  createTime?: string;
}

/** Cuenta las variables {{1}}, {{2}}, … del cuerpo (devuelve el índice máximo). */
function countVars(body: string): number {
  let max = 0;
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Color del badge según el estado de aprobación de Meta. */
function statusTone(status: string): 'green' | 'amber' | 'rose' | 'slate' {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return 'green';
  if (s === 'PENDING' || s === 'IN_APPEAL') return 'amber';
  if (s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED') return 'rose';
  return 'slate';
}

export function WhatsappTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('MARKETING');
  const [language, setLanguage] = useState('es_CL');
  const [body, setBody] = useState('');
  const [examples, setExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get('/panel/whatsapp/templates')
      .then((r) => setTemplates(r.data))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const nVars = countVars(body);
  // Ajusta la cantidad de campos de ejemplo a las variables detectadas.
  useEffect(() => {
    setExamples((prev) => {
      const next = prev.slice(0, nVars);
      while (next.length < nVars) next.push('');
      return next;
    });
  }, [nVars]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      await api.post('/panel/whatsapp/templates', {
        name: name.trim(),
        language: language.trim(),
        category,
        body,
        examples: examples.map((x) => x.trim()),
        footer: footer.trim() || undefined,
      });
      setMsg('Plantilla enviada a aprobación de Meta. Aparecerá como PENDING.');
      setName('');
      setBody('');
      setExamples([]);
      setFooter('');
      load();
    } catch (err) {
      const detail =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo crear la plantilla.';
      setMsg(Array.isArray(detail) ? detail.join(' ') : String(detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHeader
        title="Plantillas de WhatsApp"
        subtitle="Crea plantillas y envíalas a aprobación de Meta. Se usan para contactar fuera de la ventana de 24h."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Crear */}
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">
            Nueva plantilla
          </h3>
          <form onSubmit={submit} className="space-y-4">
            <Field
              label="Nombre"
              hint="Solo minúsculas, números y guion bajo. Ej: recordatorio_pago."
            >
              <Input
                value={name}
                onChange={(e) =>
                  setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                }
                placeholder="recordatorio_pago"
                className="font-mono text-xs"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Categoría" hint="Re-enganche/promo = Marketing.">
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </Select>
              </Field>
              <Field label="Idioma">
                <Select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="es_CL">Español (CHL)</option>
                  <option value="es_419">Español (LatAm)</option>
                  <option value="es_ES">Español (España)</option>
                  <option value="es">Español</option>
                </Select>
              </Field>
            </div>

            <Field
              label="Cuerpo"
              hint="Usa {{1}}, {{2}}, … para las variables. Ej: Hola {{1}}, te contactamos de {{2}}."
            >
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="h-28"
                placeholder="Hola {{1}}, te contactamos de {{2}} por tu solicitud."
              />
            </Field>

            {nVars > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">
                  Ejemplos (Meta los exige para revisar):
                </p>
                <div className="space-y-2">
                  {examples.map((ex, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 font-mono text-xs text-slate-500">
                        {`{{${i + 1}}}`}
                      </span>
                      <Input
                        value={ex}
                        onChange={(e) => {
                          const next = [...examples];
                          next[i] = e.target.value;
                          setExamples(next);
                        }}
                        placeholder={i === 0 ? 'Jesús' : 'Ejemplo'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field label="Pie (opcional)" hint="Texto fijo al final, sin variables.">
              <Input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Equipo de Cobranza"
              />
            </Field>

            {msg && <p className="text-sm text-slate-600">{msg}</p>}
            <Button type="submit" disabled={saving}>
              {saving ? 'Enviando…' : 'Crear y enviar a aprobación'}
            </Button>
          </form>
        </Card>

        {/* Lista */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Plantillas y estado
            </h3>
            <Button variant="ghost" onClick={load}>
              Actualizar
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aún no hay plantillas (o falta configurar YCloud). Crea una a la
              izquierda.
            </p>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <div
                  key={`${t.name}-${t.language}`}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-700">
                      {t.name}
                    </span>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t.category} · {t.language}
                  </p>
                  {t.body && (
                    <p className="mt-2 text-xs text-slate-600">{t.body}</p>
                  )}
                  {t.reason && (
                    <p className="mt-2 text-xs text-rose-600">
                      Rechazo: {t.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-400">
            La aprobación la decide Meta (suele tardar de minutos a ~24h). Usa
            “Actualizar” para ver el estado.
          </p>
        </Card>
      </div>
    </div>
  );
}
