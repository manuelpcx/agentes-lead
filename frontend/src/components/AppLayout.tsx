import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { cn } from './ui';
import {
  BookIcon,
  ChartIcon,
  CheckIcon,
  CogIcon,
  DocIcon,
  InboxIcon,
  LogoutIcon,
  UsersIcon,
} from './icons';

type NavItem = {
  to: string;
  label: string;
  icon: (p: { className?: string }) => ReactNode;
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: '/', label: 'Bandeja', icon: InboxIcon, end: true },
  { to: '/knowledge', label: 'Conocimiento', icon: BookIcon },
  { to: '/approval', label: 'Aprobación', icon: CheckIcon },
  { to: '/prompts', label: 'Prompts', icon: DocIcon },
  { to: '/metrics', label: 'Métricas', icon: ChartIcon },
  { to: '/agents', label: 'Agentes', icon: UsersIcon },
  { to: '/templates', label: 'Plantillas WA', icon: DocIcon },
  { to: '/integrations', label: 'Integraciones', icon: CogIcon },
  { to: '/config', label: 'Configuración', icon: CogIcon },
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
  const navigate = useNavigate();
  const { user, memberships, selectedCompanyId, selectCompany, logout } =
    useAuth();

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
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 px-5 py-4 text-left"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            AL
          </span>
          <span className="text-sm font-semibold text-slate-900">
            Agentes Lead
          </span>
        </button>

        {selectedCompanyId && (
          <nav className="flex-1 space-y-1 px-3 py-2">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={navClasses}>
                <n.icon className="h-5 w-5 shrink-0" />
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {initials(user?.email)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {user?.email}
            </span>
          </div>
        </div>
      </aside>

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
                  Elige empresa…
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
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              <LogoutIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Salir</span>
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
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        {/* Contenido */}
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          {selectedCompanyId ? (
            <div className="animate-fade-in">{children}</div>
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card">
                <p className="mb-3 text-slate-700">
                  Selecciona una empresa para continuar.
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
    </div>
  );
}
