import { Channel, Direction } from '@prisma/client';
import {
  HistoryRow,
  SYSTEM_INSTRUCTION_PREFIX,
  annotate,
  appendSystemInstruction,
  buildHistoryWindow,
  formatAge,
  isFromOperator,
  stripSystemAnnotation,
} from './conversation-history';

const NOW = new Date('2026-09-22T15:00:00.000Z');
const TZ = 'America/Santiago';

/** Fila de historial con valores por defecto cómodos para los tests. */
function row(partial: Partial<HistoryRow> = {}): HistoryRow {
  return {
    direction: Direction.inbound,
    channel: Channel.whatsapp,
    content: 'hola',
    occurredAt: NOW,
    ...partial,
  };
}

describe('formatAge', () => {
  const hace = (ms: number) => new Date(NOW.getTime() - ms);

  it('dice "recién" para lo que acaba de pasar', () => {
    expect(formatAge(hace(5_000), NOW, TZ)).toBe('recién');
  });

  it('no se rompe si el reloj viene adelantado', () => {
    expect(formatAge(new Date(NOW.getTime() + 60_000), NOW, TZ)).toBe('recién');
  });

  it('cuenta minutos, horas y días', () => {
    expect(formatAge(hace(20 * 60_000), NOW, TZ)).toBe('hace 20 min');
    expect(formatAge(hace(3 * 3_600_000), NOW, TZ)).toBe('hace 3 h');
    expect(formatAge(hace(26 * 3_600_000), NOW, TZ)).toBe('hace 1 día');
    expect(formatAge(hace(3 * 24 * 3_600_000), NOW, TZ)).toBe('hace 3 días');
  });

  it('pasa a fecha cuando ya es de otra semana', () => {
    const viejo = formatAge(hace(40 * 24 * 3_600_000), NOW, TZ);

    expect(viejo).not.toContain('hace');
    expect(viejo).toContain('2026');
  });

  it('usa la zona horaria del lead, no la del servidor', () => {
    // 01:00 UTC del día 13 es todavía el 12 en Santiago (UTC-4).
    const instante = new Date('2026-08-13T01:00:00.000Z');
    const muchoDespues = new Date('2026-09-22T00:00:00.000Z');

    expect(formatAge(instante, muchoDespues, 'America/Santiago')).toContain(
      '12',
    );
    expect(formatAge(instante, muchoDespues, 'Europe/Madrid')).toContain('13');
  });
});

describe('isFromOperator', () => {
  it('reconoce el mensaje que escribió una persona desde el panel', () => {
    expect(
      isFromOperator(
        row({ direction: Direction.outbound, metadata: { byUserId: 'u1' } }),
      ),
    ).toBe(true);
  });

  it('no marca como operador los envíos del agente', () => {
    expect(isFromOperator(row({ direction: Direction.outbound }))).toBe(false);
  });

  it('un mensaje entrante nunca es del operador', () => {
    expect(isFromOperator(row({ metadata: { byUserId: 'u1' } }))).toBe(false);
  });
});

describe('annotate', () => {
  it('antepone canal y antigüedad', () => {
    const out = annotate(
      row({ occurredAt: new Date(NOW.getTime() - 5 * 60_000) }),
      NOW,
      TZ,
    );

    expect(out).toBe('[WhatsApp · hace 5 min] hola');
  });

  it('distingue correo y llamada', () => {
    expect(annotate(row({ channel: Channel.email }), NOW, TZ)).toContain(
      '[Correo · ',
    );
    expect(annotate(row({ channel: Channel.call }), NOW, TZ)).toContain(
      '[Llamada · ',
    );
  });

  it('marca los mensajes del operador', () => {
    const out = annotate(
      row({
        direction: Direction.outbound,
        content: 'te llamo en 10 min',
        metadata: { byUserId: 'u1' },
      }),
      NOW,
      TZ,
    );

    expect(out).toBe('[Operador · WhatsApp · recién] te llamo en 10 min');
  });
});

describe('stripSystemAnnotation', () => {
  it('quita la anotación si el modelo la copió', () => {
    expect(stripSystemAnnotation('[WhatsApp · hace 5 min] Hola Ana')).toBe(
      'Hola Ana',
    );
    expect(
      stripSystemAnnotation('[Operador · Correo · recién] Buenas tardes'),
    ).toBe('Buenas tardes');
  });

  it('no toca un mensaje normal, aunque empiece con corchetes', () => {
    expect(stripSystemAnnotation('Hola, ¿cómo estás?')).toBe(
      'Hola, ¿cómo estás?',
    );
    expect(stripSystemAnnotation('[IMPORTANTE] lee esto')).toBe(
      '[IMPORTANTE] lee esto',
    );
    expect(stripSystemAnnotation('[El cliente envió un audio]')).toBe(
      '[El cliente envió un audio]',
    );
  });
});

describe('buildHistoryWindow', () => {
  const opts = { now: NOW, timezone: TZ };

  it('termina en un turno "user" aunque la última interacción sea saliente', () => {
    const messages = buildHistoryWindow(
      [
        row({ content: '¿tienen hora mañana?' }),
        row({ direction: Direction.outbound, content: 'Te comunico...' }),
      ],
      opts,
    );

    expect(messages).toEqual([
      { role: 'user', content: '[WhatsApp · recién] ¿tienen hora mañana?' },
    ]);
  });

  it('sigue recortando el inicio si comienza en "assistant"', () => {
    const messages = buildHistoryWindow(
      [
        row({ direction: Direction.outbound, content: 'saludo previo' }),
        row({ content: 'hola' }),
      ],
      opts,
    );

    expect(messages).toEqual([
      { role: 'user', content: '[WhatsApp · recién] hola' },
    ]);
  });

  it('devuelve vacío si todas las interacciones son salientes', () => {
    const messages = buildHistoryWindow(
      [
        row({ direction: Direction.outbound, content: 'a' }),
        row({ direction: Direction.outbound, content: 'b' }),
      ],
      opts,
    );

    expect(messages).toEqual([]);
  });

  it('fusiona la ráfaga del cliente en un solo turno, anotando cada línea', () => {
    const messages = buildHistoryWindow(
      [row({ content: 'hola' }), row({ content: 'quiero info' })],
      opts,
    );

    expect(messages).toEqual([
      {
        role: 'user',
        content: '[WhatsApp · recién] hola\n[WhatsApp · recién] quiero info',
      },
    ]);
  });

  it('deja ver que un operador respondió por el agente', () => {
    const messages = buildHistoryWindow(
      [
        row({ content: '¿me pueden llamar?' }),
        row({
          direction: Direction.outbound,
          content: 'Te llamo yo en un rato',
          metadata: { byUserId: 'u1' },
        }),
        row({ content: 'dale' }),
      ],
      opts,
    );

    expect(messages[1].content).toContain('[Operador · WhatsApp ·');
  });

  it('descarta lo MÁS ANTIGUO cuando se pasa del presupuesto', () => {
    const messages = buildHistoryWindow(
      [row({ content: 'viejo'.repeat(20) }), row({ content: 'reciente' })],
      { ...opts, maxChars: 40 },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('reciente');
  });

  it('conserva el último mensaje aunque por sí solo supere el presupuesto', () => {
    const messages = buildHistoryWindow([row({ content: 'x'.repeat(500) })], {
      ...opts,
      maxChars: 20,
    });

    expect(messages).toHaveLength(1);
  });

  it('recorta un mensaje enorme (transcripción de llamada)', () => {
    const [message] = buildHistoryWindow(
      [row({ channel: Channel.call, content: 'a'.repeat(5000) })],
      opts,
    );

    expect((message.content as string).length).toBeLessThan(2150);
    expect(message.content as string).toContain('[…mensaje recortado]');
  });
});

describe('appendSystemInstruction', () => {
  it('marca la instrucción para que no se lea como un mensaje del cliente', () => {
    const messages = appendSystemInstruction([], '[SEGUIMIENTO 2/4] retoma');

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain(SYSTEM_INSTRUCTION_PREFIX);
    expect(messages[0].content).toContain('[SEGUIMIENTO 2/4] retoma');
  });

  it('la fusiona con el último turno si ya era del cliente', () => {
    const messages = appendSystemInstruction(
      [{ role: 'user', content: '[WhatsApp - recien] hola' }],
      'retoma',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('hola');
    expect(messages[0].content).toContain(SYSTEM_INSTRUCTION_PREFIX);
  });

  it('abre un turno nuevo si el último era del agente', () => {
    const messages = appendSystemInstruction(
      [{ role: 'assistant', content: 'te escribi ayer' }],
      'retoma',
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('user');
  });
});
