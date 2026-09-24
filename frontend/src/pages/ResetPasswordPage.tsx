import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { AuthShell } from '../components/AuthShell';
import { PasswordInput } from '../components/PasswordInput';
import { Button, Field } from '../components/ui';

/** Elegir la contraseña nueva con el token que vino en el correo. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('auth.reset.mismatch'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch {
      setError(t('auth.reset.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {t('auth.reset.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t('auth.reset.subtitle')}</p>
        </div>

        {!token ? (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('auth.reset.missingToken')}
            </p>
            <p className="text-center text-sm">
              <Link
                to="/forgot-password"
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                {t('auth.login.forgotLink')}
              </Link>
            </p>
          </>
        ) : done ? (
          <>
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {t('auth.reset.done')}
            </p>
            <Link to="/login" className="block">
              <Button type="button" className="w-full">
                {t('auth.reset.goLogin')}
              </Button>
            </Link>
          </>
        ) : (
          <>
            <Field label={t('auth.reset.password')}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
                autoFocus
              />
            </Field>
            <Field label={t('auth.reset.confirm')}>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
            </Field>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t('auth.reset.submitting') : t('auth.reset.submit')}
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
