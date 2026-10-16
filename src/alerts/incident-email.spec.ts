import type { ProviderIncident } from '@prisma/client';
import { formatDuration, openedEmail, resolvedEmail } from './incident-email';

const INC = {
  id: 'i1',
  companyId: 'c1',
  scope: 'company',
  service: 'whatsapp',
  provider: 'ycloud',
  kind: 'account',
  reason: 'La cuenta de YCloud no tiene saldo.',
  hint: 'Recarga saldo en YCloud.',
  failureCount: 14,
  affectedCompanyIds: ['c1'],
  openedAt: new Date('2026-10-06T19:30:00Z'),
  lastFailureAt: new Date('2026-10-06T21:30:00Z'),
  resolvedAt: null,
  openNotifiedAt: null,
  key: 'company:c1:whatsapp:ycloud',
  openKey: 'company:c1:whatsapp:ycloud',
} as ProviderIncident;

describe('correos de incidentes', () => {
  it('apertura: asunto con canal y empresa, motivo, qué hacer y enlace', () => {
    const m = openedEmail(
      INC,
      'Cobranzas del Sur',
      'https://panel.x/integrations',
    );
    expect(m.subject).toBe(
      'WhatsApp no está enviando mensajes — Cobranzas del Sur',
    );
    expect(m.text).toContain('Motivo: La cuenta de YCloud no tiene saldo.');
    expect(m.text).toContain('Qué hacer: Recarga saldo en YCloud.');
    expect(m.text).toContain('https://panel.x/integrations');
  });

  it('apertura de un incidente de plataforma: "Plataforma" en el asunto', () => {
    const m = openedEmail(
      {
        ...INC,
        scope: 'platform',
        companyId: null,
        service: 'voice',
        provider: 'elevenlabs',
      },
      null,
      'https://panel.x/platform',
    );
    expect(m.subject).toBe('Las llamadas no se están iniciando — Plataforma');
  });

  it('cierre: cuánto duró y cuántos envíos fallaron', () => {
    const m = resolvedEmail(
      INC,
      'Cobranzas del Sur',
      new Date('2026-10-06T21:40:00Z'),
    );
    expect(m.subject).toBe(
      'WhatsApp volvió a enviar mensajes — Cobranzas del Sur',
    );
    expect(m.text).toContain('Estuvo con problemas 2 h 10 min');
    expect(m.text).toContain('fallaron 14 envíos');
  });

  it.each([
    [5 * 60_000, '5 min'],
    [60 * 60_000, '1 h'],
    [130 * 60_000, '2 h 10 min'],
    [3 * 24 * 60 * 60_000, '3 días'],
    [20_000, '1 min'],
  ])('formatDuration(%i) → %s', (ms, texto) => {
    expect(formatDuration(ms)).toBe(texto);
  });
});
