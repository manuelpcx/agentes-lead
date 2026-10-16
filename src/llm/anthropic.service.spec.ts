import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { TenantContext } from '../common/tenant/tenant-context';
import { ProviderHealthService } from '../alerts/provider-health.service';
import { AnthropicService } from './anthropic.service';

function build() {
  const env: Record<string, unknown> = {
    ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_MODEL: 'claude-test',
    ANTHROPIC_EFFORT: 'medium',
    ANTHROPIC_MAX_TOKENS: 1000,
  };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService<
    EnvVars,
    true
  >;
  const health = {
    observe: jest.fn((_t: unknown, send: () => Promise<unknown>) => send()),
  };
  const service = new AnthropicService(
    config,
    health as unknown as ProviderHealthService,
  );
  const create = jest
    .fn()
    .mockResolvedValue({ content: [{ type: 'text', text: 'hola' }] });
  (service as unknown as { client: unknown }).client = { messages: { create } };
  return { service, health, create };
}

describe('AnthropicService y la salud del proveedor', () => {
  it('cada llamada al modelo pasa por observe como cuenta de la plataforma', async () => {
    const h = build();
    await TenantContext.run({ companyId: 'c1', correlationId: 'x' }, () =>
      h.service.createMessage({ system: 's', messages: [], tools: [] }),
    );
    expect(h.health.observe).toHaveBeenCalledWith(
      {
        service: 'llm',
        provider: 'anthropic',
        scope: 'platform',
        companyId: 'c1',
      },
      expect.any(Function),
    );
  });

  it('sin empresa en contexto (proceso nocturno): companyId vacío', async () => {
    const h = build();
    await expect(h.service.complete('s', 'u')).resolves.toBe('hola');
    expect(h.health.observe).toHaveBeenCalledWith(
      {
        service: 'llm',
        provider: 'anthropic',
        scope: 'platform',
        companyId: undefined,
      },
      expect.any(Function),
    );
  });
});
