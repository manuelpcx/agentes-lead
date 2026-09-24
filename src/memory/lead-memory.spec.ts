import {
  MAX_FACTS,
  MemoryFact,
  formatMemory,
  normalizeKey,
  parseFacts,
  removeFact,
  upsertFact,
} from './lead-memory';

function fact(clave: string, valor: string): MemoryFact {
  return { clave, valor, registradoEn: new Date().toISOString() };
}

describe('normalizeKey', () => {
  it('quita tildes, espacios y mayúsculas', () => {
    expect(normalizeKey('  Presupuesto Máximo ')).toBe('presupuesto_maximo');
    expect(normalizeKey('Producto de interés')).toBe('producto_de_interes');
  });

  it('colapsa variantes de la misma clave', () => {
    expect(normalizeKey('Presupuesto')).toBe(normalizeKey('presupuesto '));
    expect(normalizeKey('horario-preferido')).toBe(
      normalizeKey('Horario Preferido'),
    );
  });

  it('devuelve vacío si no queda nada utilizable', () => {
    expect(normalizeKey('   ')).toBe('');
    expect(normalizeKey('***')).toBe('');
  });
});

describe('parseFacts', () => {
  it('devuelve lista vacía ante cualquier cosa que no sea un arreglo', () => {
    expect(parseFacts(undefined)).toEqual([]);
    expect(parseFacts({ clave: 'x' })).toEqual([]);
    expect(parseFacts('[]')).toEqual([]);
  });

  it('descarta entradas mal formadas y normaliza las buenas', () => {
    const out = parseFacts([
      { clave: 'Presupuesto', valor: '  hasta 600 mil ' },
      { clave: 'sin_valor' },
      { valor: 'sin clave' },
      null,
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].clave).toBe('presupuesto');
    expect(out[0].valor).toBe('hasta 600 mil');
  });
});

describe('upsertFact', () => {
  it('agrega un hecho nuevo', () => {
    const out = upsertFact([], 'objecion', 'le parece caro');

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      clave: 'objecion',
      valor: 'le parece caro',
    });
  });

  it('reemplaza la misma clave en vez de duplicarla', () => {
    const out = upsertFact(
      [fact('objecion', 'le parece caro')],
      'Objeción',
      'ya no es el precio, es el plazo',
    );

    expect(out).toHaveLength(1);
    expect(out[0].valor).toBe('ya no es el precio, es el plazo');
  });

  it('ignora claves o valores vacíos', () => {
    const previos = [fact('a', 'b')];

    expect(upsertFact(previos, '', 'x')).toBe(previos);
    expect(upsertFact(previos, 'x', '   ')).toBe(previos);
  });

  it('descarta los más antiguos al pasar el tope', () => {
    let facts: MemoryFact[] = [];
    for (let i = 0; i < MAX_FACTS + 5; i++) {
      facts = upsertFact(facts, `clave_${i}`, `valor ${i}`);
    }

    expect(facts).toHaveLength(MAX_FACTS);
    expect(facts[0].clave).toBe('clave_5');
    expect(facts[facts.length - 1].clave).toBe(`clave_${MAX_FACTS + 4}`);
  });

  it('recorta un valor demasiado largo', () => {
    const out = upsertFact([], 'nota', 'x'.repeat(500));

    expect(out[0].valor.length).toBeLessThanOrEqual(200);
  });
});

describe('removeFact', () => {
  it('quita por clave, sin importar cómo se escriba', () => {
    const out = removeFact([fact('presupuesto', 'x')], 'Presupuesto');

    expect(out).toEqual([]);
  });

  it('deja la lista igual si la clave no existe', () => {
    const previos = [fact('a', 'b')];

    expect(removeFact(previos, 'z')).toEqual(previos);
  });
});

describe('formatMemory', () => {
  it('devuelve vacío si no hay nada guardado', () => {
    expect(formatMemory(null, [])).toBe('');
    expect(formatMemory('   ', [])).toBe('');
  });

  it('incluye resumen y hechos', () => {
    const out = formatMemory(
      'Compró el año pasado y volvió por una ampliación.',
      [fact('producto_de_interes', 'plan pro')],
    );

    expect(out).toContain('Lo que ya sabes de esta persona');
    expect(out).toContain('volvió por una ampliación');
    expect(out).toContain('- producto_de_interes: plan pro');
  });

  it('advierte que la memoria NO es un dato verificado', () => {
    const out = formatMemory('algo', []);

    expect(out).toContain('no un dato verificado');
    expect(out).toContain('consúltala con tus herramientas');
  });

  it('funciona solo con hechos, sin resumen', () => {
    const out = formatMemory(null, [fact('objecion', 'el plazo')]);

    expect(out).toContain('- objecion: el plazo');
  });
});
