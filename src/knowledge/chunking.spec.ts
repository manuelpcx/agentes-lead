import { chunkText } from './chunking';

describe('chunkText', () => {
  it('devuelve [] para texto vacío', () => {
    expect(chunkText('   ')).toEqual([]);
  });

  it('devuelve un solo fragmento si el texto cabe', () => {
    const out = chunkText('texto corto');
    expect(out).toEqual(['texto corto']);
  });

  it('trocea texto largo en múltiples fragmentos', () => {
    const text = 'palabra '.repeat(500).trim(); // ~4000 chars
    const out = chunkText(text, { chunkSize: 1000, overlap: 150 });
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c) => expect(c.length).toBeLessThanOrEqual(1000));
  });

  it('no corta palabras a la mitad', () => {
    const text = 'palabra '.repeat(500).trim();
    const out = chunkText(text, { chunkSize: 1000, overlap: 150 });
    out.forEach((c) => {
      expect(c.startsWith(' ')).toBe(false);
      expect(c.endsWith(' ')).toBe(false);
      // cada token completo
      c.split(' ').forEach((tok) => expect(tok).toBe('palabra'));
    });
  });

  it('los fragmentos contiguos se solapan', () => {
    const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
    const out = chunkText(words, { chunkSize: 500, overlap: 100 });
    // El final del primer fragmento reaparece al inicio del segundo.
    const tailFirst = out[0].split(' ').slice(-3).join(' ');
    expect(out[1]).toContain(tailFirst.split(' ')[0]);
  });
});
