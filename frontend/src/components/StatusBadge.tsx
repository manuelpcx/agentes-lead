import { useTranslation } from 'react-i18next';
import type { LeadStatus } from '../types';
import { Badge } from './ui';

type Tone = Parameters<typeof Badge>[0]['tone'];

const TONES: Record<LeadStatus, Tone> = {
  NUEVO: 'slate',
  CONTACTADO: 'blue',
  EN_CONVERSACION: 'indigo',
  AGENDADO: 'amber',
  CERRADO_GANADO: 'green',
  CERRADO_PERDIDO: 'rose',
  ESCALADO_HUMANO: 'orange',
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[status]}>{t(`leadStatus.${status}`)}</Badge>;
}
