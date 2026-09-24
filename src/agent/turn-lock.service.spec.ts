import { LockStore, TurnLockService } from './turn-lock.service';

/** Redis de mentira: guarda claves con la semántica NX que usa el candado. */
function fakeRedis() {
  const keys = new Map<string, string>();
  const store: LockStore = {
    set: jest.fn(async (key, value, _mode, _ttl, _condition) => {
      if (keys.has(key)) {
        return null; // NX: ya tomado
      }
      keys.set(key, value);
      return 'OK';
    }),
    eval: jest.fn(async (_script, _numKeys, key, token) => {
      if (keys.get(key) === token) {
        keys.delete(key);
        return 1;
      }
      return 0;
    }),
  };
  return { store, keys };
}

describe('TurnLockService', () => {
  it('deja pasar al primero y bloquea al segundo turno del mismo lead', async () => {
    const { store } = fakeRedis();
    const lock = new TurnLockService(store);

    const primero = await lock.acquire('lead-1', 1000);
    const segundo = await lock.acquire('lead-1', 1000);

    expect(primero).toBeTruthy();
    expect(segundo).toBeNull();
  });

  it('no bloquea a leads distintos', async () => {
    const { store } = fakeRedis();
    const lock = new TurnLockService(store);

    expect(await lock.acquire('lead-1', 1000)).toBeTruthy();
    expect(await lock.acquire('lead-2', 1000)).toBeTruthy();
  });

  it('al liberar, el siguiente turno puede entrar', async () => {
    const { store } = fakeRedis();
    const lock = new TurnLockService(store);

    const token = (await lock.acquire('lead-1', 1000)) as string;
    await lock.release('lead-1', token);

    expect(await lock.acquire('lead-1', 1000)).toBeTruthy();
  });

  it('no libera el candado de otro turno (token distinto)', async () => {
    const { store, keys } = fakeRedis();
    const lock = new TurnLockService(store);

    await lock.acquire('lead-1', 1000);
    await lock.release('lead-1', 'token-de-otro');

    expect(keys.size).toBe(1);
    expect(await lock.acquire('lead-1', 1000)).toBeNull();
  });

  it('falla ABIERTO si Redis no responde: el cliente no se queda sin respuesta', async () => {
    const store = {
      set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as LockStore;
    const lock = new TurnLockService(store);

    expect(await lock.acquire('lead-1', 1000)).toBeTruthy();
    await expect(lock.release('lead-1', 'x')).resolves.toBeUndefined();
  });
});
