import { validateEnv } from './env.validation';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv — embeddings', () => {
  it('una similitud mínima vacía usa la del proveedor, no 0', () => {
    // `EMBEDDINGS_MIN_SIMILARITY=` en el .env: sin esto, todo pasaría el umbral.
    expect(
      validateEnv({ ...BASE, EMBEDDINGS_MIN_SIMILARITY: '' })
        .EMBEDDINGS_MIN_SIMILARITY,
    ).toBeUndefined();
  });

  it('lee una similitud mínima explícita', () => {
    expect(
      validateEnv({ ...BASE, EMBEDDINGS_MIN_SIMILARITY: '0.45' })
        .EMBEDDINGS_MIN_SIMILARITY,
    ).toBe(0.45);
  });

  it('rechaza una similitud fuera de 0 a 1', () => {
    expect(() =>
      validateEnv({ ...BASE, EMBEDDINGS_MIN_SIMILARITY: '3' }),
    ).toThrow('EMBEDDINGS_MIN_SIMILARITY');
  });

  it('rechaza una dimensión que no cabe en la columna vector(1024)', () => {
    expect(() => validateEnv({ ...BASE, EMBEDDINGS_DIMENSION: '512' })).toThrow(
      'EMBEDDINGS_DIMENSION',
    );
  });

  it('exige la key de Voyage si se elige Voyage', () => {
    expect(() =>
      validateEnv({ ...BASE, EMBEDDINGS_PROVIDER: 'voyage' }),
    ).toThrow('VOYAGE_API_KEY');
  });
});

describe('validateEnv — umbral de mensajes', () => {
  it('lee el umbral de recuperación aparte del de conocimiento', () => {
    const env = validateEnv({
      ...BASE,
      EMBEDDINGS_MIN_SIMILARITY: '0.6',
      EMBEDDINGS_RECALL_MIN_SIMILARITY: '0.3',
    });

    expect(env.EMBEDDINGS_MIN_SIMILARITY).toBe(0.6);
    expect(env.EMBEDDINGS_RECALL_MIN_SIMILARITY).toBe(0.3);
  });

  it('vacío usa el del proveedor', () => {
    expect(
      validateEnv({ ...BASE, EMBEDDINGS_RECALL_MIN_SIMILARITY: '' })
        .EMBEDDINGS_RECALL_MIN_SIMILARITY,
    ).toBeUndefined();
  });
});
