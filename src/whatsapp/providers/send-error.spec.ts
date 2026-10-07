import { whatsappSendError } from './send-error';

describe('whatsappSendError', () => {
  it('traduce el motivo conocido de YCloud (sin saldo)', () => {
    const body = JSON.stringify({
      error: {
        status: 403,
        code: 'BALANCE_INSUFFICIENT',
        message: 'The account balance is insufficient.',
      },
    });
    expect(whatsappSendError('YCloud', 403, body).message).toBe(
      'Fallo al enviar WhatsApp (YCloud 403: la cuenta de YCloud no tiene saldo)',
    );
  });

  it('con un código desconocido, usa el mensaje del proveedor', () => {
    const body = JSON.stringify({
      error: { code: 'OTRA_COSA', message: 'Template not approved.' },
    });
    expect(whatsappSendError('YCloud', 400, body).message).toBe(
      'Fallo al enviar WhatsApp (YCloud 400: Template not approved.)',
    );
  });

  it('entiende el formato de error de Meta (código numérico)', () => {
    const body = JSON.stringify({
      error: {
        message: '(#131030) Recipient not in allowed list',
        code: 131030,
      },
    });
    expect(whatsappSendError('Meta', 400, body).message).toBe(
      'Fallo al enviar WhatsApp (Meta 400: (#131030) Recipient not in allowed list)',
    );
  });

  it('si la respuesta no es JSON, deja solo el código HTTP', () => {
    expect(
      whatsappSendError('YCloud', 502, '<html>Bad gateway</html>').message,
    ).toBe('Fallo al enviar WhatsApp (YCloud 502)');
  });
});
