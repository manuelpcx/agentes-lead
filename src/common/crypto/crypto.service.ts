import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { EnvVars } from '../config/env.validation';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recomendado para GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Cifrado simétrico en reposo para credenciales de terceros y secretos por
 * empresa (p. ej. el `webhookSecret`). Formato de salida:
 *   base64(iv) : base64(authTag) : base64(ciphertext)
 *
 * Se usa cifrado reversible (no hash) porque necesitamos el valor en claro
 * para recomputar la firma HMAC del webhook.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<EnvVars, true>) {
    this.key = CryptoService.decodeKey(config.get('ENCRYPTION_KEY'));
  }

  /** Cifra texto plano y devuelve el paquete `iv:tag:ciphertext` en base64. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /** Descifra un paquete producido por `encrypt`. Lanza si fue manipulado. */
  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Payload cifrado con formato inválido');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('AuthTag inválido');
    }
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Comparación en tiempo constante para evitar timing attacks. */
  safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  /** Decodifica la clave de 32 bytes desde hex o base64. */
  private static decodeKey(raw: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) {
      return b64;
    }
    // No debería ocurrir: la validación de entorno ya lo garantiza.
    throw new Error('ENCRYPTION_KEY no representa 32 bytes válidos');
  }
}
