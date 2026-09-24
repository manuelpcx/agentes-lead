import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SparkIcon } from './icons';

/** Marco de las pantallas públicas (login/registro): hero de marca + formulario. */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full">
      {/* Hero de marca (oculto en móvil) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-50 via-white to-blue-50 p-10 text-slate-900 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgb(191 219 254) 0, transparent 40%), radial-gradient(circle at 80% 60%, rgb(219 234 254) 0, transparent 35%)',
          }}
        />
        <div className="relative flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
            AL
          </span>
          <span className="text-lg font-semibold">{t('auth.hero.brand')}</span>
        </div>
        <div className="relative">
          <SparkIcon className="mb-4 h-8 w-8 text-brand-500" />
          <h2 className="text-3xl font-semibold leading-tight text-slate-900">
            {t('auth.hero.titleLine1')}
            <br />
            {t('auth.hero.titleLine2')}
          </h2>
          <p className="mt-3 max-w-sm text-slate-600">
            {t('auth.hero.description')}
          </p>
        </div>
        <p className="relative text-sm font-medium text-brand-600">
          {t('auth.hero.footer')}
        </p>
      </div>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        {children}
      </div>
    </div>
  );
}
