import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Button, Field, Input, Modal, Select } from './ui';
import type {
  LeadDetail,
  LeadQualification,
  LeadStatus,
} from '../types';

const LEAD_STATES: LeadStatus[] = [
  'NUEVO',
  'CONTACTADO',
  'EN_CONVERSACION',
  'AGENDADO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
  'ESCALADO_HUMANO',
];
const QUALIFICATIONS: LeadQualification[] = ['FRIO', 'TIBIO', 'CALIENTE'];
const CHANNELS = ['whatsapp', 'email', 'call'];

type LeadFields = LeadDetail['lead'];

interface FormState {
  name: string;
  phone: string;
  email: string;
  source: string;
  campaign: string;
  status: LeadStatus;
  qualification: string;
  qualificationReason: string;
  preferredChannel: string;
  timezone: string;
}

function toForm(lead?: LeadFields): FormState {
  return {
    name: lead?.name ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    source: lead?.source ?? '',
    campaign: lead?.campaign ?? '',
    status: lead?.status ?? 'NUEVO',
    qualification: lead?.qualification ?? '',
    qualificationReason: lead?.qualificationReason ?? '',
    preferredChannel: lead?.preferredChannel ?? '',
    timezone: lead?.timezone ?? '',
  };
}

/** Solo manda los campos con valor; los vacíos quedan fuera del payload. */
function trimmed(value: string): string | undefined {
  const v = value.trim();
  return v === '' ? undefined : v;
}

/**
 * Alta y edición manual de la ficha del lead — el "guardado rápido" del CRM
 * propio. Al crear solo pide datos de contacto; al editar abre además el
 * estado del embudo y la calificación.
 */
export function LeadFormModal({
  lead,
  onClose,
  onSaved,
}: {
  /** Sin lead = alta nueva. */
  lead?: LeadFields;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(lead);
  const [form, setForm] = useState<FormState>(() => toForm(lead));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEdit && !form.phone.trim() && !form.email.trim()) {
      setError(t('crm.requireContact'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: trimmed(form.name),
        phone: trimmed(form.phone),
        email: trimmed(form.email),
        source: trimmed(form.source),
        campaign: trimmed(form.campaign),
        preferredChannel: trimmed(form.preferredChannel),
        timezone: trimmed(form.timezone),
        ...(isEdit
          ? {
              status: form.status,
              qualification: trimmed(form.qualification),
              qualificationReason: trimmed(form.qualificationReason),
            }
          : {}),
      };
      if (isEdit && lead) {
        await api.patch(`/panel/leads/${lead.id}`, payload);
      } else {
        await api.post('/panel/leads', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      const detail = (err as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      setError(
        Array.isArray(detail)
          ? detail.join(' · ')
          : (detail ?? t('crm.error')),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? t('crm.editLeadTitle') : t('crm.createLeadTitle')}
      onClose={onClose}
      wide={isEdit}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('crm.name')}>
            <Input
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('crm.phone')} hint={t('crm.phoneHint')}>
            <Input
              value={form.phone}
              onChange={(e) => set('phone')(e.target.value)}
              placeholder="+56912345678"
              className="font-mono text-xs"
            />
          </Field>
          <Field label={t('crm.email')}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
            />
          </Field>
          <Field label={t('crm.preferredChannel')}>
            <Select
              value={form.preferredChannel}
              onChange={(e) => set('preferredChannel')(e.target.value)}
            >
              <option value="">{t('crm.channelAny')}</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`channels.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('crm.source')}>
            <Input
              value={form.source}
              onChange={(e) => set('source')(e.target.value)}
            />
          </Field>
          <Field label={t('crm.campaign')}>
            <Input
              value={form.campaign}
              onChange={(e) => set('campaign')(e.target.value)}
            />
          </Field>
        </div>

        {isEdit && (
          <div className="grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
            <Field label={t('crm.status')}>
              <Select
                value={form.status}
                onChange={(e) => set('status')(e.target.value)}
              >
                {LEAD_STATES.map((s) => (
                  <option key={s} value={s}>
                    {t(`leadStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('crm.qualification')}>
              <Select
                value={form.qualification}
                onChange={(e) => set('qualification')(e.target.value)}
              >
                <option value="">{t('crm.qualificationNone')}</option>
                {QUALIFICATIONS.map((q) => (
                  <option key={q} value={q}>
                    {t(`qualification.${q}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('crm.qualificationReason')}>
                <Input
                  value={form.qualificationReason}
                  onChange={(e) => set('qualificationReason')(e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={saving}>
            {saving
              ? isEdit
                ? t('crm.saving')
                : t('crm.creating')
              : isEdit
                ? t('crm.save')
                : t('crm.create')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('crm.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
