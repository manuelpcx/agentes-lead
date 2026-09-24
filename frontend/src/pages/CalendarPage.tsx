import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { AppointmentModal } from '../components/AppointmentModal';
import { Button, Card, PageHeader, cn } from '../components/ui';
import { ChevronLeftIcon } from '../components/icons';
import type { AppointmentStatus, AppointmentWithLead } from '../types';

/** Tono de cada estado de cita, para leer el mes de un vistazo. */
const STATUS_TONE: Record<AppointmentStatus, string> = {
  PROGRAMADA: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  CONFIRMADA: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  CANCELADA: 'bg-slate-100 text-slate-400 line-through hover:bg-slate-200',
  COMPLETADA: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
};

/** Lunes de la semana en que cae `date` (la grilla empieza en lunes). */
function startOfGrid(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const weekday = (first.getDay() + 6) % 7; // 0 = lunes
  return new Date(first.getFullYear(), first.getMonth(), 1 - weekday);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calendario mensual del CRM propio: muestra las citas que agenda el agente y
 * las que agenda un humano, sobre el mismo modelo `Appointment`.
 */
export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const [cursor, setCursor] = useState(() => new Date());
  const [appointments, setAppointments] = useState<AppointmentWithLead[]>([]);
  const [editing, setEditing] = useState<AppointmentWithLead | null>(null);
  const [creatingOn, setCreatingOn] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  const weekdays = t('calendar.weekdays', { returnObjects: true }) as string[];
  const months = t('calendar.months', { returnObjects: true }) as string[];

  // 42 casillas = 6 semanas, para que la grilla no cambie de alto entre meses.
  const days = useMemo(() => {
    const start = startOfGrid(cursor);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const load = useCallback(async () => {
    const from = days[0];
    const to = new Date(days[days.length - 1]);
    to.setDate(to.getDate() + 1);
    const { data } = await api.get('/panel/appointments', {
      params: { from: from.toISOString(), to: to.toISOString() },
    });
    setAppointments(data);
  }, [days]);

  useEffect(() => {
    load().catch(() => setAppointments([]));
  }, [load, nonce]);

  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentWithLead[]>();
    for (const appt of appointments) {
      const d = new Date(appt.startAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(key, [...(map.get(key) ?? []), appt]);
    }
    return map;
  }, [appointments]);

  const today = new Date();
  const shiftMonth = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        actions={
          <Button onClick={() => setCreatingOn(new Date())}>
            {t('calendar.newAppointment')}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {months[cursor.getMonth()]} {cursor.getFullYear()}
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label={t('calendar.prevMonth')}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCursor(new Date())}
            >
              {t('calendar.today')}
            </Button>
            <button
              onClick={() => shiftMonth(1)}
              aria-label={t('calendar.nextMonth')}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100"
            >
              <ChevronLeftIcon className="h-4 w-4 rotate-180" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/60">
          {weekdays.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayAppts = byDay.get(key) ?? [];
            const isCurrentMonth = day.getMonth() === cursor.getMonth();
            const isToday = sameDay(day, today);
            return (
              <div
                key={key}
                className={cn(
                  'min-h-[5.5rem] border-b border-r border-slate-100 p-1.5 last:border-r-0',
                  !isCurrentMonth && 'bg-slate-50/40',
                )}
              >
                <button
                  onClick={() => setCreatingOn(day)}
                  className={cn(
                    'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs transition',
                    isToday
                      ? 'bg-brand-600 font-semibold text-white'
                      : isCurrentMonth
                        ? 'text-slate-600 hover:bg-slate-100'
                        : 'text-slate-300 hover:bg-slate-100',
                  )}
                  title={t('calendar.newAppointment')}
                >
                  {day.getDate()}
                </button>
                <div className="space-y-1">
                  {dayAppts.map((appt) => (
                    <button
                      key={appt.id}
                      onClick={() => setEditing(appt)}
                      className={cn(
                        'block w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] transition',
                        STATUS_TONE[appt.status],
                      )}
                      title={`${appt.title} · ${appt.lead.name ?? appt.lead.phone ?? ''}`}
                    >
                      <span className="font-medium">
                        {timeLabel(appt.startAt, i18n.language)}
                      </span>{' '}
                      {appt.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {appointments.length === 0 && (
        <p className="mt-3 text-center text-sm text-slate-400">
          {t('calendar.empty')}
        </p>
      )}

      {(editing || creatingOn) && (
        <AppointmentModal
          appointment={editing ?? undefined}
          defaultDate={creatingOn ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreatingOn(null);
          }}
          onSaved={() => setNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}
