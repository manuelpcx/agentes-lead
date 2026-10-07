import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { VoiceController } from './voice.controller';
import { VoiceInboundService } from './voice-inbound.service';
import {
  CredentialsService,
  ResolvedCredential,
} from '../integrations/credentials.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { VoiceService } from './voice.service';
import { VoiceUsageService } from './voice-usage.service';

function buildHarness(
  cred: ResolvedCredential | null,
  llamada: { companyId: string; leadId: string } | null = null,
  voiceCall: {
    companyId: string;
    leadId: string;
    managed: boolean;
  } | null = null,
) {
  const inbound = {
    handleCompletedCall: jest.fn().mockResolvedValue(undefined),
  } as unknown as VoiceInboundService;
  const credentials = {
    getByCompanyId: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  const findFirst = jest.fn().mockResolvedValue(llamada);
  const prisma = {
    raw: { interaction: { findFirst } },
  } as unknown as PrismaService;
  const voice = {
    managedWebhookSecret: 'wsec_plataforma',
  } as unknown as VoiceService;
  const usage = {
    findCall: jest.fn().mockResolvedValue(voiceCall),
    recordEnd: jest.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new VoiceController(
      inbound,
      credentials,
      prisma,
      voice,
      usage as unknown as VoiceUsageService,
    ),
    inbound,
    credentials,
    findFirst,
    usage,
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

describe('VoiceController — webhook de ElevenLabs', () => {
  const SECRET = 'wsec_elevenlabs';
  const LLAMADA = { companyId: 'company-1', leadId: 'lead-1' };
  const elevenCred: ResolvedCredential = {
    provider: 'elevenlabs',
    config: { agentId: 'agent_1', phoneNumberId: 'phnum_1' },
    secret: 'xi-key',
    webhookSecret: SECRET,
    isActive: true,
  };
  const transcripcion = {
    type: 'post_call_transcription',
    event_timestamp: 1790000000,
    data: {
      agent_id: 'agent_1',
      conversation_id: 'conv_1',
      status: 'done',
      transcript: [
        { role: 'agent', message: 'Hola, ¿hablo con Ana?' },
        { role: 'agent', message: null, tool_calls: [{}] },
        { role: 'user', message: 'Sí, dime.' },
      ],
      analysis: { transcript_summary: 'Ana atendió y pidió el link de pago.' },
    },
  };

  /** Request con el cuerpo firmado como lo firma ElevenLabs. */
  function signed(body: unknown, secret = SECRET) {
    const raw = Buffer.from(JSON.stringify(body));
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${ts}.`), raw]))
      .digest('hex');
    return {
      rawBody: raw,
      headers: { 'elevenlabs-signature': `t=${ts},v0=${sig}` },
    } as unknown as RawBodyRequest<Request>;
  }

  it('registra la transcripción de la llamada que iniciamos', async () => {
    const { controller, inbound, findFirst } = buildHarness(
      elevenCred,
      LLAMADA,
    );

    await expect(
      controller.elevenlabsWebhook(signed(transcripcion), transcripcion),
    ).resolves.toEqual({ received: true });

    // La empresa y el lead salen de nuestra llamada, no del cuerpo.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metadata: { path: ['callId'], equals: 'conv_1' },
        }),
      }),
    );
    expect(inbound.handleCompletedCall).toHaveBeenCalledWith({
      leadId: 'lead-1',
      callId: 'conv_1',
      transcript: 'Agente: Hola, ¿hablo con Ana?\nCliente: Sí, dime.',
      summary: 'Ana atendió y pidió el link de pago.',
    });
  });

  it('una llamada que no se conectó queda en el historial, sin transcripción', async () => {
    const falla = {
      type: 'call_initiation_failure',
      data: {
        agent_id: 'agent_1',
        conversation_id: 'conv_1',
        failure_reason: 'no-answer',
        metadata: {},
      },
    };
    const { controller, inbound } = buildHarness(elevenCred, LLAMADA);

    await controller.elevenlabsWebhook(signed(falla), falla);

    expect(inbound.handleCompletedCall).toHaveBeenCalledWith({
      leadId: 'lead-1',
      callId: 'conv_1',
      summary: 'La llamada no se conectó (no contestó).',
    });
  });

  it('rechaza con 401 si la firma no es del secreto de la empresa', async () => {
    const { controller, inbound } = buildHarness(elevenCred, LLAMADA);

    await expect(
      controller.elevenlabsWebhook(
        signed(transcripcion, 'otro-secreto'),
        transcripcion,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(inbound.handleCompletedCall).not.toHaveBeenCalled();
  });

  it('rechaza si la empresa no configuró el secreto del webhook', async () => {
    const { controller } = buildHarness(
      { ...elevenCred, webhookSecret: undefined },
      LLAMADA,
    );

    await expect(
      controller.elevenlabsWebhook(signed(transcripcion), transcripcion),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('ignora una conversación que no iniciamos, sin consultar credenciales', async () => {
    const { controller, credentials, inbound } = buildHarness(elevenCred, null);

    await expect(
      controller.elevenlabsWebhook(signed(transcripcion), transcripcion),
    ).resolves.toEqual({ received: true });
    expect(credentials.getByCompanyId).not.toHaveBeenCalled();
    expect(inbound.handleCompletedCall).not.toHaveBeenCalled();
  });

  it('ignora otros eventos (p. ej. el audio) sin tocar la base', async () => {
    const audio = { type: 'post_call_audio', data: { conversation_id: 'c' } };
    const { controller, findFirst } = buildHarness(elevenCred, LLAMADA);

    await controller.elevenlabsWebhook(signed(audio), audio);

    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('VoiceController — ElevenLabs en la voz gestionada', () => {
  const transcripcion = {
    type: 'post_call_transcription',
    data: {
      conversation_id: 'conv_9',
      transcript: [{ role: 'user', message: 'Pago el viernes.' }],
      analysis: { transcript_summary: 'Promete pagar el viernes.' },
      metadata: { call_duration_secs: 95 },
    },
  };

  function signed(body: unknown, secret: string) {
    const raw = Buffer.from(JSON.stringify(body));
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${ts}.`), raw]))
      .digest('hex');
    return {
      rawBody: raw,
      headers: { 'elevenlabs-signature': `t=${ts},v0=${sig}` },
    } as unknown as RawBodyRequest<Request>;
  }

  const GESTIONADA = {
    companyId: 'company-1',
    leadId: 'lead-1',
    managed: true,
  };

  it('verifica con el secreto de la plataforma y registra la duración para los minutos', async () => {
    const h = buildHarness(null, null, GESTIONADA);

    await h.controller.elevenlabsWebhook(
      signed(transcripcion, 'wsec_plataforma'),
      transcripcion,
    );

    expect(h.usage.findCall).toHaveBeenCalledWith('elevenlabs', 'conv_9');
    // La empresa no tiene cuenta propia: no hace falta consultar sus credenciales.
    expect(h.credentials.getByCompanyId).not.toHaveBeenCalled();
    expect(h.usage.recordEnd).toHaveBeenCalledWith('elevenlabs', 'conv_9', {
      status: 'completed',
      durationSecs: 95,
    });
    expect(h.inbound.handleCompletedCall).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', callId: 'conv_9' }),
    );
  });

  it('una firma con otro secreto se rechaza', async () => {
    const h = buildHarness(null, null, GESTIONADA);

    await expect(
      h.controller.elevenlabsWebhook(
        signed(transcripcion, 'wsec_de_otra_empresa'),
        transcripcion,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(h.usage.recordEnd).not.toHaveBeenCalled();
  });

  it('una llamada que no se conectó cierra el registro sin minutos', async () => {
    const falla = {
      type: 'call_initiation_failure',
      data: { conversation_id: 'conv_9', failure_reason: 'busy' },
    };
    const h = buildHarness(null, null, GESTIONADA);

    await h.controller.elevenlabsWebhook(
      signed(falla, 'wsec_plataforma'),
      falla,
    );

    expect(h.usage.recordEnd).toHaveBeenCalledWith('elevenlabs', 'conv_9', {
      status: 'failed',
      durationSecs: 0,
    });
  });
});
