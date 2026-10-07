import {
  ElevenLabsVoiceProvider,
  buildElevenLabsOverride,
  formatElevenLabsTranscript,
  readOverridePermissions,
  resetElevenLabsCache,
  toElevenLabsLanguage,
} from './elevenlabs.provider';

/** Respuesta mínima de fetch. */
function res(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mockFetch(...responses: ReturnType<typeof res>[]): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

const NUMERO_TWILIO = res(200, { provider: 'twilio' });

/** Config del agente con los overrides habilitados en su pestaña Security. */
function agenteQuePermite(permisos: {
  agent?: Record<string, boolean>;
  tts?: Record<string, boolean>;
}) {
  return res(200, {
    agent_id: 'agent_1',
    platform_settings: {
      overrides: { conversation_config_override: permisos },
    },
  });
}
const AGENTE_PERMITE_TODO = agenteQuePermite({
  agent: { first_message: true, language: true },
  tts: { voice_id: true, speed: true },
});
const VOZ_EXISTE = res(200, { voice_id: 'voz_de_la_empresa' });
const LLAMADA_OK = res(200, {
  success: true,
  message: 'ok',
  conversation_id: 'conv_1',
  callSid: 'CA1',
});

function provider() {
  return new ElevenLabsVoiceProvider({
    apiKey: 'xi-key',
    agentId: 'agent_1',
    phoneNumberId: 'phnum_1',
  });
}

const PARAMS = {
  to: '+56999999999',
  metadata: { companyId: 'c1', leadId: 'l1' },
  dynamicVariables: { nombre: 'Ana', empresa: 'Demo', tono: 'Cercano' },
};

describe('ElevenLabsVoiceProvider', () => {
  beforeEach(() => resetElevenLabsCache());

  it('llama por Twilio con el agente, el número y las variables del lead', async () => {
    const fetchMock = mockFetch(NUMERO_TWILIO, LLAMADA_OK);

    const out = await provider().startCall(PARAMS);

    expect(out).toEqual({ callId: 'conv_1' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/convai/twilio/outbound-call',
    );
    expect(init.headers['xi-api-key']).toBe('xi-key');
    expect(JSON.parse(init.body)).toEqual({
      agent_id: 'agent_1',
      agent_phone_number_id: 'phnum_1',
      to_number: '+56999999999',
      conversation_initiation_client_data: {
        dynamic_variables: { nombre: 'Ana', empresa: 'Demo', tono: 'Cercano' },
      },
    });
  });

  it('con un número SIP trunk usa el endpoint de SIP', async () => {
    const fetchMock = mockFetch(
      res(200, { provider: 'sip_trunk' }),
      LLAMADA_OK,
    );

    await provider().startCall(PARAMS);

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call',
    );
  });

  it('consulta el tipo de número una sola vez', async () => {
    const fetchMock = mockFetch(NUMERO_TWILIO, LLAMADA_OK, LLAMADA_OK);

    await provider().startCall(PARAMS);
    await provider().startCall(PARAMS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('traduce la config de voz de la empresa a conversation_config_override', async () => {
    const fetchMock = mockFetch(
      NUMERO_TWILIO,
      AGENTE_PERMITE_TODO,
      VOZ_EXISTE,
      LLAMADA_OK,
    );

    await provider().startCall({
      ...PARAMS,
      overrides: {
        voiceId: 'voz_de_la_empresa',
        voiceSpeed: 1.5,
        language: 'es-419',
        beginMessage: 'Hola {{nombre}}',
      },
    });

    const body = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(
      body.conversation_initiation_client_data.conversation_config_override,
    ).toEqual({
      agent: { first_message: 'Hola {{nombre}}', language: 'es' },
      // 1.5 queda en el máximo que acepta ElevenLabs.
      tts: { voice_id: 'voz_de_la_empresa', speed: 1.2 },
    });
  });

  it('NO manda el saludo si el agente no lo permite: ElevenLabs cortaba la conversación', async () => {
    // "Override for field 'first_message' is not allowed by config": ElevenLabs
    // acepta la llamada y la corta al empezar, así que no hay error que atajar.
    const fetchMock = mockFetch(
      NUMERO_TWILIO,
      agenteQuePermite({ agent: { first_message: false } }),
      LLAMADA_OK,
    );

    const out = await provider().startCall({
      ...PARAMS,
      overrides: { beginMessage: 'Hola {{nombre}}, te llamo de {{empresa}}' },
    });

    expect(out).toEqual({ callId: 'conv_1' });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.elevenlabs.io/v1/convai/agents/agent_1',
    );
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(
      body.conversation_initiation_client_data.conversation_config_override,
    ).toBeUndefined();
    expect(body.conversation_initiation_client_data.dynamic_variables).toEqual(
      PARAMS.dynamicVariables,
    );
  });

  it('manda solo los campos que el agente permite', async () => {
    const fetchMock = mockFetch(
      NUMERO_TWILIO,
      agenteQuePermite({ agent: { first_message: true }, tts: {} }),
      LLAMADA_OK,
    );

    await provider().startCall({
      ...PARAMS,
      overrides: { beginMessage: 'Hola {{nombre}}', voiceId: 'voz_x' },
    });

    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(
      body.conversation_initiation_client_data.conversation_config_override,
    ).toEqual({ agent: { first_message: 'Hola {{nombre}}' } });
  });

  it('si no puede leer los permisos del agente, llama sin overrides', async () => {
    const fetchMock = mockFetch(NUMERO_TWILIO, res(500), LLAMADA_OK);

    const out = await provider().startCall({
      ...PARAMS,
      overrides: { beginMessage: 'Hola' },
    });

    expect(out).toEqual({ callId: 'conv_1' });
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(
      body.conversation_initiation_client_data.conversation_config_override,
    ).toBeUndefined();
  });

  it('una voz que no existe en la cuenta (p. ej. una de Retell) no se manda', async () => {
    const fetchMock = mockFetch(
      NUMERO_TWILIO,
      AGENTE_PERMITE_TODO,
      res(404, { detail: 'voice_not_found' }),
      LLAMADA_OK,
    );

    await provider().startCall({
      ...PARAMS,
      overrides: { voiceId: '11labs-Adrian', beginMessage: 'Hola' },
    });

    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.elevenlabs.io/v1/voices/11labs-Adrian',
    );
    const body = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(
      body.conversation_initiation_client_data.conversation_config_override,
    ).toEqual({ agent: { first_message: 'Hola' } });
  });

  it('los permisos del agente se consultan una vez y se reutilizan', async () => {
    const fetchMock = mockFetch(
      NUMERO_TWILIO,
      agenteQuePermite({ agent: { first_message: true } }),
      LLAMADA_OK,
      LLAMADA_OK,
    );
    const conSaludo = { ...PARAMS, overrides: { beginMessage: 'Hola' } };

    await provider().startCall(conSaludo);
    await provider().startCall(conSaludo);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('si ElevenLabs rechaza la petición por la config de voz, reintenta sin ella', async () => {
    const fetchMock = mockFetch(
      NUMERO_TWILIO,
      AGENTE_PERMITE_TODO,
      VOZ_EXISTE,
      res(422, { detail: 'invalid first_message' }),
      LLAMADA_OK,
    );

    const out = await provider().startCall({
      ...PARAMS,
      overrides: { voiceId: 'voz_de_la_empresa' },
    });

    expect(out).toEqual({ callId: 'conv_1' });
    const reintento = JSON.parse(fetchMock.mock.calls[4][1].body);
    expect(
      reintento.conversation_initiation_client_data
        .conversation_config_override,
    ).toBeUndefined();
    // Las variables del lead se mantienen en el reintento.
    expect(
      reintento.conversation_initiation_client_data.dynamic_variables,
    ).toEqual(PARAMS.dynamicVariables);
  });

  it('un error de ElevenLabs sube con su detalle (para verlo en el panel)', async () => {
    mockFetch(NUMERO_TWILIO, res(422, { detail: 'invalid to_number' }));

    await expect(provider().startCall(PARAMS)).rejects.toThrow(
      /ElevenLabs 422.*invalid to_number/,
    );
  });

  it('success: false también es un error', async () => {
    mockFetch(
      NUMERO_TWILIO,
      res(200, { success: false, message: 'Agent has no phone access' }),
    );

    await expect(provider().startCall(PARAMS)).rejects.toThrow(
      'Agent has no phone access',
    );
  });

  it('no llama desde un número que no es Twilio ni SIP', async () => {
    const fetchMock = mockFetch(res(200, { provider: 'exotel' }));

    await expect(provider().startCall(PARAMS)).rejects.toThrow(/exotel/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('toElevenLabsLanguage', () => {
  it('pasa del formato de Retell al código de ElevenLabs', () => {
    expect(toElevenLabsLanguage('es-ES')).toBe('es');
    expect(toElevenLabsLanguage('es-419')).toBe('es');
    expect(toElevenLabsLanguage('en')).toBe('en');
    expect(toElevenLabsLanguage('multi')).toBeUndefined();
    expect(toElevenLabsLanguage(undefined)).toBeUndefined();
  });
});

describe('formatElevenLabsTranscript', () => {
  it('una línea por turno, omitiendo los turnos sin texto', () => {
    expect(
      formatElevenLabsTranscript([
        { role: 'agent', message: 'Hola' },
        { role: 'agent', message: null },
        { role: 'user', message: ' Sí ' },
      ]),
    ).toBe('Agente: Hola\nCliente: Sí');
  });

  it('sin turnos con texto no hay transcripción (no despierta al agente)', () => {
    expect(formatElevenLabsTranscript([])).toBeUndefined();
    expect(formatElevenLabsTranscript(undefined)).toBeUndefined();
  });
});

describe('permisos de override de ElevenLabs', () => {
  it('lee los permisos de la config del agente (lo que no es true, no se permite)', () => {
    expect(
      readOverridePermissions({
        platform_settings: {
          overrides: {
            conversation_config_override: {
              agent: { first_message: true, language: false },
              tts: { voice_id: true },
            },
          },
        },
      }),
    ).toEqual({
      firstMessage: true,
      language: false,
      voiceId: true,
      speed: false,
    });
    expect(readOverridePermissions({})).toEqual({
      firstMessage: false,
      language: false,
      voiceId: false,
      speed: false,
    });
  });

  it('dice qué quedó fuera con el nombre que usa el panel', () => {
    const { override, dropped } = buildElevenLabsOverride(
      { beginMessage: 'Hola', language: 'es-419', voiceSpeed: 1 },
      { firstMessage: false, language: true, voiceId: false, speed: false },
    );
    expect(override).toEqual({ agent: { language: 'es' } });
    // La velocidad 1 no se manda, así que tampoco cuenta como dejada fuera.
    expect(dropped).toEqual(['saludo']);
  });
});
