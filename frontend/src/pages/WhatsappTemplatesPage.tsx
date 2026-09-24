import { FormEvent, useEffect, useState } from 'react';
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

const VAR_EXAMPLE = { v1: '{{1}}', v2: '{{2}}' };

export function WhatsappTemplatesPage() {
  const { t } = useTranslation();
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
      setMsg(t('templates.successMsg'));
      setName('');
      setBody('');
      setExamples([]);
      setFooter('');
      load();
    } catch (err) {
      const detail =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('templates.errorMsg');
      setMsg(Array.isArray(detail) ? detail.join(' ') : String(detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHeader title={t('templates.title')} subtitle={t('templates.subtitle')} />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Crear */}
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">
            {t('templates.newTemplateTitle')}
          </h3>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('templates.nameLabel')} hint={t('templates.nameHint')}>
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
              <Field label={t('templates.categoryLabel')} hint={t('templates.categoryHint')}>
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="MARKETING">{t('templates.categoryMarketing')}</option>
                  <option value="UTILITY">{t('templates.categoryUtility')}</option>
                  <option value="AUTHENTICATION">
                    {t('templates.categoryAuthentication')}
                  </option>
                </Select>
              </Field>
              <Field label={t('templates.languageLabel')}>
                <Select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="es_CL">{t('templates.languageChile')}</option>
                  <option value="es_419">{t('templates.languageLatam')}</option>
                  <option value="es_ES">{t('templates.languageSpain')}</option>
                  <option value="es">{t('templates.languageGeneric')}</option>
                </Select>
              </Field>
            </div>

            <Field
              label={t('templates.bodyLabel')}
              hint={t('templates.bodyHint', VAR_EXAMPLE)}
            >
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="h-28"
                placeholder={t('templates.bodyPlaceholder', VAR_EXAMPLE)}
              />
            </Field>

            {nVars > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">
                  {t('templates.examplesHint')}
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
                        placeholder={
                          i === 0
                            ? t('templates.examplePlaceholderFirst')
                            : t('templates.examplePlaceholder')
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field label={t('templates.footerLabel')} hint={t('templates.footerHint')}>
              <Input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder={t('templates.footerPlaceholder')}
              />
            </Field>

            {msg && <p className="text-sm text-slate-600">{msg}</p>}
            <Button type="submit" disabled={saving}>
              {saving ? t('templates.submitting') : t('templates.submit')}
            </Button>
          </form>
        </Card>

        {/* Lista */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              {t('templates.listTitle')}
            </h3>
            <Button variant="ghost" onClick={load}>
              {t('templates.refresh')}
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t('templates.loadingList')}</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-slate-500">{t('templates.emptyList')}</p>
          ) : (
            <div className="space-y-3">
              {templates.map((t2) => (
                <div
                  key={`${t2.name}-${t2.language}`}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-700">
                      {t2.name}
                    </span>
                    <Badge tone={statusTone(t2.status)}>{t2.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t2.category} · {t2.language}
                  </p>
                  {t2.body && (
                    <p className="mt-2 text-xs text-slate-600">{t2.body}</p>
                  )}
                  {t2.reason && (
                    <p className="mt-2 text-xs text-rose-600">
                      {t('templates.rejectionReason', { reason: t2.reason })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-400">{t('templates.approvalHint')}</p>
        </Card>
      </div>
    </div>
  );
}
