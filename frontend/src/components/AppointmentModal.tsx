import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Button, Field, Input, Modal, Select, Textarea, cn } from './ui';
import type {
  AppointmentStatus,
  AppointmentWithLead,
  LeadListItem,
} from '../types';

const STATUSES: AppointmentStatus[] = [
  'PROGRAMADA',
  'CONFIRMADA',
  'CANCELADA',
  'COMPLETADA',
];

/** ISO → valor de un <input type="datetime-local"> en hora local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Busca leads por texto para elegir a quién corresponde la cita. */
function LeadPicker({
  value,
  onSelect,
}: {
  value: { id: string; label: string } | null;
  onSelect: (lead: { id: string; label: string } | null) => void;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<LeadListItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || term.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      api
        .get('/panel/leads', { params: { q: term.trim() } })
        .then((r) => setResults(r.data.slice(0, 8)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(id);
  }, [term, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
        <span className="truncate text-slate-800">{value.label}</span>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setTerm('');
            setOpen(true);
          }}
          className="shrink-0 text-xs text-brand-600 hover:text-brand-700"
        >
          {t('common.edit')}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        placeholder={t('calendar.formLeadPlaceholder')}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto scrollbar-slim rounded-xl border border-slate-200 bg-white py-1 shadow-soft">
          {results.map((lead) => {
            const label = lead.name ?? lead.phone ?? lead.email ?? lead.id;
            return (
              <li key={lead.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect({ id: lead.id, label });
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {label}
                  {lead.phone && lead.name && (
                    <span className="ml-2 text-xs text-slate-400">
                      {lead.phone}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Crear o editar una cita del calendario. Editar permite además reagendar y
 * cambiar el estado; el backend vuelve a verificar solapes al mover el horario.
 */
export function AppointmentModal({
  appointment,
  defaultDate,
  onClose,
  onSaved,
}: {
  /** Sin cita = creación nueva. */
  appointment?: AppointmentWithLead;
  /** Día preseleccionado al crear desde una casilla del calendario. */
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(appointment);

  const initialStart = appointment
    ? toLocalInput(appointment.startAt)
    : (() => {
        const d = defaultDate ? new Date(defaultDate) : new Date();
        d.setHours(10, 0, 0, 0);
        return toLocalInput(d.toISOString());
      })();
  const initialEnd = appointment
    ? toLocalInput(appointment.endAt)
    : (() => {
        const d = defaultDate ? new Date(defaultDate) : new Date();
        d.setHours(11, 0, 0, 0);
        return toLocalInput(d.toISOString());
      })();

  const [lead, setLead] = useState<{ id: string; label: string } | null>(
    appointment
      ? {
          id: appointment.lead.id,
          label:
            appointment.lead.name ?? appointment.lead.phone ?? appointment.lead.id,
        }
      : null,
  );
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState(initialEnd);
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [status, setStatus] = useState<AppointmentStatus>(
    appointment?.status ?? 'PROGRAMADA',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEdit && !lead) {
      setError(t('calendar.formLeadRequired'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (isEdit && appointment) {
        await api.patch(`/panel/appointments/${appointment.id}`, {
          ...payload,
          status,
        });
      } else {
        await api.post('/panel/appointments', { ...payload, leadId: lead!.id });
      }
      onSaved();
      onClose();
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { message?: string } } })
        .response;
      const detail = res?.data?.message;
      setError(
        res?.status === 409
          ? t('calendar.conflictError')
          : Array.isArray(detail)
            ? detail.join(' · ')
            : (detail ?? t('calendar.error')),
      );
    } finally {
      setSaving(false);
    }
  };

  const cancelAppointment = async () => {
    if (!appointment || !confirm(t('calendar.confirmCancel'))) return;
    setSaving(true);
    try {
      await api.post(`/panel/appointments/${appointment.id}/cancel`);
      onSaved();
      onClose();
    } catch {
      setError(t('calendar.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? t('calendar.editAppointment') : t('calendar.newAppointment')}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        {!isEdit && (
          <Field label={t('calendar.formLead')}>
            <LeadPicker value={lead} onSelect={setLead} />
          </Field>
        )}

        <Field label={t('calendar.formTitle')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('calendar.formTitlePlaceholder')}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('calendar.formStart')}>
            <Input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
            />
          </Field>
          <Field label={t('calendar.formEnd')}>
            <Input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label={t('calendar.formLocation')}>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('calendar.formLocationPlaceholder')}
          />
        </Field>

        <Field label={t('calendar.formNotes')}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-20"
          />
        </Field>

        {isEdit && (
          <Field label={t('calendar.formStatus')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`calendar.statuses.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className={cn('flex gap-2 pt-1', isEdit && 'justify-between')}>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? t('calendar.saving') : t('calendar.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('calendar.cancel')}
            </Button>
          </div>
          {isEdit && appointment?.status !== 'CANCELADA' && (
            <Button
              type="button"
              variant="danger"
              onClick={cancelAppointment}
              disabled={saving}
            >
              {t('calendar.cancelAppointment')}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
