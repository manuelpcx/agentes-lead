import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { PasswordInput } from './PasswordInput';
import { Button, Field, Modal } from './ui';

/**
 * "Mi cuenta": por ahora, cambiar la contraseña. Al cambiarla, el backend
 * invalida los JWT anteriores y devuelve uno nuevo para esta sesión — se
 * guarda al vuelo para que la persona no tenga que volver a entrar.
 */
export function AccountModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setToken = useAuth((s) => s.setToken);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError(t('account.mismatch'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.post<{ accessToken: string }>(
        '/auth/change-password',
        { currentPassword: current, newPassword: next },
      );
      setToken(data.accessToken);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setError(status === 400 ? t('account.wrongCurrent') : t('account.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('account.title')} onClose={onClose}>
      <p className="mb-4 text-xs text-slate-500">{user?.email}</p>

      <h3 className="text-sm font-semibold text-slate-800">
        {t('account.changePassword')}
      </h3>
      <p className="mb-3 text-xs text-slate-400">{t('account.hint')}</p>

      {done && (
        <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t('account.done')}
        </p>
      )}

      <form onSubmit={submit} className="space-y-3">
        <Field label={t('account.current')}>
          <PasswordInput
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label={t('account.new')}>
          <PasswordInput
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label={t('account.confirm')}>
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

        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={saving}>
            {saving ? t('account.submitting') : t('account.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
