import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';
import type { EnvVars } from '../config/env.validation';

function buildService(key: string): CryptoService {
  const config = {
    get: () => key,
  } as unknown as ConfigService<EnvVars, true>;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  const KEY_HEX = 'a'.repeat(64); // 32 bytes en hex
  let service: CryptoService;

  beforeEach(() => {
    service = buildService(KEY_HEX);
  });

  it('cifra y descifra recuperando el texto original', () => {
    const secret = 'webhook-secret-super-seguro';
    const encrypted = service.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('produce ciphertext distinto en cada cifrado (IV aleatorio)', () => {
    const a = service.encrypt('mismo-valor');
    const b = service.encrypt('mismo-valor');
    expect(a).not.toBe(b);
  });

  it('falla al descifrar si el paquete fue manipulado', () => {
    const encrypted = service.encrypt('dato');
    const [iv, tag] = encrypted.split(':');
    const tampered = [iv, tag, Buffer.from('otro').toString('base64')].join(
      ':',
    );
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('safeEquals compara correctamente', () => {
    expect(service.safeEquals('abc', 'abc')).toBe(true);
    expect(service.safeEquals('abc', 'abd')).toBe(false);
    expect(service.safeEquals('abc', 'abcd')).toBe(false);
  });
});
