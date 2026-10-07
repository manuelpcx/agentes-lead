import { createHmac } from 'node:crypto';
import {
  verifyElevenLabsSignature,
  verifyMetaSignature,
  verifyRetellSignature,
  verifySharedSecret,
  verifyYCloudSignature,
} from './webhook-signature';

describe('verifyRetellSignature', () => {
  const apiKey = 'key_test_123';
  const rawBody = Buffer.from(JSON.stringify({ event: 'call_analyzed' }));

  function sign(body: Buffer, ts: number, key: string): string {
    const digest = createHmac('sha256', key)
      .update(Buffer.concat([body, Buffer.from(String(ts))]))
      .digest('hex');
    return `v=${ts},d=${digest}`;
  }

  it('acepta una firma válida y reciente', () => {
    const header = sign(rawBody, Date.now(), apiKey);
    expect(verifyRetellSignature(rawBody, header, apiKey)).toBe(true);
  });

  it('rechaza sin header', () => {
    expect(verifyRetellSignature(rawBody, undefined, apiKey)).toBe(false);
  });

  it('rechaza con formato inválido', () => {
    expect(verifyRetellSignature(rawBody, 'no-es-el-formato', apiKey)).toBe(
      false,
    );
  });

  it('rechaza si el digest no coincide (key equivocada)', () => {
    const header = sign(rawBody, Date.now(), apiKey);
    expect(verifyRetellSignature(rawBody, header, 'otra-key')).toBe(false);
  });

  it('rechaza si el body fue alterado', () => {
    const header = sign(rawBody, Date.now(), apiKey);
    const tampered = Buffer.from(JSON.stringify({ event: 'otra-cosa' }));
    expect(verifyRetellSignature(tampered, header, apiKey)).toBe(false);
  });

  it('rechaza un timestamp fuera de la ventana de 5 min (replay)', () => {
    const old = Date.now() - 10 * 60 * 1000;
    const header = sign(rawBody, old, apiKey);
    expect(verifyRetellSignature(rawBody, header, apiKey)).toBe(false);
  });
});

describe('verifyYCloudSignature', () => {
  const secret = 'wh_secret_abc';
  const rawBody = Buffer.from(
    JSON.stringify({ type: 'whatsapp.inbound_message.received' }),
  );

  function sign(body: Buffer, tsSeconds: number, key: string): string {
    const signedPayload = Buffer.concat([Buffer.from(`${tsSeconds}.`), body]);
    const digest = createHmac('sha256', key)
      .update(signedPayload)
      .digest('hex');
    return `t=${tsSeconds},s=${digest}`;
  }

  it('acepta una firma válida y reciente', () => {
    const header = sign(rawBody, Math.floor(Date.now() / 1000), secret);
    expect(verifyYCloudSignature(rawBody, header, secret)).toBe(true);
  });

  it('rechaza sin header', () => {
    expect(verifyYCloudSignature(rawBody, undefined, secret)).toBe(false);
  });

  it('rechaza con formato inválido', () => {
    expect(verifyYCloudSignature(rawBody, 'v=1,d=x', secret)).toBe(false);
  });

  it('rechaza si el secreto no coincide', () => {
    const header = sign(rawBody, Math.floor(Date.now() / 1000), secret);
    expect(verifyYCloudSignature(rawBody, header, 'otro-secreto')).toBe(false);
  });

  it('rechaza si el body fue alterado', () => {
    const header = sign(rawBody, Math.floor(Date.now() / 1000), secret);
    const tampered = Buffer.from(JSON.stringify({ type: 'otra-cosa' }));
    expect(verifyYCloudSignature(tampered, header, secret)).toBe(false);
  });

  it('rechaza un timestamp fuera de la ventana de 5 min (replay)', () => {
    const old = Math.floor(Date.now() / 1000) - 10 * 60;
    const header = sign(rawBody, old, secret);
    expect(verifyYCloudSignature(rawBody, header, secret)).toBe(false);
  });
});

describe('verifyMetaSignature', () => {
  const appSecret = 'meta_app_secret';
  const rawBody = Buffer.from(
    JSON.stringify({ object: 'whatsapp_business_account' }),
  );
  const sign = (body: Buffer, key: string) =>
    `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

  it('acepta una firma válida', () => {
    expect(
      verifyMetaSignature(rawBody, sign(rawBody, appSecret), appSecret),
    ).toBe(true);
  });

  it('acepta el hex en mayúsculas (Meta lo manda en minúsculas, pero no depende de eso)', () => {
    const header = sign(rawBody, appSecret)
      .toUpperCase()
      .replace('SHA256=', 'sha256=');
    expect(verifyMetaSignature(rawBody, header, appSecret)).toBe(true);
  });

  it('rechaza sin header o con formato distinto', () => {
    expect(verifyMetaSignature(rawBody, undefined, appSecret)).toBe(false);
    expect(verifyMetaSignature(rawBody, 'sha1=abc', appSecret)).toBe(false);
    expect(verifyMetaSignature(rawBody, 'sha256=zz', appSecret)).toBe(false);
  });

  it('rechaza si el secreto no coincide o el body fue alterado', () => {
    const header = sign(rawBody, appSecret);
    expect(verifyMetaSignature(rawBody, header, 'otro')).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{}'), header, appSecret)).toBe(
      false,
    );
  });
});

describe('verifySharedSecret', () => {
  it('acepta el secreto exacto (con espacios al borde recortados)', () => {
    expect(verifySharedSecret(' s3cr3t ', 's3cr3t')).toBe(true);
  });

  it('rechaza sin header, con otro valor, o si no hay secreto configurado', () => {
    expect(verifySharedSecret(undefined, 's3cr3t')).toBe(false);
    expect(verifySharedSecret('otro', 's3cr3t')).toBe(false);
    expect(verifySharedSecret('', 's3cr3t')).toBe(false);
    expect(verifySharedSecret('s3cr3t', '')).toBe(false);
  });
});

describe('verifyElevenLabsSignature', () => {
  const secret = 'wsec_abc';
  const rawBody = Buffer.from(
    JSON.stringify({ type: 'post_call_transcription' }),
  );

  function digest(body: Buffer, tsSeconds: number, key: string): string {
    return createHmac('sha256', key)
      .update(Buffer.concat([Buffer.from(`${tsSeconds}.`), body]))
      .digest('hex');
  }
  const now = () => Math.floor(Date.now() / 1000);

  it('acepta una firma válida y reciente', () => {
    const ts = now();
    const header = `t=${ts},v0=${digest(rawBody, ts, secret)}`;
    expect(verifyElevenLabsSignature(rawBody, header, secret)).toBe(true);
  });

  it('durante una rotación de secreto, basta con que calce una de las firmas', () => {
    const ts = now();
    const header =
      `t=${ts},v0=${digest(rawBody, ts, 'secreto-viejo')},` +
      `v0=${digest(rawBody, ts, secret)}`;
    expect(verifyElevenLabsSignature(rawBody, header, secret)).toBe(true);
  });

  it('acepta un reintento de hace 20 min (ElevenLabs tolera 30)', () => {
    const ts = now() - 20 * 60;
    const header = `t=${ts},v0=${digest(rawBody, ts, secret)}`;
    expect(verifyElevenLabsSignature(rawBody, header, secret)).toBe(true);
  });

  it('rechaza un timestamp de hace más de 30 min (replay)', () => {
    const ts = now() - 31 * 60;
    const header = `t=${ts},v0=${digest(rawBody, ts, secret)}`;
    expect(verifyElevenLabsSignature(rawBody, header, secret)).toBe(false);
  });

  it('rechaza con otro secreto, cuerpo alterado, sin header o sin v0', () => {
    const ts = now();
    const header = `t=${ts},v0=${digest(rawBody, ts, secret)}`;
    expect(verifyElevenLabsSignature(rawBody, header, 'otro')).toBe(false);
    expect(
      verifyElevenLabsSignature(Buffer.from('{"alterado":1}'), header, secret),
    ).toBe(false);
    expect(verifyElevenLabsSignature(rawBody, undefined, secret)).toBe(false);
    expect(verifyElevenLabsSignature(rawBody, `t=${ts}`, secret)).toBe(false);
  });
});
