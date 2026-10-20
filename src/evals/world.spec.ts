import { AgentType } from '@prisma/client';
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

describe('runCase — datos del caso para el juez', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reúne las citas con su fecha local, los datos y el conocimiento', async () => {
    // Sin esto el juez no puede verificar "la fecha coincide con la cita" y
    // marca como falla una respuesta correcta.
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-10-16T18:16:00Z').getTime());
    const { anthropic } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(
      {
        ...CASO_BASE,
        citas: [{ titulo: 'Demo del plan pro', enHoras: 48 }],
        conocimiento: ['Se responde dentro de un día hábil.'],
      },
      anthropic,
    );

    // 48 h después, en hora de Santiago (UTC-3 en octubre).
    expect(run.datosDelCaso).toMatch(/Demo del plan pro.*18 de octubre.*15:16/);
    expect(run.datosDelCaso).toContain('precio_plan_pro');
    expect(run.datosDelCaso).toContain('Se responde dentro de un día hábil.');
  });
});

describe('runCase — mensajes viejos recuperados', () => {
  // Un dato dicho al principio, 34 mensajes de relleno y una pregunta que lo
  // necesita: el dato quedó fuera de la ventana de historial.
  const historial: EvalCase['historial'] = [
    {
      de: 'cliente',
      texto:
        'Para la cotización: somos 3 sucursales, en Maipú, Ñuñoa y Providencia.',
      haceMinutos: 5000,
    },
  ];
  for (let i = 0; i < 34; i++) {
    historial.push({
      de: i % 2 === 0 ? 'agente' : 'cliente',
      texto: `mensaje ${i}`,
      haceMinutos: 4000 - i * 10,
    });
  }
  historial.push({
    de: 'cliente',
    texto: '¿me recuerdas para cuántas sucursales era la cotización?',
    haceMinutos: 1,
  });
  const caso: EvalCase = { ...CASO_BASE, historial };

  it('trae al prompt el mensaje viejo que se relaciona con la pregunta', async () => {
    const { anthropic } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(caso, anthropic);

    expect(run.system).toContain('De conversaciones anteriores');
    expect(run.system).toContain('somos 3 sucursales, en Maipú');
  });

  it('sin recuperación, no', async () => {
    const { anthropic } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(caso, anthropic, { sin: ['recuperacion'] });

    expect(run.system).not.toContain('somos 3 sucursales');
  });
});

describe('runCase — tool_choice', () => {
  it('por defecto fuerza alguna herramienta, como producción hoy', async () => {
    const { anthropic, createMessage } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    await runCase(CASO_BASE, anthropic);

    expect(createMessage.mock.calls[0][0].toolChoice).toEqual({ type: 'any' });
  });

  it('con toolChoice auto corre el turno sin forzar herramientas', async () => {
    const { anthropic, createMessage } = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    await runCase(CASO_BASE, anthropic, { toolChoice: 'auto' });

    expect(createMessage.mock.calls[0][0].toolChoice).toBeUndefined();
  });
});

describe('runCase — promesa de pago', () => {
  it('el agente puede registrar una promesa de pago, y queda registrada', async () => {
    // Sin la herramienta, el agente de cobranza guarda la promesa en la
    // memoria y el caso no puede verificar que agende la verificación.
    const { anthropic } = scripted([
      toolUse('registrarPromesaPago', { fecha: '2026-10-23' }),
    ]);

    const run = await runCase(
      { ...CASO_BASE, agentType: AgentType.COBRANZA },
      anthropic,
    );

    expect(run.error).toBeUndefined();
    expect(run.acciones.map((a) => a.tool)).toEqual(['registrarPromesaPago']);
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

  it('las conclusiones del caso llegan al prompt; sin reflexiones, no', async () => {
    const caso: EvalCase = {
      ...CASO_BASE,
      memoria: { conclusiones: ['Su problema es de liquidez'] },
    };
    const conTodo = scripted([toolUse('enviarWhatsApp', { mensaje: 'hola' })]);
    const sinReflexiones = scripted([
      toolUse('enviarWhatsApp', { mensaje: 'hola' }),
    ]);

    const run = await runCase(caso, conTodo.anthropic);
    const ablado = await runCase(caso, sinReflexiones.anthropic, {
      sin: ['reflexiones'],
    });

    expect(run.system).toContain('Su problema es de liquidez');
    expect(ablado.system).not.toContain('Su problema es de liquidez');
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

describe('caso de hechos automáticos del banco', () => {
  const caso = CASOS.find((c) => c.id === 'memoria-hechos-automaticos')!;
  const dato = caso.historial[0].texto;

  it('el dato solo llega por la extracción: ni por la ventana ni por la recuperación', async () => {
    const { anthropic, createMessage } = scripted(
      [toolUse('enviarWhatsApp', { mensaje: 'hola' })],
      '{"hechos": []}',
    );

    const run = await runCase(caso, anthropic);

    const visto = createMessage.mock.calls[0][0].messages
      .map((m: { content: string }) => m.content)
      .join('\n');
    expect(visto).not.toContain(dato);
    expect(run.system).not.toContain('Carla');
    // La extracción sí lo vio.
    expect((anthropic.complete as jest.Mock).mock.calls[0][1]).toContain(dato);
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

describe('runCase — hechos extraídos en segundo plano', () => {
  const CASO_EXTRAE: EvalCase = {
    ...CASO_BASE,
    extraerHechos: true,
    historial: [
      { de: 'cliente', texto: 'lo decide mi socia Carla', haceMinutos: 600 },
      { de: 'agente', texto: 'Entendido.', haceMinutos: 599 },
      { de: 'cliente', texto: '¿cómo cerramos?', haceMinutos: 1 },
    ],
  };
  const HECHOS = JSON.stringify({
    hechos: [
      { clave: 'quien_decide', valor: 'su socia Carla', importancia: 9 },
    ],
  });

  it('corre la extracción real antes del turno y el agente ve el hecho', async () => {
    const { anthropic } = scripted([], HECHOS);

    const run = await runCase(CASO_EXTRAE, anthropic);

    expect(run.hechosExtraidos).toEqual(['quien_decide: su socia Carla']);
    expect(run.system).toContain('- quien_decide: su socia Carla');
  });

  it('la extracción no ve el último mensaje: el trabajo corrió antes', async () => {
    const { anthropic } = scripted([], HECHOS);

    await runCase(CASO_EXTRAE, anthropic);

    const complete = (anthropic.complete as jest.Mock).mock.calls[0];
    expect(complete[1]).toContain('Cliente: lo decide mi socia Carla');
    expect(complete[1]).not.toContain('¿cómo cerramos?');
    expect(complete[2]).toEqual({ background: true });
  });

  it('con los hechos apagados no extrae nada', async () => {
    const { anthropic } = scripted([], HECHOS);

    const run = await runCase(CASO_EXTRAE, anthropic, { sin: ['hechos'] });

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(run.hechosExtraidos).toBeUndefined();
    expect(run.system).not.toContain('quien_decide');
  });

  it('un caso sin la marca no gasta la llamada de extracción', async () => {
    const { anthropic } = scripted([], HECHOS);

    const run = await runCase(CASO_BASE, anthropic);

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(run.hechosExtraidos).toBeUndefined();
  });
});

describe('checksDeterministas', () => {
  it('falla si la extracción de fondo corrió y no anotó nada', () => {
    const run = {
      acciones: [],
      mensajes: [],
      escalado: false,
      system: '',
      hechosExtraidos: [],
    };

    expect(checksDeterministas(CASO_BASE, run)).toEqual([
      expect.objectContaining({
        criterio: 'la extracción de fondo anotó algún hecho',
        ok: false,
      }),
    ]);
  });

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

  it('le pasa al juez los datos del caso para que pueda verificarlos', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(
        JSON.stringify({ resultados: [{ cumple: true }, { cumple: true }] }),
      );

    await juzgar(
      caso,
      { ...run, datosDelCaso: 'Citas agendadas:\n- Demo: domingo 18, 15:16' },
      { complete } as unknown as AnthropicService,
    );

    expect(complete.mock.calls[0][1]).toContain('Demo: domingo 18, 15:16');
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
