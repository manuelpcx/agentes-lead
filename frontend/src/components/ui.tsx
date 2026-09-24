import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useEffect,
} from 'react';

/** Une clases condicionales (helper mínimo, sin dependencias). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ─────────────────────────── Button ───────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-400',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-300',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-300',
  danger:
    'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 focus-visible:ring-rose-300',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium transition',
        'focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

// ─────────────────────────── Card ───────────────────────────

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─────────────────────────── Badge ───────────────────────────

type BadgeTone =
  | 'slate'
  | 'brand'
  | 'blue'
  | 'green'
  | 'amber'
  | 'rose'
  | 'orange'
  | 'indigo';

const BADGE_TONES: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-100 text-brand-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  orange: 'bg-orange-100 text-orange-800',
  indigo: 'bg-indigo-100 text-indigo-700',
};

export function Badge({
  tone = 'slate',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─────────────────────────── Inputs ───────────────────────────

const FIELD_BASE =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none ' +
  'focus:ring-2 focus:ring-brand-200';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD_BASE, 'pr-8', className)} {...props} />;
}

/** Etiqueta + control apilados. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

// ─────────────────────────── Modal ───────────────────────────

/**
 * Diálogo centrado sobre un velo. Se cierra con Escape o clic fuera; el
 * contenido se desplaza solo si no cabe, para no empujar la página.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label={title}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── PageHeader ───────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
