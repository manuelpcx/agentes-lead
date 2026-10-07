import {
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { cn } from './ui';
import {
  CHANNELS,
  ChannelIcon,
  ChannelKey,
  channelStyle,
  isChannel,
  useChannelLabel,
} from './channels';

/**
 * Escalera de contacto de un agente: por qué canal y cuánto después contacta
 * a un lead que no responde. `steps` vacío = usa la escalera general.
 */
export interface LadderState {
  steps: ChannelKey[];
  /** `delaysHours[i]` = espera entre el paso i+1 y el i+2. */
  delaysHours: number[];
  /** Minutos antes del primer contacto; `null` = el general. */
  firstContactDelayMin: number | null;
}

export const EMPTY_LADDER: LadderState = {
  steps: [],
  delaysHours: [],
  firstContactDelayMin: null,
};

/** Mínimo legal entre gestiones de cobranza (el backend también lo exige). */
const COBRANZA_MIN_HOURS = 48;
const DELAY_PRESETS_H = [1, 2, 6, 12, 24, 48, 72, 168];
const FIRST_CONTACT_PRESETS_MIN = [0, 2, 5, 10, 15, 30, 60, 120];

/**
 * Espera que aplica hoy el backend en la posición `i` cuando el agente no
 * define las suyas (`FOLLOWUP_DELAYS_HOURS` = 12,48,72 y después
 * `FOLLOWUP_BASE_DELAY_HOURS` × intento). Personalizar la escalera arranca con
 * estos valores, así que abrirla y guardarla no cambia los tiempos.
 */
function generalDelay(i: number): number {
  return [12, 48, 72][i] ?? 24 * (i + 1);
}

/** Lee la escalera desde `followupConfig` (JSON del backend). */
export function ladderFromConfig(
  cfg: Record<string, unknown> | undefined,
): LadderState {
  if (!cfg || typeof cfg !== 'object') return EMPTY_LADDER;
  const steps = Array.isArray(cfg.channelLadder)
    ? cfg.channelLadder.filter(isChannel)
    : [];
  const delaysHours = Array.isArray(cfg.delaysHours)
    ? cfg.delaysHours.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  // Una escalera guardada con menos esperas que pasos: el backend usa
  // `base × intento` para las que faltan. Se completan con eso para que cada
  // tramo muestre un valor y guardar no cambie nada.
  const filled =
    steps.length > 0 && delaysHours.length > 0
      ? Array.from(
          { length: Math.max(delaysHours.length, steps.length - 1) },
          (_, i) => delaysHours[i] ?? 24 * (i + 1),
        )
      : delaysHours;
  const first = cfg.firstContactDelayMin;
  return {
    steps,
    delaysHours: filled,
    firstContactDelayMin:
      typeof first === 'number' && first >= 0 ? Math.floor(first) : null,
  };
}

/** Lo que aporta la escalera a `followupConfig`. Vacío = todo general. */
export function ladderToConfig(state: LadderState): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  if (state.steps.length > 0) cfg.channelLadder = state.steps;
  const delays = state.delaysHours.filter((n) => Number.isFinite(n) && n > 0);
  if (delays.length > 0) cfg.delaysHours = delays;
  if (state.firstContactDelayMin !== null) {
    cfg.firstContactDelayMin = Math.floor(state.firstContactDelayMin);
  }
  return cfg;
}

/** Ancho de los menús flotantes (`w-56`), para decidir hacia dónde abrirlos. */
const MENU_WIDTH_PX = 224;

/**
 * Abre el menú hacia la izquierda si a la derecha no cabe. Depende de dónde
 * quedó el botón tras saltar de línea, no del ancho de pantalla.
 */
function useMenuSide(open: boolean, ref: RefObject<HTMLDivElement>) {
  const [side, setSide] = useState<'left' | 'right'>('left');
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const { left } = ref.current.getBoundingClientRect();
    setSide(left + MENU_WIDTH_PX > window.innerWidth - 8 ? 'right' : 'left');
  }, [open, ref]);
  return side === 'left' ? 'left-0' : 'right-0';
}

/** Cierra un menú flotante con clic fuera o Escape. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** Botón de canal dentro de un menú (elegir canal de un paso o agregar uno). */
function ChannelOption({
  channel,
  active,
  onPick,
  autoFocus,
}: {
  channel: ChannelKey;
  active?: boolean;
  onPick: () => void;
  autoFocus?: boolean;
}) {
  const label = useChannelLabel();
  const style = channelStyle(channel);
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        'flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        active
          ? cn(style.ring, style.tint, 'text-slate-800')
          : 'border-slate-200 text-slate-600 hover:bg-slate-50',
      )}
    >
      <ChannelIcon channel={channel} className="h-5 w-5" />
      {label(channel)}
    </button>
  );
}

/** Acción del menú de un paso (mover / quitar). */
function MenuAction({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-[2.25rem] w-full items-center gap-2 rounded-md px-2 text-left text-xs transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'text-rose-600 hover:bg-rose-50'
          : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Un paso de la escalera: ficha con número e ícono que abre sus opciones. */
function StepChip({
  index,
  channel,
  total,
  allowed,
  attended,
  onChannel,
  onMove,
  onRemove,
}: {
  index: number;
  channel: ChannelKey;
  total: number;
  allowed: ChannelKey[];
  attended: boolean;
  onChannel: (c: ChannelKey) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const label = useChannelLabel();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const menuSide = useMenuSide(open, ref);
  const style = channelStyle(channel);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('ladder.stepAria', { n: index + 1, channel: label(channel) })}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-[2.75rem] items-center gap-2 rounded-xl border-2 bg-white py-1.5 pl-1.5 pr-3 text-xs font-medium text-slate-700 shadow-sm transition',
          'hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          attended ? style.ring : 'border-rose-400',
          open && 'ring-2 ring-brand-200',
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg',
            style.tint,
          )}
        >
          <ChannelIcon channel={channel} className="h-4 w-4" />
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[10px] font-normal uppercase tracking-wide text-slate-400">
            {t('ladder.step', { n: index + 1 })}
          </span>
          {label(channel)}
        </span>
        {!attended && (
          <WarningCircle
            weight="fill"
            aria-hidden="true"
            className="h-4 w-4 text-rose-500"
          />
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg',
            menuSide,
          )}
        >
          <p className="mb-1.5 px-1 text-[11px] font-medium text-slate-500">
            {t('ladder.channelLabel')}
          </p>
          <div className="flex gap-1.5">
            {allowed.map((c, i) => (
              <ChannelOption
                key={c}
                channel={c}
                active={c === channel}
                autoFocus={i === 0}
                onPick={() => {
                  onChannel(c);
                  close();
                }}
              />
            ))}
          </div>
          <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
            <MenuAction
              icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
              label={t('ladder.moveBefore')}
              disabled={index === 0}
              onClick={() => {
                onMove(-1);
                close();
              }}
            />
            <MenuAction
              icon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
              label={t('ladder.moveAfter')}
              disabled={index === total - 1}
              onClick={() => {
                onMove(1);
                close();
              }}
            />
            <MenuAction
              icon={<Trash aria-hidden="true" className="h-4 w-4" />}
              label={t('ladder.remove')}
              danger
              onClick={() => {
                onRemove();
                close();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Tramo entre dos puntos de la línea: una raya con la espera editable. */
function Connector({
  value,
  options,
  format,
  ariaLabel,
  onChange,
  emptyOption,
}: {
  value: number | null;
  options: number[];
  format: (n: number) => string;
  ariaLabel: string;
  onChange: (n: number | null) => void;
  /** Texto de la opción "general"; sin esto, el tramo siempre tiene valor. */
  emptyOption?: string;
}) {
  // El valor guardado siempre aparece, aunque no sea uno de los atajos.
  const all =
    value !== null && !options.includes(value)
      ? [...options, value].sort((a, b) => a - b)
      : options;
  return (
    <div className="flex items-center">
      <span className="h-0.5 w-3 rounded bg-slate-300" aria-hidden="true" />
      <select
        aria-label={ariaLabel}
        value={value === null ? '' : String(value)}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
        className={cn(
          'h-8 cursor-pointer rounded-full border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-medium text-slate-600',
          'hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200',
        )}
      >
        {emptyOption !== undefined && <option value="">{emptyOption}</option>}
        {all.map((n) => (
          <option key={n} value={n}>
            {format(n)}
          </option>
        ))}
      </select>
      <span className="h-0.5 w-3 rounded bg-slate-300" aria-hidden="true" />
    </div>
  );
}

/**
 * Editor visual de la escalera de contacto: una línea de tiempo que parte en
 * "Lead nuevo", con un paso por intento y la espera entre ellos. Cada paso se
 * toca para cambiarle el canal, moverlo o quitarlo (sin arrastrar: funciona
 * igual con teclado y en el celular).
 */
export function ChannelLadderEditor({
  value,
  onChange,
  attendedChannels,
  cobranza = false,
  maxAttempts,
}: {
  value: LadderState;
  onChange: (next: LadderState) => void;
  /** Canales que atiende el agente; vacío = cualquiera. */
  attendedChannels: string[];
  cobranza?: boolean;
  /** Tope de intentos del agente, para avisar cuando la escalera se repite. */
  maxAttempts?: number | null;
}) {
  const { t } = useTranslation();
  const label = useChannelLabel();
  const [adding, setAdding] = useState(false);
  const closeAdd = () => setAdding(false);
  const addRef = useDismiss(adding, closeAdd);
  const addMenuSide = useMenuSide(adding, addRef);

  const attended = attendedChannels.filter(isChannel);
  // Para elegir canal se ofrecen los que atiende el agente (o todos si no
  // restringe ninguno).
  const allowed: ChannelKey[] = attended.length > 0 ? attended : [...CHANNELS];
  const { steps, delaysHours } = value;
  const minDelay = cobranza ? COBRANZA_MIN_HOURS : 0;
  const delayPresets = DELAY_PRESETS_H.filter((h) => h >= minDelay);
  const delayFor = (i: number) =>
    Math.max(delaysHours[i] ?? generalDelay(i), minDelay);

  const formatHours = (h: number) =>
    h === 168
      ? t('ladder.week')
      : h >= 24 && h % 24 === 0
        ? t('ladder.days', { count: h / 24 })
        : t('ladder.hours', { count: h });
  const formatMinutes = (m: number) =>
    m === 0
      ? t('ladder.instant')
      : m >= 60 && m % 60 === 0
        ? t('ladder.hours', { count: m / 60 })
        : t('ladder.minutes', { count: m });

  const set = (patch: Partial<LadderState>) => onChange({ ...value, ...patch });

  /** Esperas con un valor explícito para cada tramo entre `n` pasos. */
  const delaysFor = (n: number) =>
    Array.from({ length: Math.max(n - 1, delaysHours.length) }, (_, i) =>
      delayFor(i),
    );

  const customize = () => {
    const seed = allowed.slice(0, 3);
    onChange({
      ...value,
      steps: seed,
      delaysHours: Array.from({ length: Math.max(seed.length - 1, 0) }, (_, i) =>
        Math.max(generalDelay(i), minDelay),
      ),
    });
  };

  const addStep = (channel: ChannelKey) => {
    const n = steps.length + 1;
    set({ steps: [...steps, channel], delaysHours: delaysFor(n) });
    closeAdd();
  };

  const changeStep = (i: number, channel: ChannelKey) =>
    set({ steps: steps.map((c, j) => (j === i ? channel : c)) });

  // Mover cambia el orden de los canales; las esperas quedan en su tramo.
  const moveStep = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    set({ steps: next });
  };

  // Al quitar un paso se va también el tramo que lo unía con el siguiente
  // (o con el anterior, si era el último).
  const removeStep = (i: number) => {
    const next = steps.filter((_, j) => j !== i);
    if (next.length === 0) {
      set({ steps: [], delaysHours: [] });
      return;
    }
    const delays = delaysFor(steps.length);
    delays.splice(Math.min(i, steps.length - 2), 1);
    set({ steps: next, delaysHours: delays });
  };

  const setDelay = (i: number, hours: number) => {
    const delays = delaysFor(steps.length);
    delays[i] = hours;
    set({ delaysHours: delays });
  };

  const renderStep = (i: number) => (
    <StepChip
      index={i}
      channel={steps[i]}
      total={steps.length}
      allowed={allowed}
      attended={attended.length === 0 || attended.includes(steps[i])}
      onChannel={(c) => changeStep(i, c)}
      onMove={(d) => moveStep(i, d)}
      onRemove={() => removeStep(i)}
    />
  );

  const notAttended = steps
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => attended.length > 0 && !attended.includes(c));
  const repeats =
    steps.length > 0 && !!maxAttempts && maxAttempts > steps.length;

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label={t('ladder.groupLabel')}
        className="flex flex-wrap items-center gap-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
      >
        <span className="rounded-full bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-white">
          {t('ladder.start')}
        </span>
        {/* Cada espera va pegada al paso que la sigue: al saltar de línea,
            el tramo baja junto con su paso en vez de quedar colgando. */}
        <div className="flex items-center">
          <Connector
            value={value.firstContactDelayMin}
            options={FIRST_CONTACT_PRESETS_MIN}
            format={formatMinutes}
            emptyOption={t('ladder.firstDefault')}
            ariaLabel={t('ladder.waitFirst')}
            onChange={(m) => set({ firstContactDelayMin: m })}
          />
          {steps.length === 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-2">
              <span className="text-xs text-slate-600">{t('ladder.general')}</span>
              <button
                type="button"
                onClick={customize}
                className="min-h-[2rem] rounded-lg bg-brand-600 px-3 text-xs font-medium text-white transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                {t('ladder.customize')}
              </button>
            </div>
          ) : (
            renderStep(0)
          )}
        </div>

        {steps.length > 0 && (
          <>
            {steps.slice(1).map((_, k) => {
              const i = k + 1;
              return (
                <div key={i} className="flex items-center">
                  <Connector
                    value={delayFor(i - 1)}
                    options={delayPresets}
                    format={formatHours}
                    ariaLabel={t('ladder.waitBetween', { from: i, to: i + 1 })}
                    onChange={(h) => h !== null && setDelay(i - 1, h)}
                  />
                  {renderStep(i)}
                </div>
              );
            })}

            <div ref={addRef} className="relative ml-2">
              <button
                type="button"
                aria-haspopup="true"
                aria-expanded={adding}
                onClick={() => setAdding((a) => !a)}
                className="flex min-h-[2.75rem] items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 px-3 text-xs font-medium text-slate-500 transition hover:border-brand-400 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t('ladder.addStep')}
              </button>
              {adding && (
                <div
                  className={cn(
                    'absolute top-full z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg',
                    addMenuSide,
                  )}
                >
                  <p className="mb-1.5 px-1 text-[11px] font-medium text-slate-500">
                    {t('ladder.addStepMenu')}
                  </p>
                  <div className="flex gap-1.5">
                    {allowed.map((c, i) => (
                      <ChannelOption
                        key={c}
                        channel={c}
                        autoFocus={i === 0}
                        onPick={() => addStep(c)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="space-y-1 text-xs">
        {steps.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-slate-400">{t('ladder.tapHint')}</p>
            <button
              type="button"
              onClick={() => set({ steps: [], delaysHours: [] })}
              className="font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('ladder.useGeneral')}
            </button>
          </div>
        )}
        {steps.length === 0 && delaysHours.length > 0 && (
          <p className="text-slate-500">
            {t('ladder.customDelays', {
              list: delaysHours.map(formatHours).join(' · '),
            })}
          </p>
        )}
        {notAttended.map(({ c, i }) => (
          <p key={i} className="flex items-center gap-1 text-rose-600">
            <WarningCircle weight="fill" aria-hidden="true" className="h-3.5 w-3.5" />
            {t('ladder.notAttended', { n: i + 1, channel: label(c) })}
          </p>
        ))}
        {repeats && (
          <p className="text-slate-500">
            {t('ladder.cycleNote', { next: steps.length + 1 })}
          </p>
        )}
        {cobranza && <p className="text-amber-700">{t('ladder.cobranzaNote')}</p>}
      </div>
    </div>
  );
}
