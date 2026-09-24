import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { AuthShell } from '../components/AuthShell';
import { PasswordInput } from '../components/PasswordInput';
import { Button, Field, Input } from '../components/ui';
import type { LoginResponse } from '../types';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useAuth((s) => s.token);
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) navigate('/');
  }, [token, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', {
        email,
        password,
      });
      setSession(data);
      navigate('/');
    } catch {
      setError(t('auth.login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="mb-2">
          <h1 className="text-xl font-semibold text-slate-900">
            {t('auth.login.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('auth.login.subtitle')}
          </p>
        </div>

        <Field label={t('auth.login.email')}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label={t('auth.login.password')}>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>

        <p className="text-center text-sm">
          <Link
            to="/forgot-password"
            className="font-medium text-slate-500 hover:text-slate-700"
          >
            {t('auth.login.forgotLink')}
          </Link>
        </p>

        <p className="text-center text-sm text-slate-500">
          {t('auth.login.noAccount')}{' '}
          <Link
            to="/register"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            {t('auth.login.registerLink')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
