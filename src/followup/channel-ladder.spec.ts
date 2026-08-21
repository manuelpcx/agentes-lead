import {
  DEFAULT_LADDER,
  buildFollowUpInstruction,
  parseLadder,
  resolveFollowUpChannel,
} from './channel-ladder';

describe('parseLadder', () => {
  it('cae al default si es vacío o inválido', () => {
    expect(parseLadder(undefined)).toEqual(DEFAULT_LADDER);
    expect(parseLadder('')).toEqual(DEFAULT_LADDER);
    expect(parseLadder('sms,fax')).toEqual(DEFAULT_LADDER);
  });

  it('parsea y filtra canales válidos', () => {
    expect(parseLadder('email, whatsapp , call')).toEqual([
      'email',
      'whatsapp',
      'call',
    ]);
    expect(parseLadder('WhatsApp,sms,email')).toEqual(['whatsapp', 'email']);
  });
});

describe('resolveFollowUpChannel', () => {
  const both = { hasEmail: true, hasPhone: true };
  const ladder = DEFAULT_LADDER; // email, whatsapp, whatsapp, email

  it('sigue la escalera cuando el lead es contactable', () => {
    expect(resolveFollowUpChannel(1, ladder, both)).toBe('email');
    expect(resolveFollowUpChannel(2, ladder, both)).toBe('whatsapp');
    expect(resolveFollowUpChannel(4, ladder, both)).toBe('email');
  });

  it('cicla la escalera para intentos más allá de su largo', () => {
    expect(resolveFollowUpChannel(5, ladder, both)).toBe('email'); // (5-1)%4=0
  });

  it('cae a otro canal si el preferido no es usable', () => {
    // Preferido email pero sin email → cae a WhatsApp (tiene teléfono).
    expect(
      resolveFollowUpChannel(1, ladder, { hasEmail: false, hasPhone: true }),
    ).toBe('whatsapp');
    // Preferido WhatsApp pero sin teléfono → cae a correo.
    expect(
      resolveFollowUpChannel(2, ladder, { hasEmail: true, hasPhone: false }),
    ).toBe('email');
  });

  it('null si el lead no tiene ningún dato de contacto', () => {
    expect(
      resolveFollowUpChannel(1, ladder, { hasEmail: false, hasPhone: false }),
    ).toBeNull();
  });
});

describe('buildFollowUpInstruction', () => {
  it('primer contacto por correo nombra la herramienta enviarCorreo', () => {
    const txt = buildFollowUpInstruction({
      channel: 'email',
      attempt: 1,
      maxAttempts: 4,
      primerContacto: true,
      source: 'landing',
    });
    expect(txt).toContain('PRIMER CONTACTO · CORREO');
    expect(txt).toContain('enviarCorreo');
  });

  it('seguimiento por WhatsApp nombra enviarWhatsApp e intento', () => {
    const txt = buildFollowUpInstruction({
      channel: 'whatsapp',
      attempt: 2,
      maxAttempts: 4,
      primerContacto: false,
    });
    expect(txt).toContain('SEGUIMIENTO 2/4 · WHATSAPP');
    expect(txt).toContain('enviarWhatsApp');
  });
});
