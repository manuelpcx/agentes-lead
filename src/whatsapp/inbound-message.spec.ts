import { parseInboundMessage } from './inbound-message';

describe('parseInboundMessage', () => {
  it('lee un mensaje de texto', () => {
    expect(
      parseInboundMessage({ type: 'text', text: { body: 'hola' } }),
    ).toEqual({ text: 'hola', wakeAgent: true });
  });

  it('acepta texto aunque falte el campo "type"', () => {
    expect(parseInboundMessage({ text: { body: 'hola' } })).toEqual({
      text: 'hola',
      wakeAgent: true,
    });
  });

  it('trata el toque de un botón de plantilla como texto del cliente', () => {
    expect(
      parseInboundMessage({
        type: 'button',
        button: { text: 'Sí, me interesa', payload: 'SI' },
      }),
    ).toEqual({ text: 'Sí, me interesa', wakeAgent: true });
  });

  it('lee la respuesta de un botón interactivo (Meta, snake_case)', () => {
    expect(
      parseInboundMessage({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'b1', title: 'Agendar hora' },
        },
      }),
    ).toEqual({ text: 'Agendar hora', wakeAgent: true });
  });

  it('lee la respuesta de una lista (YCloud, camelCase)', () => {
    expect(
      parseInboundMessage({
        type: 'interactive',
        interactive: {
          type: 'listReply',
          listReply: { id: 'l1', title: 'Plan pro' },
        },
      }),
    ).toEqual({ text: 'Plan pro', wakeAgent: true });
  });

  it('marca un audio como adjunto que el agente no puede abrir', () => {
    const parsed = parseInboundMessage({ type: 'audio', audio: { id: 'a1' } });

    expect(parsed?.text).toBe('[El cliente envió un audio]');
    expect(parsed?.wakeAgent).toBe(true);
  });

  it('distingue una nota de voz de un archivo de audio', () => {
    expect(
      parseInboundMessage({ type: 'audio', audio: { voice: true } })?.text,
    ).toBe('[El cliente envió una nota de voz]');
  });

  it('conserva el pie de foto de una imagen', () => {
    expect(
      parseInboundMessage({
        type: 'image',
        image: { id: 'i1', caption: '¿este modelo tienen?' },
      })?.text,
    ).toBe('[El cliente envió una imagen] con el texto: ¿este modelo tienen?');
  });

  it('nombra el archivo de un documento', () => {
    expect(
      parseInboundMessage({
        type: 'document',
        document: { filename: 'contrato.pdf' },
      })?.text,
    ).toBe('[El cliente envió un documento: contrato.pdf]');
  });

  it('registra una reacción pero NO despierta al agente', () => {
    const parsed = parseInboundMessage({
      type: 'reaction',
      reaction: { emoji: '👍', message_id: 'm1' },
    });

    expect(parsed?.text).toBe('[El cliente reaccionó con 👍]');
    expect(parsed?.wakeAgent).toBe(false);
  });

  it('describe una ubicación por su nombre, sin coordenadas', () => {
    const parsed = parseInboundMessage({
      type: 'location',
      location: {
        latitude: -33.4489,
        longitude: -70.6693,
        name: 'Oficina central',
      },
    });

    expect(parsed?.text).toBe(
      '[El cliente compartió su ubicación: Oficina central]',
    );
    expect(parsed?.text).not.toContain('70.6693');
  });

  it('ignora los avisos de la plataforma (canal system)', () => {
    expect(parseInboundMessage({ type: 'system', system: {} })).toBeNull();
  });

  it('no inventa contenido para un tipo desconocido, pero lo deja anotado', () => {
    const parsed = parseInboundMessage({ type: 'sonar_futuro' });

    expect(parsed?.text).toContain('no puedo abrir');
    expect(parsed?.text).toContain('sonar_futuro');
    expect(parsed?.wakeAgent).toBe(true);
  });

  it('devuelve null si el payload no trae nada aprovechable', () => {
    expect(parseInboundMessage(undefined)).toBeNull();
    expect(parseInboundMessage({})).toBeNull();
    expect(parseInboundMessage({ type: 'text', text: {} })).toBeNull();
  });
});
