import type { ProviderIncident } from '@prisma/client';
import { AlertService, providerLabel } from './alerts.types';

const PROBLEM: Record<AlertService, string> = {
  whatsapp: 'WhatsApp no está enviando mensajes',
  email: 'El correo no está enviando mensajes',
  voice: 'Las llamadas no se están iniciando',
  llm: 'La IA no está respondiendo',
};

const BACK: Record<AlertService, string> = {
  whatsapp: 'WhatsApp volvió a enviar mensajes',
  email: 'El correo volvió a enviar mensajes',
  voice: 'Las llamadas volvieron a funcionar',
  llm: 'La IA volvió a responder',
};

export interface IncidentEmail {
  subject: string;
  text: string;
}

function service(i: ProviderIncident): AlertService {
  return i.service as AlertService;
}

function owner(companyName: string | null): string {
  return companyName ?? 'Plataforma';
}

/** Fecha legible en hora de Chile (donde opera la plataforma). */
function when(d: Date): string {
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** "5 min", "2 h 10 min", "3 días". Mínimo 1 min. */
export function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} días`;
  const rest = min % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function openedEmail(
  i: ProviderIncident,
  companyName: string | null,
  link: string,
): IncidentEmail {
  const problem = PROBLEM[service(i)];
  const lines = [
    `${problem} (${providerLabel(i.provider)}).`,
    '',
    `Motivo: ${i.reason}`,
    ...(i.hint ? [`Qué hacer: ${i.hint}`] : []),
    `Desde: ${when(i.openedAt)}`,
    '',
    'Mientras dure, los envíos por este canal fallan. El aviso se cierra solo ' +
      'cuando el proveedor vuelva a funcionar.',
    '',
    `Ver en el panel: ${link}`,
  ];
  return {
    subject: `${problem} — ${owner(companyName)}`,
    text: lines.join('\n'),
  };
}

export function resolvedEmail(
  i: ProviderIncident,
  companyName: string | null,
  now: Date,
): IncidentEmail {
  const back = BACK[service(i)];
  const text =
    `${back} (${providerLabel(i.provider)}). Estuvo con problemas ` +
    `${formatDuration(now.getTime() - i.openedAt.getTime())} y fallaron ` +
    `${i.failureCount} envíos.`;
  return { subject: `${back} — ${owner(companyName)}`, text };
}
