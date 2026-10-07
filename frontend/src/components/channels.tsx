import { CheckCircle, EnvelopeSimple, Phone, WhatsappLogo } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from './ui';

/** Canales por los que un agente atiende y contacta, en el orden en que se muestran. */
export const CHANNELS = ['whatsapp', 'email', 'call'] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is ChannelKey {
  return CHANNELS.includes(value as ChannelKey);
}

/** Ícono y color de cada canal. El color acompaña al nombre, nunca lo reemplaza. */
const CHANNEL_STYLE: Record<
  ChannelKey,
  { Icon: typeof Phone; color: string; tint: string; ring: string }
> = {
  whatsapp: {
    Icon: WhatsappLogo,
    color: 'text-emerald-600',
    tint: 'bg-emerald-50',
    ring: 'border-emerald-500',
  },
  email: {
    Icon: EnvelopeSimple,
    color: 'text-sky-600',
    tint: 'bg-sky-50',
    ring: 'border-sky-500',
  },
  call: {
    Icon: Phone,
    color: 'text-violet-600',
    tint: 'bg-violet-50',
    ring: 'border-violet-500',
  },
};

export function channelStyle(channel: ChannelKey) {
  return CHANNEL_STYLE[channel];
}

/** Nombre del canal en el idioma del panel ("WhatsApp", "Correo", "Llamada"). */
export function useChannelLabel() {
  const { t } = useTranslation();
  const labels = t('channels', { returnObjects: true }) as Record<string, string>;
  return (channel: string) => labels[channel] ?? channel;
}

/** Ícono del canal. Decorativo: quien lo usa pone el nombre al lado. */
export function ChannelIcon({
  channel,
  className,
}: {
  channel: ChannelKey;
  className?: string;
}) {
  const { Icon, color } = CHANNEL_STYLE[channel];
  return (
    <Icon
      weight="fill"
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0', color, className)}
    />
  );
}

/**
 * Selector de canales como tarjetas con ícono. Cada tarjeta es un botón que
 * se prende y apaga (`aria-pressed`); la seleccionada lleva además un check,
 * para no depender solo del color.
 */
export function ChannelPicker({
  selected,
  onToggle,
  disabled,
}: {
  selected: string[];
  onToggle: (channel: ChannelKey) => void;
  disabled?: boolean;
}) {
  const label = useChannelLabel();
  return (
    <div className="grid grid-cols-3 gap-2">
      {CHANNELS.map((channel) => {
        const on = selected.includes(channel);
        const style = CHANNEL_STYLE[channel];
        return (
          <button
            key={channel}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(channel)}
            className={cn(
              'relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-xs font-medium transition',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              on
                ? cn(style.ring, style.tint, 'text-slate-800')
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {on && (
              <CheckCircle
                weight="fill"
                aria-hidden="true"
                className={cn('absolute right-1.5 top-1.5 h-4 w-4', style.color)}
              />
            )}
            <ChannelIcon
              channel={channel}
              className={cn('h-6 w-6', !on && 'opacity-60')}
            />
            {label(channel)}
          </button>
        );
      })}
    </div>
  );
}

/** Lista compacta de solo lectura: ícono + nombre de cada canal. */
export function ChannelList({
  channels,
  emptyLabel,
}: {
  channels: string[];
  emptyLabel: string;
}) {
  const label = useChannelLabel();
  const known = channels.filter(isChannel);
  if (known.length === 0) {
    return <span>{emptyLabel}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 align-middle">
      {known.map((channel) => (
        <span key={channel} className="inline-flex items-center gap-1">
          <ChannelIcon channel={channel} className="h-3.5 w-3.5" />
          {label(channel)}
        </span>
      ))}
    </span>
  );
}
