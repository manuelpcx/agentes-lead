import { Direction } from '@prisma/client';
import { ContextBuilder, formatLeadMetadata } from './context-builder.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { PromptService } from '../prompts/prompt.service';
import { ExampleLibraryService } from '../improvement/example-library.service';

function buildHarness(
  interactions: { direction: Direction; content: string }[],
) {
  const prisma = {
    db: {
      interaction: {
        findMany: jest.fn().mockResolvedValue(interactions),
      },
    },
  } as unknown as PrismaService;
  const prompts = {} as unknown as PromptService;
  const examples = {} as unknown as ExampleLibraryService;
  return new ContextBuilder(prisma, prompts, examples);
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
    const out = formatLeadMetadata({ extra: { a: 1 }, largo: 'x'.repeat(400) }, 10);
    expect(out).toContain('- extra: {"a":1}');
    expect(out).toContain('- largo: xxxxxxxxxx…');
  });
});

describe('ContextBuilder.buildMessages', () => {
  it('termina en un turno "user" aunque la última interacción sea saliente (ej. aviso de derivación)', async () => {
    const builder = buildHarness([
      { direction: Direction.inbound, content: '¿tienen hora mañana?' },
      {
        direction: Direction.outbound,
        content: 'Te comunico con nuestro equipo especializado...',
      },
    ]);

    const messages = await builder.buildMessages('lead-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: 'user',
      content: '¿tienen hora mañana?',
    });
  });

  it('sigue recortando el inicio si comienza en "assistant"', async () => {
    const builder = buildHarness([
      { direction: Direction.outbound, content: 'saludo previo' },
      { direction: Direction.inbound, content: 'hola' },
    ]);

    const messages = await builder.buildMessages('lead-1');

    expect(messages).toEqual([{ role: 'user', content: 'hola' }]);
  });

  it('devuelve vacío si todas las interacciones son salientes', async () => {
    const builder = buildHarness([
      { direction: Direction.outbound, content: 'a' },
      { direction: Direction.outbound, content: 'b' },
    ]);

    const messages = await builder.buildMessages('lead-1');

    expect(messages).toEqual([]);
  });
});
