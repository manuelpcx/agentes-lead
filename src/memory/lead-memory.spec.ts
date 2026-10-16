import {
  MAX_FACTS,
  MemoryFact,
  formatMemory,
  normalizeImportance,
  normalizeKey,
  parseFacts,
  removeFact,
  upsertFact,
} from './lead-memory';

function fact(clave: string, valor: string, importancia = 5): MemoryFact {
  return { clave, valor, importancia, registradoEn: new Date().toISOString() };
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

  it('lee la importancia guardada y la acota de 1 a 10', () => {
    const out = parseFacts([
      { clave: 'a', valor: '1', importancia: 9 },
      { clave: 'b', valor: '2', importancia: 42 },
      { clave: 'c', valor: '3', importancia: 0 },
      { clave: 'd', valor: '4', importancia: 6.6 },
    ]);

    expect(out.map((f) => f.importancia)).toEqual([9, 10, 1, 7]);
  });

  it('acepta una importancia escrita como texto', () => {
    expect(normalizeImportance('9')).toBe(9);
    expect(normalizeImportance(' 3 ')).toBe(3);
  });

  it('a los hechos guardados antes de la importancia les da un 5', () => {
    const out = parseFacts([
      { clave: 'viejo', valor: 'sin importancia' },
      { clave: 'raro', valor: 'x', importancia: 'alta' },
    ]);

    expect(out.map((f) => f.importancia)).toEqual([5, 5]);
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

  it('al pasar el tope descarta el menos importante, no el más antiguo', () => {
    // El primer dato que se aprendió es justo el que no se puede perder.
    let facts: MemoryFact[] = [
      fact('no_es_el_titular', 'contesta el hermano', 10),
    ];
    for (let i = 0; i < MAX_FACTS; i++) {
      facts = upsertFact(facts, `detalle_${i}`, `valor ${i}`, 3);
    }

    const claves = facts.map((f) => f.clave);
    expect(facts).toHaveLength(MAX_FACTS);
    expect(claves).toContain('no_es_el_titular');
    expect(claves).not.toContain('detalle_0');
    expect(claves).toContain(`detalle_${MAX_FACTS - 1}`);
  });

  it('un hecho nuevo menos importante que todos no desplaza a ninguno', () => {
    let facts: MemoryFact[] = [];
    for (let i = 0; i < MAX_FACTS; i++) {
      facts = upsertFact(facts, `clave_${i}`, `valor ${i}`, 9);
    }

    const out = upsertFact(facts, 'color_favorito', 'azul', 2);

    expect(out.map((f) => f.clave)).not.toContain('color_favorito');
    expect(out).toHaveLength(MAX_FACTS);
    expect(out.map((f) => f.clave)).toContain('clave_0');
  });

  it('al reemplazar una clave guarda también su nueva importancia', () => {
    const out = upsertFact(
      [fact('pago', 'dijo que pagaría', 5)],
      'pago',
      'prometió pagar el viernes',
      9,
    );

    expect(out).toEqual([
      expect.objectContaining({ clave: 'pago', importancia: 9 }),
    ]);
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
