import { Channel, Direction } from '@prisma/client';
import {
  ContextBuilder,
  formatLeadMetadata,
  formatNextAction,
  formatQualification,
  summarizeToolInput,
} from './context-builder.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { PromptService } from '../prompts/prompt.service';
import { ExampleLibraryService } from '../improvement/example-library.service';
import { SCHEDULED_CALL_TYPE, PROMISE_PAY_TYPE } from './agent.constants';
import { HistoryRow } from './conversation-history';
import { LeadMemoryService } from '../memory/lead-memory.service';

/** Fila de historial tal como la devuelve la consulta del builder. */
type HistoryLike = Pick<HistoryRow, 'direction' | 'content'> &
  Partial<HistoryRow>;

function buildHarness(interactions: HistoryLike[]) {
  const prisma = {
    db: {
      interaction: {
        findMany: jest.fn().mockResolvedValue(interactions),
      },
    },
  } as unknown as PrismaService;
  const prompts = {} as unknown as PromptService;
  const examples = {} as unknown as ExampleLibraryService;
  const memory = {
    get: jest.fn().mockResolvedValue({ summary: null, facts: [] }),
  } as unknown as LeadMemoryService;
  return new ContextBuilder(prisma, prompts, examples, memory);
}

describe('formatLeadMetadata', () => {
  it('devuelve vacío si no hay metadata útil', () => {
    expect(formatLeadMetadata(undefined)).toBe('');
    expect(formatLeadMetadata({})).toBe('');
    expect(formatLeadMetadata('texto')).toBe('');
    expect(formatLeadMetadata([1, 2])).toBe('');
  });

  it('renderiza pares clave: valor e ignora vacíos', () => {
    const out = formatLeadMetadata({
      presupuesto: 500000,
      interes: 'plan pro',
      vacio: '',
      nulo: null,
    });
    expect(out).toBe('- presupuesto: 500000\n- interes: plan pro');
  });

  it('serializa objetos anidados y recorta valores largos', () => {
    const out = formatLeadMetadata(
      { extra: { a: 1 }, largo: 'x'.repeat(400) },
      10,
    );
    expect(out).toContain('- extra: {"a":1}');
    expect(out).toContain('- largo: xxxxxxxxxx…');
  });
});

describe('formatNextAction', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  it('devuelve vacío si no hay próxima acción', () => {
    expect(
      formatNextAction({ nextActionAt: null, nextActionType: null }, now),
    ).toBe('');
  });

  it('devuelve vacío si la próxima acción ya pasó', () => {
    expect(
      formatNextAction(
        {
          nextActionAt: new Date('2026-09-07T11:00:00.000Z'),
          nextActionType: SCHEDULED_CALL_TYPE,
        },
        now,
      ),
    ).toBe('');
  });

  it('avisa que no hay que volver a agendar una llamada ya programada', () => {
    const out = formatNextAction(
      {
        nextActionAt: new Date('2026-09-07T13:00:00.000Z'),
        nextActionType: SCHEDULED_CALL_TYPE,
      },
      now,
    );
    expect(out).toContain('llamada de voz');
    expect(out).toContain('NO la agendes');
  });

  it('avisa que no hay que volver a registrar una promesa de pago ya programada', () => {
    const out = formatNextAction(
      {
        nextActionAt: new Date('2026-09-08T12:00:00.000Z'),
        nextActionType: PROMISE_PAY_TYPE,
      },
      now,
    );
    expect(out).toContain('promesa de pago');
  });

  it('para otros tipos, describe el seguimiento genérico', () => {
    const out = formatNextAction(
      {
        nextActionAt: new Date('2026-09-08T12:00:00.000Z'),
        nextActionType: 'seguimiento',
      },
      now,
    );
    expect(out).toContain('Próximo seguimiento automático');
  });
});

describe('formatQualification', () => {
  it('devuelve vacío si el lead no ha sido calificado', () => {
    expect(
      formatQualification({ qualification: null, qualificationReason: null }),
    ).toBe('');
  });

  it('incluye el nivel y el motivo cuando está calificado', () => {
    const out = formatQualification({
      qualification: 'CALIENTE' as never,
      qualificationReason: 'confirmó presupuesto y plazo',
    });
    expect(out).toContain('CALIENTE');
    expect(out).toContain('confirmó presupuesto y plazo');
  });

  it('funciona sin motivo (no revienta si viene vacío)', () => {
    const out = formatQualification({
      qualification: 'FRIO' as never,
      qualificationReason: null,
    });
    expect(out).toContain('FRIO');
  });
});

describe('summarizeToolInput', () => {
  it('resume con el primer valor de texto del input', () => {
    expect(summarizeToolInput({ clave: 'precio_plan_pro' })).toBe(
      ' (precio_plan_pro)',
    );
  });

  it('ignora valores que no son texto', () => {
    expect(summarizeToolInput({ cantidad: 3, activo: true })).toBe('');
    expect(summarizeToolInput(null)).toBe('');
    expect(summarizeToolInput(['a'])).toBe('');
  });

  it('recorta un valor largo', () => {
    const out = summarizeToolInput({ consulta: 'x'.repeat(200) });

    expect(out.length).toBeLessThan(70);
    expect(out).toContain('…');
  });
});

describe('ContextBuilder.buildMessages', () => {
  it('pide las ÚLTIMAS interacciones y las presenta en orden cronológico', async () => {
    // La consulta va en orden descendente: el mock devuelve lo más nuevo primero.
    const ahora = new Date();
    const builder = buildHarness([
      {
        direction: Direction.inbound,
        content: 'lo último que dijo',
        channel: Channel.whatsapp,
        occurredAt: ahora,
      },
      {
        direction: Direction.outbound,
        content: 'respuesta previa',
        channel: Channel.whatsapp,
        occurredAt: ahora,
      },
      {
        direction: Direction.inbound,
        content: 'lo primero que dijo',
        channel: Channel.email,
        occurredAt: ahora,
      },
    ]);

    const messages = await builder.buildMessages('lead-1', 'America/Santiago');

    expect(messages).toEqual([
      { role: 'user', content: '[Correo · recién] lo primero que dijo' },
      { role: 'assistant', content: '[WhatsApp · recién] respuesta previa' },
      { role: 'user', content: '[WhatsApp · recién] lo último que dijo' },
    ]);
  });
});
