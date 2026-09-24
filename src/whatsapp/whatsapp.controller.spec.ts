import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CredentialsService,
  ResolvedCredential,
} from '../integrations/credentials.service';

const COMPANY = { id: 'company-1' };

function buildHarness(opts: {
  company?: { id: string } | null;
  cred?: ResolvedCredential | null;
}) {
  const inbound = {
    handleIncoming: jest.fn().mockResolvedValue({ leadId: 'lead-1' }),
  } as unknown as WhatsappInboundService;
  const prisma = {
    raw: {
      company: {
        findFirst: jest.fn().mockResolvedValue(opts.company ?? null),
      },
    },
  } as unknown as PrismaService;
  const config = { get: jest.fn() } as unknown as ConfigService<never, true>;
  const credentials = {
    getByCompanyId: jest.fn().mockResolvedValue(opts.cred ?? null),
  } as unknown as CredentialsService;
  return {
    controller: new WhatsappController(inbound, prisma, config, credentials),
    inbound,
    credentials,
  };
}

function requestWith(
  body: unknown,
  headers: Record<string, string>,
): RawBodyRequest<Request> {
  return {
    rawBody: Buffer.from(JSON.stringify(body)),
    headers,
  } as unknown as RawBodyRequest<Request>;
}

const hmacHex = (secret: string, body: Buffer) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('WhatsappController — webhook de Meta', () => {
  const APP_SECRET = 'meta-app-secret';
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: 'pn-1' },
              messages: [
                { from: '56911111111', type: 'text', text: { body: 'hola' } },
              ],
            },
          },
        ],
      },
    ],
  };
  const metaCred: ResolvedCredential = {
    provider: 'meta',
    config: { phoneNumberId: 'pn-1' },
    secret: 'token',
    webhookSecret: APP_SECRET,
    isActive: true,
  };

  it('acepta el mensaje cuando la firma calza con el App Secret de la empresa', async () => {
    const { controller, inbound } = buildHarness({
      company: COMPANY,
      cred: metaCred,
    });
    const req = requestWith(payload, {
      'x-hub-signature-256': `sha256=${hmacHex(APP_SECRET, Buffer.from(JSON.stringify(payload)))}`,
    });

    await expect(controller.metaWebhook(req, payload)).resolves.toEqual({
      received: true,
    });
    expect(inbound.handleIncoming).toHaveBeenCalledWith(
      '+56911111111',
      'hola',
      { wakeAgent: true },
    );
  });

  it('rechaza con 401 una firma que no calza (y no despierta al agente)', async () => {
    const { controller, inbound } = buildHarness({
      company: COMPANY,
      cred: metaCred,
    });
    const req = requestWith(payload, {
      'x-hub-signature-256': `sha256=${hmacHex('otro-secreto', Buffer.from('x'))}`,
    });

    await expect(controller.metaWebhook(req, payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(inbound.handleIncoming).not.toHaveBeenCalled();
  });

  it('rechaza si la empresa no tiene App Secret configurado (antes se aceptaba)', async () => {
    const { controller, inbound } = buildHarness({
      company: COMPANY,
      cred: { ...metaCred, webhookSecret: undefined },
    });
    const req = requestWith(payload, {});

    await expect(controller.metaWebhook(req, payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(inbound.handleIncoming).not.toHaveBeenCalled();
  });

  it('ignora en silencio un número que no pertenece a ninguna empresa', async () => {
    const { controller, inbound, credentials } = buildHarness({
      company: null,
    });
    const req = requestWith(payload, {});

    await expect(controller.metaWebhook(req, payload)).resolves.toEqual({
      received: true,
    });
    expect(credentials.getByCompanyId).not.toHaveBeenCalled();
    expect(inbound.handleIncoming).not.toHaveBeenCalled();
  });
});

describe('WhatsappController — webhook de YCloud', () => {
  const SECRET = 'ycloud-webhook-secret';
  const payload = {
    type: 'whatsapp.inbound_message.received',
    whatsappInboundMessage: {
      type: 'text',
      from: '56922222222',
      to: '+56900000000',
      text: { body: 'quiero cotizar' },
    },
  };
  const ycloudCred: ResolvedCredential = {
    provider: 'ycloud',
    config: {},
    secret: 'api-key',
    webhookSecret: SECRET,
    isActive: true,
  };

  function signed(secret: string): RawBodyRequest<Request> {
    const raw = Buffer.from(JSON.stringify(payload));
    const ts = Math.floor(Date.now() / 1000);
    const digest = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${ts}.`), raw]))
      .digest('hex');
    return requestWith(payload, { 'ycloud-signature': `t=${ts},s=${digest}` });
  }

  it('acepta el mensaje con firma válida', async () => {
    const { controller, inbound } = buildHarness({
      company: COMPANY,
      cred: ycloudCred,
    });
    await expect(
      controller.ycloudWebhook(signed(SECRET), payload),
    ).resolves.toEqual({ received: true });
    expect(inbound.handleIncoming).toHaveBeenCalledWith(
      '+56922222222',
      'quiero cotizar',
      { wakeAgent: true },
    );
  });

  it('rechaza una firma inválida', async () => {
    const { controller, inbound } = buildHarness({
      company: COMPANY,
      cred: ycloudCred,
    });
    await expect(
      controller.ycloudWebhook(signed('otro'), payload),
    ).rejects.toThrow(UnauthorizedException);
    expect(inbound.handleIncoming).not.toHaveBeenCalled();
  });

  it('ya NO acepta sin verificar cuando falta el secreto de firma', async () => {
    const { controller, inbound } = buildHarness({
      company: COMPANY,
      cred: { ...ycloudCred, webhookSecret: undefined },
    });
    await expect(
      controller.ycloudWebhook(signed(SECRET), payload),
    ).rejects.toThrow(UnauthorizedException);
    expect(inbound.handleIncoming).not.toHaveBeenCalled();
  });
});
