import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, cn } from '../components/ui';
import { IncidentsCard } from '../components/IncidentsCard';
import type { CompanySummary, DemoCompanyCreated } from '../types';

/**
 * Mantenedor de la plataforma: qué empresas usan la aplicación y cómo, más el
 * alta de cuentas de demostración.
 *
 * A propósito NO muestra conversaciones ni datos de leads: son datos
 * personales de los clientes de nuestros clientes. Acá se ve configuración y
 * uso agregado.
 */
export function PlatformPage() {
  const { t, i18n } = useTranslation();
  const [nonce, setNonce] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const [vozDe, setVozDe] = useState<CompanySummary | null>(null);

  const { data: companies } = usePolling<CompanySummary[]>(
    () => api.get('/platform/companies').then((r) => r.data),
    30_000,
    [nonce],
  );

  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—';

  /** Días desde la última actividad, que es la señal que más dice. */
  const diasSin = (iso: string | null): number | null =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title={t('platform.title')}
        subtitle={t('platform.subtitle')}
        actions={
          <Button type="button" onClick={() => setDemoOpen(true)}>
            {t('platform.newDemo')}
          </Button>
        }
      />

      {!companies ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : companies.length === 0 ? (
        <p className="text-sm text-slate-500">{t('platform.empty')}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">{t('platform.colCompany')}</th>
                <th className="px-4 py-2 font-medium">{t('platform.colChannels')}</th>
                <th className="px-4 py-2 font-medium">{t('platform.colKnowledge')}</th>
                <th className="px-4 py-2 font-medium">{t('platform.colLeads')}</th>
                <th className="px-4 py-2 font-medium">{t('platform.colMessages')}</th>
                <th className="px-4 py-2 font-medium">{t('platform.colVoice')}</th>
                <th className="px-4 py-2 font-medium">{t('platform.colLastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const dias = diasSin(c.ultimaActividad);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{c.name}</div>
                      <div className="text-xs text-slate-400">
                        {c.rut} · {t('platform.users', { count: c.usuarios })} ·{' '}
                        {t('platform.since')} {fecha(c.createdAt)}
                      </div>
                      {!c.isActive && (
                        <Badge className="mt-1 bg-rose-50 text-rose-600">
                          {t('common.inactive')}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {c.canales.length === 0 ? (
                        <span className="text-xs text-amber-600">
                          {t('platform.noChannels')}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {c.canales.map((canal) => (
                            <Badge key={canal}>{canal}</Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {c.conocimiento === 0 ? (
                        <span className="text-xs text-amber-600">
                          {t('platform.noKnowledge')}
                        </span>
                      ) : (
                        c.conocimiento
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {c.leads}
                      {c.leadsRecientes > 0 && (
                        <span className="ml-1 text-xs text-emerald-600">
                          +{c.leadsRecientes}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {c.mensajesRecientes}
                    </td>
                    <td className="px-4 py-2">
                      <VozCelda
                        voz={c.voz}
                        onEdit={() => setVozDe(c)}
                      />
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2',
                        dias === null || dias > 30
                          ? 'text-rose-600'
                          : dias > 7
                            ? 'text-amber-600'
                            : 'text-emerald-600',
                      )}
                    >
                      {dias === null
                        ? t('platform.never')
                        : t('platform.daysAgo', { count: dias })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-slate-400">{t('platform.privacyNote')}</p>

      <IncidentsCard />

      {vozDe && (
        <VoiceLimitModal
          company={vozDe}
          onClose={() => setVozDe(null)}
          onSaved={() => {
            setVozDe(null);
            setNonce((n) => n + 1);
          }}
        />
      )}

      {demoOpen && (
        <DemoModal
          onClose={() => setDemoOpen(false)}
          onCreated={() => setNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** Alta de una cuenta de demo. Las credenciales se muestran UNA vez. */
function DemoModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<DemoCompanyCreated | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<DemoCompanyCreated>(
        '/platform/companies/demo',
        { companyName: companyName.trim(), email: email.trim() },
      );
      setCreada(data);
      onCreated();
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setError(
        status === 409 ? t('platform.emailTaken') : t('common.errorGeneric'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('platform.newDemo')} onClose={onClose}>
      {creada ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t('platform.demoReady', { name: creada.companyName })}
          </p>
          <p className="text-xs text-amber-700">{t('platform.showOnce')}</p>
          <dl className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
            <Credencial label={t('platform.email')} value={creada.email} />
            <Credencial label={t('platform.password')} value={creada.password} />
            <Credencial
              label={t('platform.webhookSecret')}
              value={creada.webhookSecret}
            />
          </dl>
          <Button type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-slate-500">{t('platform.demoHint')}</p>
          <Field label={t('platform.companyName')}>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label={t('platform.email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy || !companyName.trim()}>
              {busy ? t('platform.creating') : t('common.create')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Minutos de voz del mes contra el tope, con el color de lo cerca que está. */
function VozCelda({
  voz,
  onEdit,
}: {
  voz: CompanySummary['voz'];
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const color =
    voz.tope === 0
      ? 'text-slate-400'
      : voz.minutosMes >= voz.tope
        ? 'text-rose-600'
        : voz.minutosMes >= voz.tope * 0.8
          ? 'text-amber-600'
          : 'text-slate-600';
  return (
    <div className="whitespace-nowrap">
      <span className={color}>
        {voz.tope === 0
          ? t('platform.voiceNone')
          : t('platform.voiceMinutes', { used: voz.minutosMes, limit: voz.tope })}
      </span>
      {voz.topePorDefecto && (
        <span className="ml-1 text-xs text-slate-400">
          ({t('platform.voiceDefault')})
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="ml-2 text-xs text-brand-600 hover:text-brand-700"
      >
        {t('platform.voiceEdit')}
      </button>
    </div>
  );
}

/** Cambia el tope mensual de minutos de voz gestionada de una empresa. */
function VoiceLimitModal({
  company,
  onClose,
  onSaved,
}: {
  company: CompanySummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [minutos, setMinutos] = useState(String(company.voz.tope));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async (minutes: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/platform/companies/${company.id}/voice-limit`, {
        minutes,
      });
      onSaved();
    } catch {
      setError(t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const valor = Number(minutos);
  const valido = minutos.trim() !== '' && Number.isInteger(valor) && valor >= 0;

  return (
    <Modal
      title={t('platform.voiceModalTitle', { name: company.name })}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) {
            void guardar(valor);
          }
        }}
        className="space-y-3"
      >
        <p className="text-xs text-slate-500">
          {t('platform.voiceModalHint', { used: company.voz.minutosMes })}
        </p>
        <Field label={t('platform.voiceLimitLabel')}>
          <Input
            type="number"
            min={0}
            step={1}
            value={minutos}
            onChange={(e) => setMinutos(e.target.value)}
            autoFocus
          />
        </Field>
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit" disabled={busy || !valido}>
            {t('common.save')}
          </Button>
          {!company.voz.topePorDefecto && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void guardar(null)}
              disabled={busy}
            >
              {t('platform.voiceUseDefault')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Una credencial con su botón de copiar. */
function Credencial({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <dt className="text-slate-400">{label}</dt>
        <dd className="truncate font-mono text-slate-700">{value}</dd>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1500);
        }}
        className="shrink-0 text-brand-600 hover:text-brand-700"
      >
        {copiado ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}
