import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { VoiceController } from './voice.controller';
import { VoiceInboundService } from './voice-inbound.service';
import {
  CredentialsService,
  ResolvedCredential,
} from '../integrations/credentials.service';

function buildHarness(cred: ResolvedCredential | null) {
  const inbound = {
    handleCompletedCall: jest.fn().mockResolvedValue(undefined),
  } as unknown as VoiceInboundService;
  const credentials = {
    getByCompanyId: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  return {
    controller: new VoiceController(inbound, credentials),
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

describe('VoiceController — webhook de Vapi', () => {
  const SECRET = 'vapi-server-secret';
  const payload = {
    message: {
      type: 'end-of-call-report',
      call: {
        id: 'call-1',
        metadata: { companyId: 'company-1', leadId: 'lead-1' },
      },
      transcript: 'Hola, quería saber el precio.',
      summary: 'Pidió precio.',
    },
  };
  const vapiCred: ResolvedCredential = {
    provider: 'vapi',
    config: {},
    secret: 'api-key',
    webhookSecret: SECRET,
    isActive: true,
  };

  it('acepta el reporte cuando x-vapi-secret coincide con el secreto de la empresa', async () => {
    const { controller, inbound, credentials } = buildHarness(vapiCred);
    const req = requestWith(payload, { 'x-vapi-secret': SECRET });

    await expect(controller.vapiWebhook(req, payload)).resolves.toEqual({
      received: true,
    });
    expect(credentials.getByCompanyId).toHaveBeenCalledWith(
      'company-1',
      'voice',
    );
    expect(inbound.handleCompletedCall).toHaveBeenCalledWith({
      leadId: 'lead-1',
      callId: 'call-1',
      transcript: 'Hola, quería saber el precio.',
      summary: 'Pidió precio.',
    });
  });

  it('rechaza con 401 si el secreto no coincide', async () => {
    const { controller, inbound } = buildHarness(vapiCred);
    const req = requestWith(payload, { 'x-vapi-secret': 'adivinado' });

    await expect(controller.vapiWebhook(req, payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(inbound.handleCompletedCall).not.toHaveBeenCalled();
  });

  it('rechaza si la empresa no tiene secreto de webhook (antes se aceptaba cualquier cuerpo)', async () => {
    const { controller, inbound } = buildHarness({
      ...vapiCred,
      webhookSecret: undefined,
    });
    const req = requestWith(payload, { 'x-vapi-secret': SECRET });

    await expect(controller.vapiWebhook(req, payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(inbound.handleCompletedCall).not.toHaveBeenCalled();
  });

  it('rechaza si la empresa usa otro proveedor de voz', async () => {
    const { controller } = buildHarness({ ...vapiCred, provider: 'retell' });
    const req = requestWith(payload, { 'x-vapi-secret': SECRET });
    await expect(controller.vapiWebhook(req, payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('ignora otros eventos sin siquiera consultar credenciales', async () => {
    const { controller, credentials } = buildHarness(vapiCred);
    const otro = { message: { type: 'status-update' } };
    await expect(
      controller.vapiWebhook(requestWith(otro, {}), otro),
    ).resolves.toEqual({ received: true });
    expect(credentials.getByCompanyId).not.toHaveBeenCalled();
  });
});
