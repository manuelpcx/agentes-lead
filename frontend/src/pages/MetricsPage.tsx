import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Button, Card, PageHeader, Select } from '../components/ui';
import type { MetricItem } from '../types';

const LABELS: Record<string, string> = {
  leads_nuevos: 'Leads nuevos',
  citas_agendadas: 'Citas agendadas',
  mensajes_entrantes: 'Mensajes recibidos',
  mensajes_salientes: 'Mensajes enviados',
  escalamientos: 'Escalamientos',
};

export function MetricsPage() {
  const [days, setDays] = useState(7);
  const [metrics, setMetrics] = useState<MetricItem[]>([]);

  const load = useCallback(async () => {
    const { data } = await api.get('/panel/metrics', { params: { days } });
    setMetrics(data);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const recompute = async () => {
    await api.post('/panel/metrics/recompute');
    load();
  };

  // Totales del rango por tipo.
  const totals: Record<string, number> = {};
  for (const m of metrics) {
    totals[m.metricType] = (totals[m.metricType] ?? 0) + m.value;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Métricas"
        subtitle={`Actividad de los últimos ${days} días.`}
        actions={
          <>
            <Select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-auto"
            >
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  Últimos {d} días
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={recompute}>
              Recalcular hoy
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.keys(LABELS).map((k) => (
          <Card key={k} className="p-4">
            <div className="text-3xl font-semibold tracking-tight text-slate-900">
              {totals[k] ?? 0}
            </div>
            <div className="mt-1 text-xs font-medium text-slate-500">
              {LABELS[k]}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Detalle por día
        </h3>
        {metrics.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Sin datos en el rango. Usa “Recalcular hoy”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Métrica</th>
                  <th className="pb-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 text-slate-600">
                      {m.date.slice(0, 10)}
                    </td>
                    <td className="py-1.5 text-slate-700">
                      {LABELS[m.metricType] ?? m.metricType}
                    </td>
                    <td className="py-1.5 text-right font-medium text-slate-800">
                      {m.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
