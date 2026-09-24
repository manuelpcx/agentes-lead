import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { AuthShell } from '../components/AuthShell';
import { Button, Field, Input } from '../components/ui';

/**
 * Pedir el enlace de recuperación. La respuesta es la misma exista o no la
 * cuenta: este formulario no sirve para averiguar qué emails están registrados.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setDone(true);
    } catch {
      setError(t('auth.forgot.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {t('auth.forgot.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t('auth.forgot.subtitle')}</p>
        </div>

        {done ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t('auth.forgot.done')}
          </p>
        ) : (
          <>
            <Field label={t('auth.forgot.email')}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </Field>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
            </Button>
          </>
        )}

        <p className="text-center text-sm text-slate-500">
          <Link
            to="/login"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            {t('auth.forgot.backToLogin')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
