import { useTranslation } from 'react-i18next';
import type { LeadQualification } from '../types';
import { Badge } from './ui';

type Tone = Parameters<typeof Badge>[0]['tone'];

const TONES: Record<LeadQualification, Tone> = {
  FRIO: 'blue',
  TIBIO: 'amber',
  CALIENTE: 'rose',
};

export function QualificationBadge({
  qualification,
}: {
  qualification: LeadQualification | null;
}) {
  const { t } = useTranslation();
  if (!qualification) {
    return null;
  }
  return <Badge tone={TONES[qualification]}>{t(`qualification.${qualification}`)}</Badge>;
}
