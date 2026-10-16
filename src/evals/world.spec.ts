import { AnthropicService } from '../llm/anthropic.service';
import { FALLBACK_ESCALATION_MESSAGE } from '../agent/agent.constants';
import { CASOS } from './cases';
import { checksDeterministas, juzgar } from './judge';
import { EvalCase } from './types';
import { runCase } from './world';

/**
 * Prueba del propio banco de evaluaciones. Corre el harness completo con un
 * modelo guionado, así que no necesita API key ni gasta tokens: lo que fija es
 * que el mundo de evaluación funciona, no qué tan bien responde el agente.
 *
 * Sin esto, un banco roto pasaría por un agente malo y al revés.
 */

function toolUse(name: string, input: Record<string, unknown>) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `tu-${name}`, name, input }],
  };
}

function endTurn() {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
}

/** Modelo guionado: devuelve los turnos en orden y luego cierra. */
function scripted(turnos: unknown[], completeWith = '{"resultados":[]}') {
  const createMessage = jest.fn();
  for (const turno of turnos) {
    createMessage.mockResolvedValueOnce(turno);
  }
  createMessage.mockResolvedValue(endTurn());
  return {
    anthropic: {
      isConfigured: () => true,
      createMessage,
      complete: jest.fn().mockResolvedValue(completeWith),
    } as unknown as AnthropicService,
    createMessage,
  };
}

const CASO_BASE: EvalCase = {
  id: 'prueba',
  descripcion: 'caso de prueba del harness',
  datos: { precio_plan_pro: { monto: 45000, moneda: 'CLP' } },
  historial: [{ de: 'cliente', texto: '¿cuánto sale?', haceMinutos: 1 }],
  espera: { criterios: [] },
};

describe('runCase', () => {
  it('corre el turno real y registra herramientas y mensajes', async () => {
    const { anthropic } = scripted([
      toolUse('consultarDato', { clave: 'precio_plan_pro' }),
      toolUse('enviarWhatsApp', { mensaje: 'El plan pro sale 45000 pesos.' }),
    ]);

    const run = await runCase(CASO_BASE, anthropic);

    expect(run.error).toBeUndefined();
    expect(run.acciones.map((a) => a.tool)).toEqual([
      'consultarDato',
      'enviarWhatsApp',
    ]);
    expect(run.mensajes).toEqual([
      { canal: 'whatsapp', texto: 'El plan pro sale 45000 pesos.' },
    ]);
    expect(run.escalado).toBe(false);
  });

  it('aplica el guardrail de verdad: bloquea una cifra sin respaldo', async () => {
    const { anthropic } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'Te lo dejo en 19990.' }),
    ]);

    const run = await runCase(CASO_BASE, anthropic);

    // El mensaje bloqueado no sale; lo único que recibe el cliente es el
    // aviso de que lo contactará una persona.
    expect(run.mensajes).toEqual([
      { canal: 'whatsapp', texto: FALLBACK_ESCALATION_MESSAGE },
    ]);
    expect(run.escalado).toBe(true);
  });

  it('le pasa al modelo el prompt real, con el contexto del caso', async () => {
    const { anthropic, createMessage } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(
      {
        ...CASO_BASE,
        memoria: {
          summary: 'Volvió buscando ampliar su plan.',
          facts: [{ clave: 'objecion', valor: 'el plazo' }],
        },
        notas: ['Prefiere que la llamen por la tarde.'],
        citas: [{ titulo: 'Demo del plan pro', enHoras: 48 }],
      },
      anthropic,
    );

    expect(run.system).toContain('Volvió buscando ampliar su plan.');
    expect(run.system).toContain('objecion: el plazo');
    expect(run.system).toContain('Prefiere que la llamen por la tarde.');
    expect(run.system).toContain('Demo del plan pro');
    // Y el historial llega anotado, como en producción.
    const messages = createMessage.mock.calls[0][0].messages;
    expect(messages[messages.length - 1].content).toContain('[WhatsApp ·');
  });

  it('marca los mensajes de un operador como tales', async () => {
    const { anthropic, createMessage } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    await runCase(
      {
        ...CASO_BASE,
        historial: [
          { de: 'cliente', texto: '¿me llaman?', haceMinutos: 10 },
          { de: 'operador', texto: 'Te llamo yo', haceMinutos: 5 },
          { de: 'cliente', texto: 'dale', haceMinutos: 1 },
        ],
      },
      anthropic,
    );

    const messages = createMessage.mock.calls[0][0].messages;
    const texto = messages
      .map((m: { content: string }) => m.content)
      .join('\n');
    expect(texto).toContain('[Operador · WhatsApp ·');
  });

  it('devuelve el error en vez de reventar si el modelo falla', async () => {
    const anthropic = {
      isConfigured: () => true,
      createMessage: jest.fn().mockRejectedValue(new Error('429 rate limit')),
      complete: jest.fn(),
    } as unknown as AnthropicService;

    const run = await runCase(CASO_BASE, anthropic);

    expect(run.error).toContain('429');
  });
});

describe('runCase — llamadas', () => {
  it('el agente puede llamar en el mundo, y la llamada queda registrada', async () => {
    // Sin la herramienta, un agente que quiere llamar escala a una persona y
    // un caso como "no me llames" nunca puede detectar la llamada.
    const { anthropic } = scripted([
      toolUse('iniciarLlamada', { motivo: 'resolver dudas del contrato' }),
    ]);
    const caso: EvalCase = {
      ...CASO_BASE,
      espera: { noUsa: ['iniciarLlamada'], criterios: [] },
    };

    const run = await runCase(caso, anthropic);

    expect(run.error).toBeUndefined();
    expect(run.acciones.map((a) => a.tool)).toEqual(['iniciarLlamada']);
    expect(checksDeterministas(caso, run)).toEqual([
      { criterio: 'no usa iniciarLlamada', ok: false },
    ]);
  });
});

describe('runCase — ventana de historial y ablación', () => {
  /** Un caso con `n` turnos; el primero lleva una marca para buscarlo. */
  function casoLargo(n: number): EvalCase {
    const historial: EvalCase['historial'] = [];
    for (let i = 0; i < n; i++) {
      historial.push({
        de: i % 2 === 0 ? 'cliente' : 'agente',
        texto: i === 0 ? 'MENSAJE-MAS-ANTIGUO' : `mensaje ${i}`,
        haceMinutos: (n - i) * 10,
      });
    }
    historial.push({ de: 'cliente', texto: 'ULTIMO-MENSAJE', haceMinutos: 1 });
    return { ...CASO_BASE, historial };
  }

  function textoVisto(createMessage: jest.Mock): string {
    return createMessage.mock.calls[0][0].messages
      .map((m: { content: string }) => m.content)
      .join('\n');
  }

  it('como en producción, el modelo solo ve las últimas 30 interacciones', async () => {
    const { anthropic, createMessage } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    await runCase(casoLargo(40), anthropic);

    const visto = textoVisto(createMessage);
    expect(visto).toContain('ULTIMO-MENSAJE');
    expect(visto).not.toContain('MENSAJE-MAS-ANTIGUO');
  });

  const conMemoria: EvalCase = {
    ...CASO_BASE,
    memoria: {
      summary: 'Volvió buscando ampliar su plan.',
      facts: [{ clave: 'objecion', valor: 'el plazo' }],
    },
  };

  it('sin hechos: el prompt trae el resumen pero no los hechos', async () => {
    const { anthropic } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(conMemoria, anthropic, { sin: ['hechos'] });

    expect(run.system).toContain('Volvió buscando ampliar su plan.');
    expect(run.system).not.toContain('objecion: el plazo');
  });

  it('sin resumen: el prompt trae los hechos pero no el resumen', async () => {
    const { anthropic } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(conMemoria, anthropic, { sin: ['resumen'] });

    expect(run.system).not.toContain('Volvió buscando ampliar su plan.');
    expect(run.system).toContain('objecion: el plazo');
  });
});

describe('casos largos del banco', () => {
  const largos = CASOS.filter((c) => c.id.startsWith('memoria-larga'));

  it('hay al menos tres', () => {
    expect(largos.length).toBeGreaterThanOrEqual(3);
  });

  it.each(largos.map((c) => [c.id, c] as const))(
    '%s deja su dato clave fuera de la ventana: solo vuelve por la memoria',
    async (_id, caso) => {
      const { anthropic, createMessage } = scripted([
        toolUse('enviarWhatsApp', { mensaje: 'hola' }),
      ]);

      const run = await runCase(caso, anthropic);

      const visto = createMessage.mock.calls[0][0].messages
        .map((m: { content: string }) => m.content)
        .join('\n');
      const primero = caso.historial.find((t) => t.de === 'cliente');
      expect(visto).not.toContain(primero?.texto);
      for (const f of caso.memoria?.facts ?? []) {
        expect(run.system).toContain(f.valor);
      }
      if (caso.memoria?.summary) {
        expect(run.system).toContain(caso.memoria.summary);
      }
    },
  );
});

describe('checksDeterministas', () => {
  const run = {
    acciones: [{ tool: 'consultarDato', input: {} }],
    mensajes: [],
    escalado: false,
    system: '',
  };

  it('verifica las herramientas que debía usar', () => {
    const checks = checksDeterministas(
      { ...CASO_BASE, espera: { usa: ['consultarDato'], criterios: [] } },
      run,
    );

    expect(checks).toEqual([{ criterio: 'usa consultarDato', ok: true }]);
  });

  it('marca la herramienta que faltó, diciendo cuáles sí usó', () => {
    const checks = checksDeterministas(
      { ...CASO_BASE, espera: { usa: ['agendarCita'], criterios: [] } },
      run,
    );

    expect(checks[0].ok).toBe(false);
    expect(checks[0].detalle).toContain('consultarDato');
  });

  it('verifica las prohibidas y el escalamiento', () => {
    const checks = checksDeterministas(
      {
        ...CASO_BASE,
        espera: { noUsa: ['consultarDato'], escala: true, criterios: [] },
      },
      run,
    );

    expect(checks.map((c) => c.ok)).toEqual([false, false]);
  });

  it('reporta un turno que terminó con error', () => {
    const checks = checksDeterministas(CASO_BASE, {
      ...run,
      error: 'se cayó',
    });

    expect(checks[0]).toMatchObject({ ok: false, detalle: 'se cayó' });
  });
});

describe('juzgar', () => {
  const run = {
    acciones: [],
    mensajes: [{ canal: 'whatsapp' as const, texto: 'El plan sale 45000.' }],
    escalado: false,
    system: '',
  };
  const caso: EvalCase = {
    ...CASO_BASE,
    espera: { criterios: ['dice el precio', 'no inventa plazos'] },
  };

  it('mapea la respuesta del juez a cada criterio, en orden', async () => {
    const anthropic = {
      complete: jest.fn().mockResolvedValue(
        JSON.stringify({
          resultados: [
            { cumple: true, motivo: 'dice 45000' },
            { cumple: false, motivo: 'promete entrega en 2 días' },
          ],
        }),
      ),
    } as unknown as AnthropicService;

    const checks = await juzgar(caso, run, anthropic);

    expect(checks).toEqual([
      { criterio: 'dice el precio', ok: true, detalle: 'dice 45000' },
      {
        criterio: 'no inventa plazos',
        ok: false,
        detalle: 'promete entrega en 2 días',
      },
    ]);
  });

  it('falla los criterios, sin romperse, si el juez no devuelve JSON', async () => {
    const anthropic = {
      complete: jest.fn().mockResolvedValue('no sé qué decir'),
    } as unknown as AnthropicService;

    const checks = await juzgar(caso, run, anthropic);

    expect(checks.every((c) => !c.ok)).toBe(true);
    expect(checks[0].detalle).toContain('JSON');
  });

  it('falla los criterios si el juez se cae', async () => {
    const anthropic = {
      complete: jest.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as AnthropicService;

    const checks = await juzgar(caso, run, anthropic);

    expect(checks[0].detalle).toContain('timeout');
  });

  it('no llama al modelo si el caso no tiene criterios', async () => {
    const complete = jest.fn();
    const checks = await juzgar(CASO_BASE, run, {
      complete,
    } as unknown as AnthropicService);

    expect(checks).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('banco de casos', () => {
  it('no tiene ids repetidos', () => {
    const ids = CASOS.map((c) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada caso dice qué se espera y termina con un mensaje del cliente', () => {
    for (const caso of CASOS) {
      const tieneExpectativa =
        caso.espera.criterios.length > 0 ||
        (caso.espera.usa?.length ?? 0) > 0 ||
        (caso.espera.noUsa?.length ?? 0) > 0 ||
        caso.espera.escala !== undefined;

      expect(`${caso.id}: ${tieneExpectativa}`).toBe(`${caso.id}: true`);
      expect(`${caso.id}: ${caso.historial.at(-1)?.de}`).toBe(
        `${caso.id}: cliente`,
      );
    }
  });
});
