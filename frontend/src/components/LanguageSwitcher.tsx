import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';

/** Selector de idioma del panel (ES/EN) — la preferencia se guarda en localStorage. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <select
      value={i18n.language}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      aria-label={t('language.label')}
      className={
        className ??
        'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200'
      }
    >
      {SUPPORTED_LANGUAGES.map((lng) => (
        <option key={lng} value={lng}>
          {t(`language.${lng}`)}
        </option>
      ))}
    </select>
  );
}
