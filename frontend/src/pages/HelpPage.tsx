import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown, headings } from '../components/Markdown';
import { Button, Card, PageHeader, cn } from '../components/ui';
import { useTour } from '../store/tour';
// Copias de `docs/PANEL.md` y `docs/PANEL.en.md`, que es donde se editan: el
// backend las lee de ahí en runtime y el frontend se despliega solo desde
// `frontend/`, así que importar fuera de esta carpeta compila local pero
// revienta en Vercel. Se sincronizan con `npm run sync:guides` y hay un test
// que falla si se desfasan.
import panelEs from '../content/panel-guide.es.md?raw';
import panelEn from '../content/panel-guide.en.md?raw';
import mcpEs from '../content/mcp-guide.es.md?raw';
import mcpEn from '../content/mcp-guide.en.md?raw';

/**
 * Guías disponibles. Cada una es un markdown por idioma; agregar otra es
 * sumar una entrada acá y sus dos archivos en `src/content/`.
 */
const GUIDES = [
  {
    id: 'panel',
    titleKey: 'help.guides.panel.title',
    summaryKey: 'help.guides.panel.summary',
    sources: { es: panelEs, en: panelEn } as Record<string, string>,
  },
  {
    id: 'mcp',
    titleKey: 'help.guides.mcp.title',
    summaryKey: 'help.guides.mcp.summary',
    sources: { es: mcpEs, en: mcpEn } as Record<string, string>,
  },
];

/**
 * Centro de ayuda del panel: las guías del producto, renderizadas desde
 * markdown para que escribirlas sea escribir texto y no JSX.
 */
export function HelpPage() {
  const { t, i18n } = useTranslation();
  const [activeId, setActiveId] = useState(GUIDES[0].id);
  const startTour = useTour((s) => s.start);

  const guide = GUIDES.find((g) => g.id === activeId) ?? GUIDES[0];
  const lang = i18n.language.startsWith('en') ? 'en' : 'es';
  const source = guide.sources[lang] ?? guide.sources.es;
  const sections = useMemo(() => headings(source), [source]);

  /** Contenedor con scroll propio más cercano (en este layout, el `<main>`). */
  const scrollParent = (el: HTMLElement): HTMLElement | null => {
    let node = el.parentElement;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  /**
   * Salta a una sección. No usa `scrollIntoView` con `smooth` porque dentro
   * del contenedor con scroll propio del layout no hace nada: el índice se
   * veía pero no llevaba a ninguna parte. Se mueve el contenedor a mano.
   */
  const goTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cont = scrollParent(el);
    if (!cont) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const top =
      el.getBoundingClientRect().top -
      cont.getBoundingClientRect().top +
      cont.scrollTop;
    const destino = Math.max(0, top - 8);
    const inicio = cont.scrollTop;
    cont.scrollTo({ top: destino, behavior: 'smooth' });

    // Hay navegadores que ignoran por completo el scroll suave dentro de un
    // contenedor anidado: el índice se veía pero no llevaba a ninguna parte.
    // Si a los 250 ms no se movió NADA, se salta de golpe — mejor sin
    // animación que sin funcionar.
    window.setTimeout(() => {
      if (cont.scrollTop === inicio && inicio !== destino) {
        cont.scrollTop = destino;
      }
    }, 250);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title={t('help.title')}
        subtitle={t('help.subtitle')}
        actions={
          <Button type="button" variant="secondary" onClick={startTour}>
            {t('tour.replay')}
          </Button>
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-0 lg:w-56">
          {GUIDES.length > 1 && (
            <nav className="mb-4 space-y-1">
              {GUIDES.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveId(g.id)}
                  className={cn(
                    'block w-full rounded-lg px-3 py-2 text-left text-sm transition',
                    g.id === activeId
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {t(g.titleKey)}
                </button>
              ))}
            </nav>
          )}

          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {t('help.onThisPage')}
          </p>
          <nav className="space-y-0.5">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => goTo(s.id)}
                className="block w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                {s.text}
              </button>
            ))}
          </nav>
        </aside>

        <Card className="min-w-0 flex-1 p-5 md:p-7">
          <Markdown source={source} />
        </Card>
      </div>
    </div>
  );
}
