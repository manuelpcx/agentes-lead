import { InputHTMLAttributes, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeIcon, EyeOffIcon } from './icons';
import { Input, cn } from './ui';

/**
 * Campo de contraseña con el "ojo" para ver lo que se escribe. Es el `Input`
 * de siempre con un botón encima, así que acepta las mismas props.
 *
 * Se usa donde la persona ESCRIBE su propia contraseña (acceso, registro,
 * restablecer, Mi cuenta). No en los secretos de Integraciones: ahí el diseño
 * es que nunca se muestren de vuelta.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const label = visible ? t('common.hidePassword') : t('common.showPassword');

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Sin esto, el clic le quita el foco al campo y el cursor se pierde
        // justo cuando la persona quiere seguir escribiendo.
        onMouseDown={(e) => e.preventDefault()}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-slate-400 transition hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
      >
        {visible ? (
          <EyeOffIcon className="h-5 w-5" aria-hidden="true" />
        ) : (
          <EyeIcon className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
