import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useTour } from '../store/tour';
import { Button, cn } from './ui';

/**
 * Tour de bienvenida: recorre el menú lateral explicando qué hay en cada
 * sección. Se abre solo la primera vez que alguien entra al panel, y a mano
 * desde la pestaña Ayuda.
 *
 * Sin librerías: el foco es un recuadro transparente sobre el ítem del menú
 * con una sombra enorme alrededor, que es lo que oscurece el resto.
 */

/** Un paso del tour. `target` es la ruta del ítem del menú que se ilumina. */
interface TourStep {
  id: string;
  /** Ruta del `NavLink` a iluminar; sin ella, la tarjeta va centrada. */
  target?: string;
}

/**
 * Nueve pasos: agrupan las doce entradas del menú por lo que se hace con
 * ellas, para que el recorrido no se haga interminable.
 */
export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome' },
  { id: 'assistant', target: '/' },
  { id: 'inbox', target: '/leads' },
  { id: 'knowledge', target: '/knowledge' },
  { id: 'agents', target: '/agents' },
  { id: 'improve', target: '/approval' },
  { id: 'schedule', target: '/calendar' },
  { id: 'setup', target: '/integrations' },
  { id: 'help', target: '/help' },
];

/** Debajo de este ancho no hay menú lateral: la tarjeta va centrada. */
const MOBILE_MAX = 768;

const CARD_WIDTH = 320;
const GAP = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay() {
  const { t } = useTranslation();
  const close = useTour((s) => s.close);
  const markOnboardingDone = useAuth((s) => s.markOnboardingDone);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  /** Mide el ítem del menú de este paso. Null = tarjeta centrada. */
  const medir = useCallback(() => {
    if (!step.target || window.innerWidth < MOBILE_MAX) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(
      `[data-tour="${step.target}"]`,
    );
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.target]);

  useEffect(() => {
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  // El foco del teclado se lleva a la tarjeta: con el resto de la pantalla
  // tapado, tabular por detrás no lleva a ninguna parte.
  useEffect(() => {
    cardRef.current?.focus();
  }, [index]);

  /** Termina el tour. Marca el usuario para que no vuelva a salir solo. */
  const terminar = useCallback(async () => {
    close();
    try {
      await api.post('/auth/onboarding-complete');
      markOnboardingDone();
    } catch {
      // Si falla, el tour volverá a salir la próxima vez. Molesto, pero
      // preferible a esconderlo por un error de red que nadie vio.
    }
  }, [close, markOnboardingDone]);

  const anterior = () => setIndex((i) => Math.max(0, i - 1));
  const siguiente = () => {
    if (isLast) {
      void terminar();
    } else {
      setIndex((i) => i + 1);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      void terminar();
    } else if (e.key === 'ArrowRight') {
      siguiente();
    } else if (e.key === 'ArrowLeft') {
      anterior();
    }
  };

  // Posición de la tarjeta: al costado del ítem iluminado, o centrada.
  const cardStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        left: Math.min(
          rect.left + rect.width + GAP,
          window.innerWidth - CARD_WIDTH - GAP,
        ),
        top: Math.max(
          GAP,
          Math.min(rect.top - GAP, window.innerHeight - 260 - GAP),
        ),
        width: CARD_WIDTH,
      }
    : {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: `min(${CARD_WIDTH}px, calc(100vw - 32px))`,
      };

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      onKeyDown={onKeyDown}
    >
      {/* El velo: con foco es el recuadro recortado; sin foco, una capa. */}
      {rect ? (
        /* Sin transición en la posición a propósito: si el navegador no
           anima (movimiento reducido, pestaña en segundo plano), las
           propiedades se quedan en su valor inicial y el foco aparece en la
           esquina superior izquierda en vez de sobre el menú. Mejor que
           salte. */
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-brand-400"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/60" />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        style={cardStyle}
        className="rounded-2xl bg-white p-4 shadow-xl focus:outline-none"
      >
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-brand-600">
          {t('tour.progress', { current: index + 1, total: TOUR_STEPS.length })}
        </p>
        <h2
          id="tour-title"
          className="text-sm font-semibold text-slate-900"
        >
          {t(`tour.steps.${step.id}.title`)}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          {t(`tour.steps.${step.id}.body`)}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void terminar()}
            className="text-xs text-slate-400 transition hover:text-slate-600"
          >
            {t('tour.skip')}
          </button>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={anterior}
              className={cn(index === 0 && 'invisible')}
            >
              {t('tour.back')}
            </Button>
            <Button type="button" size="sm" onClick={siguiente}>
              {isLast ? t('tour.finish') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
