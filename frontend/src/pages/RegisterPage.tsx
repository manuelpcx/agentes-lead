import { FormEvent, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { AuthShell } from '../components/AuthShell';
import { PasswordInput } from '../components/PasswordInput';
import { Button, Field, Input } from '../components/ui';
import type { LoginResponse } from '../types';

interface RegisterResponse extends LoginResponse {
  company: { id: string; name: string };
  webhookSecret: string;
}

const FIELDS = [
  ['companyName', 'text'],
  ['rut', 'text'],
  ['name', 'text'],
  ['email', 'email'],
  ['password', 'password'],
] as const;

const FIELD_LABEL_KEY: Record<(typeof FIELDS)[number][0], string> = {
  companyName: 'auth.register.companyName',
  rut: 'auth.register.rut',
  name: 'auth.register.yourName',
  email: 'auth.register.email',
  password: 'auth.register.password',
};

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [form, setForm] = useState({
    companyName: '',
    rut: '',
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<RegisterResponse>(
        '/auth/register-company',
        form,
      );
      setSession(data);
      setSecret(data.webhookSecret);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setError(
        status === 409
          ? t('auth.register.emailTaken')
          : t('auth.register.error'),
      );
    } finally {
      setLoading(false);
    }
  };

  if (secret) {
    return (
      <AuthShell>
        <div className="w-full max-w-md space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">
            {t('auth.register.successTitle')}
          </h1>
          <p className="text-sm text-slate-600">
            <Trans i18nKey="auth.register.successBody">
              Guarda este <strong>webhookSecret</strong> ahora: no volverá a
              mostrarse. Sirve para firmar la ingesta de leads (n8n) y el
              webhook.
            </Trans>
          </p>
          <code className="block break-all rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {secret}
          </code>
          <Button onClick={() => navigate('/config')} className="w-full">
            {t('auth.register.goToPanel')}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="mb-1">
          <h1 className="text-xl font-semibold text-slate-900">
            {t('auth.register.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('auth.register.subtitle')}
          </p>
        </div>

        {FIELDS.map(([k, type]) => (
          <Field key={k} label={t(FIELD_LABEL_KEY[k])}>
            {type === 'password' ? (
              <PasswordInput
                value={form[k]}
                onChange={set(k)}
                autoComplete="new-password"
                required
              />
            ) : (
              <Input
                type={type}
                value={form[k]}
                onChange={set(k)}
                required={k !== 'name'}
              />
            )}
          </Field>
        ))}

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? t('auth.register.submitting') : t('auth.register.submit')}
        </Button>

        <p className="text-center text-sm text-slate-500">
          <Link
            to="/login"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            {t('auth.register.haveAccount')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
