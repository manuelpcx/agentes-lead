import { ComponentType, ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { cn } from './ui';
import { HelpChatWidget } from './HelpChatWidget';
import { TourOverlay } from './TourOverlay';
import { useTour } from '../store/tour';
import { LanguageSwitcher } from './LanguageSwitcher';
import { AccountModal } from './AccountModal';
import {
  AgentsIcon,
  BookIcon,
  CalendarIcon,
  ChartIcon,
  ChatIcon,
  CheckIcon,
  ChevronLeftIcon,
  CogIcon,
  HelpIcon,
  PlatformIcon,
  IntegrationsIcon,
  InboxIcon,
  LogoutIcon,
  PromptIcon,
  WhatsappIcon,
} from './icons';

const SIDEBAR_COLLAPSED_KEY = 'agentes-lead-sidebar-collapsed';

type NavItem = {
  to: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: '/', labelKey: 'nav.assistant', icon: ChatIcon, end: true },
  { to: '/leads', labelKey: 'nav.inbox', icon: InboxIcon },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarIcon },
  { to: '/knowledge', labelKey: 'nav.knowledge', icon: BookIcon },
  { to: '/approval', labelKey: 'nav.approval', icon: CheckIcon },
  { to: '/prompts', labelKey: 'nav.prompts', icon: PromptIcon },
  { to: '/metrics', labelKey: 'nav.metrics', icon: ChartIcon },
  { to: '/agents', labelKey: 'nav.agents', icon: AgentsIcon },
  { to: '/templates', labelKey: 'nav.templates', icon: WhatsappIcon },
  { to: '/integrations', labelKey: 'nav.integrations', icon: IntegrationsIcon },
  { to: '/config', labelKey: 'nav.config', icon: CogIcon },
  { to: '/help', labelKey: 'nav.help', icon: HelpIcon },
];

/** Iniciales para el avatar de la empresa. */
function initials(name?: string): string {
  if (!name) return '·';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Shell del panel: sidebar de navegación + topbar + área de contenido. */
export function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, memberships, selectedCompanyId, selectCompany, logout } =
    useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage puede fallar en modo privado — no es crítico, solo se
      // pierde la preferencia de colapso entre sesiones.
    }
  }, [collapsed]);

  const tourOpen = useTour((s) => s.open);
  const startTour = useTour((s) => s.start);

  // Primera vez que alguien entra al panel: el tour sale solo. `null` en
  // `onboardingCompletedAt` es "nunca lo vio" — también para las cuentas que
  // ya existían antes de que el tour existiera.
  useEffect(() => {
    if (user && !user.onboardingCompletedAt && selectedCompanyId) {
      startTour();
    }
  }, [user, selectedCompanyId, startTour]);

  // El foco ilumina ítems del menú: con la barra plegada no se leería nada.
  useEffect(() => {
    if (tourOpen) {
      setCollapsed(false);
    }
  }, [tourOpen]);

  const activo = memberships.find((m) => m.companyId === selectedCompanyId);

  const navClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive
        ? 'bg-brand-50 text-brand-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    );

  return (
    <div className="flex h-full bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside
        className={cn(
          'relative hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex',
          collapsed ? 'w-[4.5rem]' : 'w-60',
        )}
      >
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-card transition hover:text-slate-600"
          aria-label={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
          title={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
        >
          <ChevronLeftIcon
            className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')}
          />
        </button>

        <button
          onClick={() => navigate('/')}
          className={cn(
            'flex items-center gap-2 px-5 py-4 text-left',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            AL
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-semibold text-slate-900">
              {t('auth.hero.brand')}
            </span>
          )}
        </button>

        {/* Mantenedor de la plataforma: fuera del gate de empresa a propósito.
            Una cuenta de plataforma puede no tener ninguna empresa asignada y
            aun así tiene que poder llegar a esta pantalla. */}
        {user?.isPlatformAdmin && (
          <nav className="space-y-1 px-3 pt-2">
            <NavLink
              to="/platform"
              title={collapsed ? t('nav.platform') : undefined}
              className={({ isActive }) =>
                cn(navClasses({ isActive }), collapsed && 'justify-center px-0')
              }
            >
              <PlatformIcon className="h-5 w-5 shrink-0" />
              {!collapsed && t('nav.platform')}
            </NavLink>
          </nav>
        )}

        {selectedCompanyId && (
          <nav className="flex-1 space-y-1 px-3 py-2">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                data-tour={n.to}
                title={collapsed ? t(n.labelKey) : undefined}
                className={({ isActive }) =>
                  cn(navClasses({ isActive }), collapsed && 'justify-center px-0')
                }
              >
                <n.icon className="h-5 w-5 shrink-0" />
                {!collapsed && t(n.labelKey)}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-slate-100',
              collapsed && 'justify-center px-0',
            )}
            title={collapsed ? user?.email : t('nav.account')}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {initials(user?.email)}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {user?.email}
              </span>
            )}
          </button>
        </div>
      </aside>

      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}

      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-2.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white md:hidden">
              AL
            </span>
            {activo && (
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-xs font-semibold text-brand-700">
                  {initials(activo.companyName)}
                </span>
                <span className="hidden text-sm font-medium text-slate-700 sm:inline">
                  {activo.companyName}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {memberships.length > 1 && (
              <select
                value={selectedCompanyId ?? ''}
                onChange={(e) => selectCompany(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="" disabled>
                  {t('nav.selectCompanyPlaceholder')}
                </option>
                {memberships.map((m) => (
                  <option key={m.companyId} value={m.companyId}>
                    {m.companyName} ({m.role})
                  </option>
                ))}
              </select>
            )}
            {activo && (
              <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 sm:inline">
                {activo.role}
              </span>
            )}
            <LanguageSwitcher />
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              <LogoutIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t('nav.logout')}</span>
            </button>
          </div>
        </header>

        {/* Nav horizontal (mobile) */}
        {selectedCompanyId && (
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5 md:hidden">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {t(n.labelKey)}
              </NavLink>
            ))}
          </nav>
        )}

        {/* Contenido. El `h-full` del contenedor le da altura definida a la
            pantalla: sin él, el `h-full` de las vistas de chat se resuelve como
            `auto`, la página entera scrollea y el campo de escribir se va de
            vista. Las pantallas largas siguen scrolleando dentro de <main>. */}
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          {selectedCompanyId ? (
            <div className="animate-fade-in h-full">{children}</div>
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card">
                <p className="mb-3 text-slate-700">
                  {t('nav.selectCompanyPrompt')}
                </p>
                <div className="flex flex-col gap-2">
                  {memberships.map((m) => (
                    <button
                      key={m.companyId}
                      onClick={() => selectCompany(m.companyId)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                    >
                      {m.companyName}{' '}
                      <span className="text-slate-400">({m.role})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* En el home ya está el chat a pantalla completa; el flotante solo
          hace falta en el resto del panel. */}
      {selectedCompanyId && location.pathname !== '/' && <HelpChatWidget />}
      {tourOpen && <TourOverlay />}
    </div>
  );
}
