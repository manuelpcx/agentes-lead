import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';
import en from './locales/en.json';

export const STORAGE_KEY = 'agentes-lead-lang';
export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function getInitialLanguage(): SupportedLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(saved ?? '')) {
      return saved as SupportedLanguage;
    }
  } catch {
    // localStorage puede fallar en modo privado — se usa el default.
  }
  return 'es';
}

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // no-op — solo se pierde la preferencia entre sesiones.
  }
});

export default i18n;
