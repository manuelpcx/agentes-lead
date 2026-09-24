import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import type {
  KnowledgeDoc,
  SearchResultItem,
  StructuredFactItem,
} from '../types';

const CATEGORIES = ['PRECIO', 'SERVICIO', 'HORARIO', 'POLITICA', 'OTRO'];
const JSON_EXAMPLE = '{"monto":25000}';

export function KnowledgePage() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [facts, setFacts] = useState<StructuredFactItem[]>([]);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);

  const [docForm, setDocForm] = useState({ title: '', content: '' });
  const [factForm, setFactForm] = useState({
    key: '',
    category: 'PRECIO',
    value: '',
  });
  const [query, setQuery] = useState('');
  // Lo eliminado se oculta por defecto. La fila no se borra de la base (los
  // datos guardan su historial de versiones), pero el agente ya no la usa, y
  // dejarla a la vista llenaba la lista de versiones viejas.
  const [verEliminados, setVerEliminados] = useState(false);

  const load = useCallback(async () => {
    const [d, f] = await Promise.all([
      api.get('/panel/knowledge/documents').then((r) => r.data),
      api.get('/panel/knowledge/facts').then((r) => r.data),
    ]);
    setDocs(d);
    setFacts(f);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createDoc = async (e: FormEvent) => {
    e.preventDefault();
    if (!docForm.title || !docForm.content) return;
    await api.post('/panel/knowledge/documents', docForm);
    setDocForm({ title: '', content: '' });
    load();
  };

  const deleteDoc = async (id: string, title: string) => {
    if (!confirm(t('knowledge.confirmDeleteDoc', { title }))) return;
    await api.delete(`/panel/knowledge/documents/${id}`);
    load();
  };

  const deleteFact = async (id: string, key: string) => {
    if (!confirm(t('knowledge.confirmDeleteFact', { key }))) return;
    await api.delete(`/panel/knowledge/facts/${id}`);
    load();
  };

  const createFact = async (e: FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(factForm.value);
    } catch {
      alert(t('knowledge.invalidJson', { example: JSON_EXAMPLE }));
      return;
    }
    await api.post('/panel/knowledge/facts', {
      key: factForm.key,
      category: factForm.category,
      value: parsed,
    });
    setFactForm({ key: '', category: 'PRECIO', value: '' });
    load();
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/panel/knowledge/search', {
      query,
      minSimilarity: 0.05,
    });
    setResults(data);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title={t('knowledge.title')}
        subtitle={t('knowledge.subtitle')}
        actions={
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={verEliminados}
              onChange={(e) => setVerEliminados(e.target.checked)}
              className="rounded border-slate-300"
            />
            {t('knowledge.showDeleted')}
          </label>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Documentos */}
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {t('knowledge.docsTitle')}
          </h2>
          <form onSubmit={createDoc} className="mb-3 space-y-2">
            <Input
              placeholder={t('knowledge.titlePlaceholder')}
              value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
            />
            <Textarea
              placeholder={t('knowledge.contentPlaceholder')}
              value={docForm.content}
              onChange={(e) =>
                setDocForm({ ...docForm, content: e.target.value })
              }
              className="h-24"
            />
            <Button size="sm">{t('knowledge.indexBtn')}</Button>
          </form>
          <ul className="space-y-1.5 text-sm">
            {docs
              .filter((d) => verEliminados || d.isActive)
              .map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5"
                >
                  <span
                    className={d.isActive ? '' : 'text-slate-400 line-through'}
                  >
                    {d.title}{' '}
                    <span className="text-xs text-slate-400">
                      ({d.sourceType} v{d.version})
                    </span>
                  </span>
                  {d.isActive && (
                    <button
                      onClick={() => deleteDoc(d.id, d.title)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </Card>

        {/* Hechos estructurados */}
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {t('knowledge.factsTitle')}
          </h2>
          <form onSubmit={createFact} className="mb-3 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder={t('knowledge.keyPlaceholder')}
                value={factForm.key}
                onChange={(e) =>
                  setFactForm({ ...factForm, key: e.target.value })
                }
              />
              <Select
                value={factForm.category}
                onChange={(e) =>
                  setFactForm({ ...factForm, category: e.target.value })
                }
                className="w-auto"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`knowledge.categories.${c}`)}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              placeholder={t('knowledge.valuePlaceholder', { example: JSON_EXAMPLE })}
              value={factForm.value}
              onChange={(e) =>
                setFactForm({ ...factForm, value: e.target.value })
              }
            />
            <Button size="sm">{t('knowledge.saveFactBtn')}</Button>
          </form>
          <ul className="space-y-1.5 text-sm">
            {facts
              .filter((f) => verEliminados || f.isActive)
              .map((f) => (
                <li
                  key={f.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5"
                >
                  <span
                    className={
                      f.isActive ? 'min-w-0' : 'min-w-0 text-slate-400 line-through'
                    }
                  >
                    <span className="font-mono text-xs text-brand-700">
                      {f.key}
                    </span>{' '}
                    = {JSON.stringify(f.value)}
                  </span>
                  {f.isActive && (
                    <button
                      onClick={() => deleteFact(f.id, f.key)}
                      className="shrink-0 text-xs text-rose-600 hover:underline"
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </Card>

        {/* Buscador de prueba */}
        <Card className="p-4 md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {t('knowledge.searchTitle')}
          </h2>
          <form onSubmit={search} className="mb-3 flex gap-2">
            <Input
              placeholder={t('knowledge.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button>{t('knowledge.searchBtn')}</Button>
          </form>
          {results && (
            <ul className="space-y-2 text-sm">
              {results.length === 0 && (
                <li className="text-slate-400">{t('knowledge.noResults')}</li>
              )}
              {results.map((r) => (
                <li
                  key={r.chunkId}
                  className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                >
                  <div className="mb-0.5 text-xs text-slate-400">
                    {r.documentTitle} · {t('knowledge.similarity')}{' '}
                    {r.similarity.toFixed(2)}
                  </div>
                  {r.content}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
