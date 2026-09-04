import { createHmac } from 'node:crypto';
import {
  verifyRetellSignature,
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
