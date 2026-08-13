import { FormEvent, useCallback, useEffect, useState } from 'react';
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

export function KnowledgePage() {
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

  const deleteDoc = async (id: string) => {
    await api.delete(`/panel/knowledge/documents/${id}`);
    load();
  };

  const createFact = async (e: FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(factForm.value);
    } catch {
      alert('El valor debe ser JSON válido, ej: {"monto":25000}');
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
        title="Conocimiento"
        subtitle="Lo que el agente puede consultar — nunca inventa fuera de esto."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Documentos */}
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Documentos (RAG)
          </h2>
          <form onSubmit={createDoc} className="mb-3 space-y-2">
            <Input
              placeholder="Título"
              value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
            />
            <Textarea
              placeholder="Contenido (texto/markdown)"
              value={docForm.content}
              onChange={(e) =>
                setDocForm({ ...docForm, content: e.target.value })
              }
              className="h-24"
            />
            <Button size="sm">Indexar documento</Button>
          </form>
          <ul className="space-y-1.5 text-sm">
            {docs.map((d) => (
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
                    onClick={() => deleteDoc(d.id)}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    desactivar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {/* Hechos estructurados */}
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Datos (precios, horarios…)
          </h2>
          <form onSubmit={createFact} className="mb-3 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="clave (ej. precio_x)"
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
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
            <Input
              placeholder='valor JSON, ej. {"monto":25000}'
              value={factForm.value}
              onChange={(e) =>
                setFactForm({ ...factForm, value: e.target.value })
              }
            />
            <Button size="sm">Guardar dato</Button>
          </form>
          <ul className="space-y-1.5 text-sm">
            {facts.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5"
              >
                <span className="font-mono text-xs text-brand-700">
                  {f.key}
                </span>{' '}
                = {JSON.stringify(f.value)}
              </li>
            ))}
          </ul>
        </Card>

        {/* Buscador de prueba */}
        <Card className="p-4 md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Pregúntale al conocimiento
          </h2>
          <form onSubmit={search} className="mb-3 flex gap-2">
            <Input
              placeholder="¿qué recuperaría el agente?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button>Buscar</Button>
          </form>
          {results && (
            <ul className="space-y-2 text-sm">
              {results.length === 0 && (
                <li className="text-slate-400">Sin resultados relevantes.</li>
              )}
              {results.map((r) => (
                <li
                  key={r.chunkId}
                  className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                >
                  <div className="mb-0.5 text-xs text-slate-400">
                    {r.documentTitle} · similitud {r.similarity.toFixed(2)}
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
