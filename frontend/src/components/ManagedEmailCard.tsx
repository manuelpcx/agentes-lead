import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { Badge, Button, Card, Field, Input } from './ui';
import { CopyValue } from './CopyValue';

type Mode = 'byo' | 'managed' | 'shared' | 'none';

interface DnsRecord {
  record: string;
  name: string;
  fqdn: string;
  type: string;
  value: string;
  priority?: number;
  status?: string;
}

/** Lo que devuelve `GET /panel/email`. */
interface ManagedEmailStatus {
  available: boolean;
  sharedDomain: string | null;
  sender: { fromName?: string; localPart?: string; replyTo?: string };
  domain: {
    domain: string;
    status: string;
    sendable: boolean;
    verifiedAt: string | null;
    lastCheckedAt: string | null;
    records: DnsRecord[];
  } | null;
  sending: { mode: Mode; from: string | null; replyTo: string | null };
  quota: { used: number; limit: number };
}

const MODE_TONE: Record<Mode, 'green' | 'amber' | 'indigo' | 'slate'> = {
  managed: 'green',
  shared: 'amber',
  byo: 'indigo',
  none: 'slate',
};

const DOMAIN_TONE: Record<string, 'green' | 'amber' | 'rose' | 'slate'> = {
  verified: 'green',
  partially_verified: 'green',
  pending: 'amber',
  not_started: 'slate',
  temporary_failure: 'rose',
  partially_failed: 'rose',
  failed: 'rose',
};

/** Mensaje de error del backend (string o lista de la validación). */
function errorText(e: unknown, fallback: string): string {
  const message = (e as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (Array.isArray(message)) {
    return message.join(' ');
  }
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * Correo gestionado: los correos de la empresa salen por la cuenta de envío de
 * la plataforma, con su dominio (que damos de alta nosotros; la empresa solo
 * crea los registros DNS) o, mientras tanto, desde el dominio compartido.
 * `advanced` es la tarjeta de siempre para conectar una cuenta propia.
 */
export function ManagedEmailCard({
  advanced,
  refreshKey,
}: {
  advanced: ReactNode;
  /** Cambia cuando se guarda la cuenta propia: el modo de envío puede cambiar. */
  refreshKey: number;
}) {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) =>
    t(`integrations.managedEmail.${key}`, opts);
  const canEdit = useAuth(
    (s) =>
      s.memberships.find((m) => m.companyId === s.selectedCompanyId)?.role ===
      'OWNER',
  );

  const [status, setStatus] = useState<ManagedEmailStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<null | 'sender' | 'add' | 'verify' | 'remove'>(
    null,
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sender, setSender] = useState({ fromName: '', localPart: '', replyTo: '' });
  const [domainInput, setDomainInput] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const apply = (s: ManagedEmailStatus) => {
    setStatus(s);
    setSender({
      fromName: s.sender.fromName ?? '',
      localPart: s.sender.localPart ?? '',
      replyTo: s.sender.replyTo ?? '',
    });
  };

  const load = () => {
    setLoadError(false);
    api
      .get<ManagedEmailStatus>('/panel/email')
      .then((r) => apply(r.data))
      .catch(() => setLoadError(true));
  };
  useEffect(load, [refreshKey]);

  const act = async (
    kind: NonNullable<typeof busy>,
    request: () => Promise<{ data: ManagedEmailStatus }>,
    okText: string,
  ) => {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await request();
      apply(r.data);
      setMsg({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, k('genericError')) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const mode = status?.sending.mode ?? 'none';

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{k('title')}</h3>
        {status && <Badge tone={MODE_TONE[mode]}>{k(`mode.${mode}`)}</Badge>}
      </div>
      <p className="mb-4 text-xs text-slate-500">{k('hint')}</p>

      {!status && !loadError && (
        <p className="text-sm text-slate-400">{t('common.loading')}</p>
      )}
      {loadError && (
        <p className="text-sm text-rose-600">
          {k('loadError')}{' '}
          <button type="button" onClick={load} className="font-medium underline">
            {t('common.retry')}
          </button>
        </p>
      )}

      {status && (
        <div className="space-y-6">
          {/* ── Por dónde sale el correo ── */}
          <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              {mode === 'none'
                ? k(status.available ? 'summary.none' : 'summary.unavailable')
                : k(`summary.${mode}`, { from: status.sending.from })}
            </p>
            {(mode === 'managed' || mode === 'shared') && (
              <>
                {status.sending.replyTo ? (
                  <p className="text-xs text-slate-500">
                    {k('summary.replyTo', { replyTo: status.sending.replyTo })}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700">{k('summary.noReplyTo')}</p>
                )}
                <p className="text-xs text-slate-500">
                  {k('summary.quota', status.quota)}
                </p>
              </>
            )}
          </div>

          {/* ── Remitente ── */}
          <section className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-700">
              {k('sender.title')}
            </h4>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={k('sender.fromName')} hint={k('sender.fromNameHint')}>
                <Input
                  value={sender.fromName}
                  onChange={(e) =>
                    setSender((s) => ({ ...s, fromName: e.target.value }))
                  }
                  disabled={!canEdit}
                  maxLength={80}
                />
              </Field>
              <Field label={k('sender.replyTo')} hint={k('sender.replyToHint')}>
                <Input
                  type="email"
                  value={sender.replyTo}
                  onChange={(e) =>
                    setSender((s) => ({ ...s, replyTo: e.target.value }))
                  }
                  placeholder="equipo@tuempresa.cl"
                  disabled={!canEdit}
                />
              </Field>
              <Field
                label={k('sender.localPart')}
                hint={k('sender.localPartHint')}
              >
                {/* En pantallas angostas el dominio baja a otra línea en vez
                    de aplastar el campo. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Input
                    value={sender.localPart}
                    onChange={(e) =>
                      setSender((s) => ({ ...s, localPart: e.target.value }))
                    }
                    placeholder="contacto"
                    className="min-w-[8rem] flex-1 font-mono text-xs"
                    disabled={!canEdit}
                  />
                  <span className="min-w-0 break-all font-mono text-xs text-slate-500">
                    @{status.domain?.domain ?? k('sender.yourDomain')}
                  </span>
                </div>
              </Field>
            </div>
            {canEdit && (
              <Button
                onClick={() =>
                  act(
                    'sender',
                    () => api.put('/panel/email/sender', sender),
                    k('saved'),
                  )
                }
                disabled={busy !== null}
              >
                {busy === 'sender' ? t('integrations.saving') : t('integrations.save')}
              </Button>
            )}
          </section>

          {/* ── Dominio propio ── */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-700">
              {k('domain.title')}
            </h4>

            {!status.available && (
              <p className="text-sm text-slate-500">{k('domain.unavailable')}</p>
            )}

            {status.available && !status.domain && (
              <>
                <p className="text-xs text-slate-500">{k('domain.subdomainHint')}</p>
                {canEdit ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      placeholder="notificaciones.tuempresa.cl"
                      className="font-mono text-xs"
                    />
                    <Button
                      className="shrink-0"
                      onClick={async () => {
                        const ok = await act(
                          'add',
                          () =>
                            api.post('/panel/email/domain', {
                              domain: domainInput,
                            }),
                          k('domain.added'),
                        );
                        if (ok) {
                          setDomainInput('');
                        }
                      }}
                      disabled={busy !== null || !domainInput.trim()}
                    >
                      {busy === 'add' ? k('domain.adding') : k('domain.add')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{k('domain.ownerOnly')}</p>
                )}
              </>
            )}

            {status.domain && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-800">
                    {status.domain.domain}
                  </span>
                  <Badge tone={DOMAIN_TONE[status.domain.status] ?? 'slate'}>
                    {k(`domainStatus.${status.domain.status}`, {
                      defaultValue: status.domain.status,
                    })}
                  </Badge>
                </div>
                <p className="text-xs text-slate-600">
                  {k(`domainHelp.${status.domain.status}`, {
                    defaultValue: k('domainHelp.pending'),
                  })}
                </p>

                {!status.domain.sendable && (
                  <p className="text-xs text-slate-500">{k('domain.dnsHelp')}</p>
                )}

                <ul className="space-y-2">
                  {status.domain.records.map((r) => (
                    <li
                      key={`${r.type}-${r.name}-${r.value}`}
                      className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700">
                          {r.type} · {r.record}
                        </span>
                        <Badge tone={r.status === 'verified' ? 'green' : 'slate'}>
                          {r.status === 'verified'
                            ? k('recordStatus.verified')
                            : r.status === 'failed'
                              ? k('recordStatus.failed')
                              : k('recordStatus.pending')}
                        </Badge>
                      </div>
                      <div>
                        <span className="text-slate-500">{k('record.name')}</span>
                        <CopyValue value={r.name} />
                        {r.fqdn !== r.name && (
                          <p className="mt-1 text-slate-400">
                            {k('record.fullName', { fqdn: r.fqdn })}
                          </p>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-500">{k('record.value')}</span>
                        <CopyValue value={r.value} />
                      </div>
                      {r.priority !== undefined && (
                        <p className="text-slate-500">
                          {k('record.priority')}:{' '}
                          <span className="font-mono text-slate-700">
                            {r.priority}
                          </span>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                {status.domain.lastCheckedAt && (
                  <p className="text-xs text-slate-400">
                    {k('domain.lastChecked', {
                      when: new Date(status.domain.lastCheckedAt).toLocaleString(),
                    })}
                  </p>
                )}

                {canEdit && !confirmRemove && (
                  <div className="flex flex-wrap gap-2">
                    {!status.domain.sendable && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          act(
                            'verify',
                            () => api.post('/panel/email/domain/verify'),
                            k('domain.verifyStarted'),
                          )
                        }
                        disabled={busy !== null}
                      >
                        {busy === 'verify' ? k('domain.verifying') : k('domain.verify')}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      onClick={() => setConfirmRemove(true)}
                      disabled={busy !== null}
                    >
                      {k('domain.remove')}
                    </Button>
                  </div>
                )}
                {canEdit && confirmRemove && (
                  <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    <p>{k('domain.removeConfirm', { domain: status.domain.domain })}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="danger"
                        onClick={async () => {
                          await act(
                            'remove',
                            () => api.delete('/panel/email/domain'),
                            k('domain.removed'),
                          );
                          setConfirmRemove(false);
                        }}
                        disabled={busy !== null}
                      >
                        {busy === 'remove' ? k('domain.removing') : k('domain.removeYes')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmRemove(false)}
                        disabled={busy !== null}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {msg && (
            <p className={msg.ok ? 'text-sm text-emerald-600' : 'text-sm text-rose-600'}>
              {msg.text}
            </p>
          )}

          {/* ── Cuenta propia (avanzado) ── */}
          <details className="rounded-xl border border-slate-200 p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {k('advanced.title')}
            </summary>
            <p className="mb-4 mt-2 text-xs text-slate-500">{k('advanced.hint')}</p>
            {advanced}
          </details>
        </div>
      )}
    </Card>
  );
}
