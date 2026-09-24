import { ChangeEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Badge, Button, Field, Input, Modal, Select, cn } from './ui';
import type { ImportField, ImportPreview, ImportResult } from '../types';

/** Campos de la ficha a los que se puede apuntar una columna del archivo. */
const FIELDS: ImportField[] = [
  'name',
  'phone',
  'email',
  'source',
  'campaign',
  'status',
  'externalId',
];

/** Códigos de país del selector (mismos que acepta el backend). */
const PREFIXES = ['+56', '+52', '+57', '+51', '+54', '+34', '+1'];

type Step = 'file' | 'map' | 'done';

function errorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { message?: string } } })
    .response?.data?.message;
  return Array.isArray(detail) ? detail.join(' · ') : (detail ?? fallback);
}

/**
 * Importación de la base de leads del CRM anterior, en tres pasos: elegir el
 * archivo, confirmar qué columna es qué, y ver el resultado.
 *
 * El paso del medio existe a propósito: adivinamos el mapeo, pero traerse
 * miles de contactos ajenos suponiendo cuál columna es el teléfono es
 * exactamente el error que no queremos cometer en silencio.
 */
export function ImportLeadsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opciones del paso de mapeo.
  const [mapping, setMapping] = useState<Record<string, ImportField | ''>>({});
  const [prefix, setPrefix] = useState('+56');
  const [duplicates, setDuplicates] = useState<'update' | 'skip'>('update');
  const [contactar, setContactar] = useState(false);
  const [source, setSource] = useState('');

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', picked);
      const { data } = await api.post<ImportPreview>(
        '/panel/leads/import/preview',
        form,
      );
      setPreview(data);
      setMapping(
        Object.fromEntries(
          Object.entries(data.mapping).map(([header, field]) => [
            header,
            field ?? '',
          ]),
        ),
      );
      setPrefix(data.suggestedPrefix);
      setStep('map');
    } catch (err) {
      setError(errorMessage(err, t('import.readError')));
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const assigned = new Set(Object.values(mapping).filter(Boolean));
  const canImport = assigned.has('phone') || assigned.has('email');

  const submit = async () => {
    if (!file || !canImport) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mapping', JSON.stringify(mapping));
      form.append('phonePrefix', prefix);
      form.append('duplicates', duplicates);
      form.append('scheduleFirstContact', String(contactar));
      if (source.trim()) form.append('source', source.trim());
      const { data } = await api.post<ImportResult>('/panel/leads/import', form);
      setResult(data);
      setStep('done');
      onImported();
    } catch (err) {
      setError(errorMessage(err, t('import.importError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('import.title')} onClose={onClose} wide>
      {step === 'file' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('import.intro')}</p>
          <ol className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            <li>{t('import.howto1')}</li>
            <li>{t('import.howto2')}</li>
            <li>{t('import.howto3')}</li>
          </ol>
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed',
              'border-slate-300 bg-slate-50/60 px-4 py-10 text-center transition',
              'hover:border-brand-300 hover:bg-brand-50/40',
            )}
          >
            <span className="text-sm font-medium text-slate-700">
              {busy ? t('import.reading') : t('import.pickFile')}
            </span>
            <span className="text-xs text-slate-400">{t('import.csvOnly')}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={pickFile}
              disabled={busy}
            />
          </label>
        </div>
      )}

      {step === 'map' && preview && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('import.foundRows', { count: preview.totalRows })}
          </p>
          {preview.truncated > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t('import.truncated', { count: preview.truncated })}
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {t('import.columnHeader')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('import.sampleHeader')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('import.fieldHeader')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.headers.map((header, i) => {
                  const current = mapping[header] ?? '';
                  return (
                    <tr key={header}>
                      <td className="px-3 py-1.5 font-medium text-slate-700">
                        {header}
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-1.5 text-slate-400">
                        {preview.sample[0]?.[i] || '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <Select
                          value={current}
                          onChange={(e) =>
                            setMapping((m) => ({
                              ...m,
                              [header]: e.target.value as ImportField | '',
                            }))
                          }
                          className="py-1 text-xs"
                        >
                          <option value="">{t('import.fieldIgnore')}</option>
                          {FIELDS.map((f) => (
                            <option
                              key={f}
                              value={f}
                              disabled={assigned.has(f) && current !== f}
                            >
                              {t(`import.fields.${f}`)}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('import.prefix')} hint={t('import.prefixHint')}>
              <Select
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              >
                {PREFIXES.map((p) => (
                  <option key={p} value={p}>
                    {p} · {t(`import.countries.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('import.duplicates')}>
              <Select
                value={duplicates}
                onChange={(e) =>
                  setDuplicates(e.target.value as 'update' | 'skip')
                }
              >
                <option value="update">{t('import.duplicatesUpdate')}</option>
                <option value="skip">{t('import.duplicatesSkip')}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('import.source')} hint={t('import.sourceHint')}>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t('import.sourcePlaceholder')}
                />
              </Field>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <input
              type="checkbox"
              checked={contactar}
              onChange={(e) => setContactar(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span className="text-xs text-amber-800">
              <span className="block font-medium">
                {t('import.contactLabel')}
              </span>
              {t('import.contactHint')}
            </span>
          </label>

          {!canImport && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
              {t('import.needContactColumn')}
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy || !canImport}>
              {busy
                ? t('import.importing')
                : t('import.importCta', { count: preview.totalRows })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStep('file');
                setFile(null);
                setPreview(null);
              }}
              disabled={busy}
            >
              {t('import.changeFile')}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('import.created')} value={result.created} tone="green" />
            <Stat label={t('import.updated')} value={result.updated} tone="brand" />
            <Stat label={t('import.skipped')} value={result.skipped} tone="slate" />
            <Stat label={t('import.failed')} value={result.failed} tone="rose" />
          </div>

          <p className="text-sm text-slate-600">
            {result.scheduledFirstContact
              ? t('import.doneContacting')
              : t('import.doneQuiet')}
          </p>

          {result.errors.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium text-slate-700">
                {t('import.errorsTitle')}
              </h3>
              <ul className="max-h-48 space-y-1 overflow-auto scrollbar-slim rounded-xl border border-slate-200 p-2 text-xs">
                {result.errors.map((e) => (
                  <li key={e.row} className="text-slate-600">
                    <Badge tone="slate">{t('import.line', { row: e.row })}</Badge>{' '}
                    {e.reason}
                  </li>
                ))}
              </ul>
              {result.failed > result.errors.length && (
                <p className="mt-1 text-xs text-slate-400">
                  {t('import.moreErrors', {
                    count: result.failed - result.errors.length,
                  })}
                </p>
              )}
            </div>
          )}

          <Button onClick={onClose}>{t('import.close')}</Button>
        </div>
      )}
    </Modal>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'green' | 'brand' | 'slate' | 'rose';
}) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    brand: 'bg-brand-50 text-brand-700',
    slate: 'bg-slate-100 text-slate-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className={cn('rounded-xl px-3 py-2 text-center', tones[tone])}>
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  );
}
