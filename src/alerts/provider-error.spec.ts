import { ProviderError, classifyProviderError } from './provider-error';

describe('classifyProviderError', () => {
  it('YCloud sin saldo: cuenta, con motivo y qué hacer', () => {
    const e = new ProviderError(
      'Fallo al enviar WhatsApp (YCloud 403: la cuenta de YCloud no tiene saldo)',
      403,
      'BALANCE_INSUFFICIENT',
    );
    expect(classifyProviderError(e, 'YCloud')).toEqual({
      kind: 'account',
      reason: 'La cuenta de YCloud no tiene saldo.',
      hint: 'Recarga saldo en YCloud.',
    });
  });

  it('Twilio suspendido, reenviado por ElevenLabs dentro de un 400: cuenta', () => {
    const e = new Error(
      'Fallo al iniciar la llamada (ElevenLabs 400): HTTP 401 error: Unable to ' +
        'create record: authentication failed, account AC377 with status 4 is not active',
    );
    expect(classifyProviderError(e, 'ElevenLabs')).toMatchObject({
      kind: 'account',
      reason: 'La cuenta de Twilio está suspendida o inactiva.',
    });
  });

  it('Anthropic sin crédito (error del SDK con status): cuenta', () => {
    const e = Object.assign(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
      ),
      { status: 400 },
    );
    expect(classifyProviderError(e, 'Anthropic')).toMatchObject({
      kind: 'account',
      reason: 'La cuenta de Anthropic no tiene crédito.',
    });
  });

  it('401 sin texto conocido: cuenta (clave rechazada)', () => {
    const e = new ProviderError('Fallo al enviar correo (Resend 401)', 401);
    expect(classifyProviderError(e, 'Resend')).toMatchObject({
      kind: 'account',
      reason: 'Resend rechazó la clave de acceso.',
    });
  });

  it('SMTP con usuario o contraseña inválidos (EAUTH): cuenta', () => {
    const e = Object.assign(new Error('Invalid login: 535'), { code: 'EAUTH' });
    expect(classifyProviderError(e, 'SMTP').kind).toBe('account');
  });

  it.each([
    [new ProviderError('Fallo (YCloud 500)', 500), 'transient'],
    [new ProviderError('Fallo (Vapi 429)', 429), 'transient'],
    [new Error('Fallo al iniciar la llamada (Vapi 503)'), 'transient'],
    [new TypeError('fetch failed'), 'transient'],
    [
      Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }),
      'transient',
    ],
    [
      Object.assign(new Error('Connection error.'), {
        name: 'APIConnectionError',
      }),
      'transient',
    ],
  ])('%s → %s', (error, kind) => {
    expect(classifyProviderError(error, 'X').kind).toBe(kind);
  });

  it('teléfono inválido (400): es del mensaje, no del proveedor', () => {
    const e = new ProviderError(
      'Fallo al enviar WhatsApp (YCloud 400: Invalid phone number)',
      400,
    );
    expect(classifyProviderError(e, 'YCloud').kind).toBe('request');
  });

  it('error sin señales (puede ser nuestro): no culpa al proveedor', () => {
    expect(
      classifyProviderError(
        new Error('Anthropic no está configurado (falta ANTHROPIC_API_KEY)'),
        'Anthropic',
      ).kind,
    ).toBe('request');
    expect(classifyProviderError('texto suelto', 'X').kind).toBe('request');
  });
  // Meta responde 400 para errores de CUENTA y de LÍMITE: el código propio
  // (ProviderError.code) es lo único que los distingue de un error del mensaje.
  it.each([
    ['131031', 'account'], // cuenta de WhatsApp Business bloqueada
    ['133010', 'account'], // número no registrado
    ['131042', 'account'], // problema de pago
    ['368', 'account'], // bloqueo temporal por políticas
    ['130429', 'transient'], // límite de envíos por segundo
    ['131048', 'transient'], // límite por spam
    ['80007', 'transient'], // límite de la cuenta de WhatsApp Business
    ['4', 'transient'], // límite de la app
    ['131056', 'request'], // límite con ESE destinatario: es del lead
  ])('Meta, código %s con HTTP 400 → %s', (code, kind) => {
    const e = new ProviderError(
      `Fallo al enviar WhatsApp (Meta 400: (#${code}) Error de Meta)`,
      400,
      code,
    );
    expect(classifyProviderError(e, 'Meta').kind).toBe(kind);
  });

  it('rebote por buzón lleno del destinatario (SMTP 552): es del mensaje', () => {
    const e = Object.assign(
      new Error(
        "Can't send mail - all recipients were rejected: 552 5.2.2 <ana@x.cl>: mailbox is over quota",
      ),
      { code: 'EENVELOPE', responseCode: 552 },
    );
    expect(classifyProviderError(e, 'SMTP').kind).toBe('request');
  });

  it('cuota de envío del remitente agotada (SMTP 550 5.4.5): cuenta', () => {
    const e = Object.assign(
      new Error('550 5.4.5 Daily user sending quota exceeded.'),
      { responseCode: 550 },
    );
    expect(classifyProviderError(e, 'SMTP').kind).toBe('account');
  });
});
