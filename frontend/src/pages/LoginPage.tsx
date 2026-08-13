import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { AuthShell } from '../components/AuthShell';
import { Button, Field, Input } from '../components/ui';
import type { LoginResponse } from '../types';

export function LoginPage() {
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
      setError('Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="mb-2">
          <h1 className="text-xl font-semibold text-slate-900">
            Entrar al panel
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestiona tus agentes y conversaciones.
          </p>
        </div>

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Contraseña">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>

        <p className="text-center text-sm text-slate-500">
          ¿Nueva empresa?{' '}
          <Link
            to="/register"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Regístrate
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
