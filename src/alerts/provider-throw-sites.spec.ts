import { ProviderError } from './provider-error';
import { ResendEmailProvider } from '../email/providers/resend.provider';
import { VapiVoiceProvider } from '../voice/providers/vapi.provider';
import { RetellVoiceProvider } from '../voice/providers/retell.provider';
import {
  ElevenLabsVoiceProvider,
  resetElevenLabsCache,
} from '../voice/providers/elevenlabs.provider';

function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

const CALL = { to: '+56911111111', metadata: { leadId: 'lead-1' } };

describe('los proveedores lanzan ProviderError con el código HTTP', () => {
  beforeEach(() => resetElevenLabsCache());

  it('Resend: estado y nombre del error, mensaje de siempre', async () => {
    mockFetch(403, { statusCode: 403, name: 'validation_error', message: 'x' });
    const err = await new ResendEmailProvider('re_x', 'a@b.cl')
      .send({ to: 'c@d.cl', subject: 's', text: 't' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      status: 403,
      code: 'validation_error',
      message: 'Fallo al enviar correo (Resend 403)',
    });
  });

  it('Vapi', async () => {
    mockFetch(503, {});
    const err = await new VapiVoiceProvider({ apiKey: 'k' })
      .startCall(CALL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      status: 503,
      message: 'Fallo al iniciar la llamada (Vapi 503)',
    });
  });

  it('Retell', async () => {
    mockFetch(401, { error: 'bad key' });
    const err = await new RetellVoiceProvider({
      apiKey: 'k',
      fromNumber: '+56900000000',
    })
      .startCall(CALL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 401 });
    expect((err as Error).message).toContain('(Retell 401)');
  });

  it('ElevenLabs, al leer el número de teléfono', async () => {
    mockFetch(401, { detail: 'invalid api key' });
    const err = await new ElevenLabsVoiceProvider({
      apiKey: 'k',
      agentId: 'agent',
      phoneNumberId: 'phnum',
    })
      .startCall(CALL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 401 });
  });
});
