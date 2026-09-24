import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import type { CompanyConfig } from '../types';

/** Lee un campo string de channelsConfig.whatsapp (si existe). */
function readWhatsappField(
  cfg: Record<string, unknown> | undefined,
  field: string,
): string {
  const wa = (cfg?.whatsapp ?? {}) as Record<string, unknown>;
  return typeof wa[field] === 'string' ? (wa[field] as string) : '';
}

/** Lee un campo de channelsConfig.voice (si existe). */
function readVoiceField(
  cfg: Record<string, unknown> | undefined,
  field: string,
): string {
  const v = (cfg?.voice ?? {}) as Record<string, unknown>;
  const val = v[field];
  return typeof val === 'string' || typeof val === 'number' ? String(val) : '';
}

interface VoiceOption {
  voiceId: string;
  name: string;
  provider?: string;
  gender?: string;
  accent?: string;
  previewUrl?: string;
}

const HOURS_EXAMPLE = '{"days":{"mon":[{"start":"09:00","end":"18:00"}]}}';
const GREETING_EXAMPLE = { v1: '{{nombre}}', v2: '{{empresa}}' };

export function CompanyConfigPage() {
  const { t } = useTranslation();
  const [company, setCompany] = useState<CompanyConfig | null>(null);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappId, setWhatsappId] = useState('');
  // Voz
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [voiceTone, setVoiceTone] = useState('');
  const [voiceBegin, setVoiceBegin] = useState('');
  const [voiceLang, setVoiceLang] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get('/panel/company').then((r) => {
      const c: CompanyConfig = r.data;
      setCompany(c);
      setName(c.name);
      setTimezone(c.timezone);
      setBusinessHours(JSON.stringify(c.businessHours ?? {}, null, 2));
      setWhatsappNumber(readWhatsappField(c.channelsConfig, 'phoneNumber'));
      setWhatsappId(readWhatsappField(c.channelsConfig, 'phoneNumberId'));
      setVoiceId(readVoiceField(c.channelsConfig, 'voiceId'));
      setVoiceTone(readVoiceField(c.channelsConfig, 'tone'));
      setVoiceBegin(readVoiceField(c.channelsConfig, 'beginMessage'));
      setVoiceLang(readVoiceField(c.channelsConfig, 'language'));
      setVoiceSpeed(readVoiceField(c.channelsConfig, 'speed') || '1');
    });
    api
      .get('/panel/voice/voices')
      .then((r) => setVoices(r.data))
      .catch(() => setVoices([]));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    let hours: Record<string, unknown>;
    try {
      hours = JSON.parse(businessHours || '{}');
    } catch {
      setMsg(t('companyConfig.invalidHours'));
      return;
    }
    const speedNum = Number(voiceSpeed);
    // Preserva el resto de channelsConfig y actualiza WhatsApp + Voz.
    const channelsConfig = {
      ...(company?.channelsConfig ?? {}),
      whatsapp: {
        ...((company?.channelsConfig?.whatsapp as Record<string, unknown>) ??
          {}),
        phoneNumber: whatsappNumber.trim() || undefined,
        phoneNumberId: whatsappId.trim() || undefined,
      },
      voice: {
        voiceId: voiceId.trim() || undefined,
        tone: voiceTone.trim() || undefined,
        beginMessage: voiceBegin.trim() || undefined,
        language: voiceLang.trim() || undefined,
        speed: Number.isFinite(speedNum) && speedNum > 0 ? speedNum : undefined,
      },
    };
    await api.patch('/panel/company', {
      name,
      timezone,
      businessHours: hours,
      channelsConfig,
    });
    setMsg(t('companyConfig.saved'));
  };

  if (!company) {
    return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;
  }

  const selectedVoice = voices.find((v) => v.voiceId === voiceId);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <PageHeader title={t('companyConfig.title')} subtitle={t('companyConfig.subtitle')} />
      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          <Field
            label={t('companyConfig.companyIdLabel')}
            hint={t('companyConfig.companyIdHint')}
          >
            <Input value={company.id} readOnly className="bg-slate-50 font-mono text-xs" />
          </Field>

          <Field label={t('companyConfig.nameLabel')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label={t('companyConfig.timezoneLabel')}>
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>

          <Field
            label={t('companyConfig.whatsappNumberLabel')}
            hint={t('companyConfig.whatsappNumberHint')}
          >
            <Input
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+56911111111"
              className="font-mono text-xs"
            />
          </Field>

          <Field
            label={t('companyConfig.whatsappIdLabel')}
            hint={t('companyConfig.whatsappIdHint')}
          >
            <Input
              value={whatsappId}
              onChange={(e) => setWhatsappId(e.target.value)}
              placeholder="ej. 123456789012345"
              className="font-mono text-xs"
            />
          </Field>

          <Field
            label={t('companyConfig.businessHoursLabel')}
            hint={t('companyConfig.businessHoursHint', { example: HOURS_EXAMPLE })}
          >
            <Textarea
              value={businessHours}
              onChange={(e) => setBusinessHours(e.target.value)}
              className="h-40 font-mono text-xs"
            />
          </Field>

          {/* ── Voz del agente (llamadas) ── */}
          <div className="border-t border-slate-200 pt-5">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">
              {t('companyConfig.voiceSectionTitle')}
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              {t('companyConfig.voiceSectionHint')}
            </p>

            <Field
              label={t('companyConfig.voiceLabel')}
              hint={
                voices.length
                  ? t('companyConfig.voiceHintWithCatalog')
                  : t('companyConfig.voiceHintWithoutCatalog')
              }
            >
              {voices.length ? (
                <Select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  <option value="">{t('companyConfig.voiceDefaultOption')}</option>
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                      {v.gender ? ` · ${v.gender === 'female' ? 'F' : 'M'}` : ''}
                      {v.accent ? ` · ${v.accent}` : ''}
                      {v.provider ? ` · ${v.provider}` : ''}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder="voice_id (ej. 11labs-Adrian)"
                  className="font-mono text-xs"
                />
              )}
            </Field>

            {selectedVoice?.previewUrl && (
              <audio
                controls
                src={selectedVoice.previewUrl}
                className="mb-4 w-full"
              >
                {t('companyConfig.voicePreviewUnsupported')}
              </audio>
            )}

            <Field label={t('companyConfig.toneLabel')} hint={t('companyConfig.toneHint')}>
              <Textarea
                value={voiceTone}
                onChange={(e) => setVoiceTone(e.target.value)}
                className="h-24"
                placeholder={t('companyConfig.tonePlaceholder')}
              />
            </Field>

            <Field
              label={t('companyConfig.greetingLabel')}
              hint={t('companyConfig.greetingHint', GREETING_EXAMPLE)}
            >
              <Input
                value={voiceBegin}
                onChange={(e) => setVoiceBegin(e.target.value)}
                placeholder={t('companyConfig.greetingPlaceholder', GREETING_EXAMPLE)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('companyConfig.languageLabel')}>
                <Select
                  value={voiceLang}
                  onChange={(e) => setVoiceLang(e.target.value)}
                >
                  <option value="">{t('companyConfig.languageDefault')}</option>
                  <option value="es-419">{t('companyConfig.languageLatam')}</option>
                  <option value="es-ES">{t('companyConfig.languageSpain')}</option>
                  <option value="multi">{t('companyConfig.languageMulti')}</option>
                </Select>
              </Field>

              <Field label={t('companyConfig.speedLabel')} hint={t('companyConfig.speedHint')}>
                <Input
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={voiceSpeed}
                  onChange={(e) => setVoiceSpeed(e.target.value)}
                />
              </Field>
            </div>
          </div>

          {msg && <p className="text-sm text-slate-600">{msg}</p>}
          <Button type="submit">{t('companyConfig.save')}</Button>
        </form>
      </Card>
    </div>
  );
}
