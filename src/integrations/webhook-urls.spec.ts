import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { WhatsappController } from '../whatsapp/whatsapp.controller';
import { VoiceController } from '../voice/voice.controller';
import { WEBHOOK_PATHS, buildWebhookInfo, publicBaseUrl } from './webhook-urls';

/** Ruta y método HTTP que Nest registra para un handler de un controller. */
function route(
  controller: { prototype: object },
  handler: string,
): { path: string; method: RequestMethod } {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const fn = (controller.prototype as Record<string, unknown>)[handler];
  return {
    path: `/${base}/${Reflect.getMetadata(PATH_METADATA, fn as object)}`,
    method: Reflect.getMetadata(METHOD_METADATA, fn as object) as RequestMethod,
  };
}

describe('WEBHOOK_PATHS', () => {
  // Si una ruta cambia en el controller y no acá, el panel le daría al
  // cliente una URL que no existe y los mensajes no llegarían nunca.
  it('coincide con las rutas que registran los controllers', () => {
    expect(route(WhatsappController, 'ycloudWebhook')).toEqual({
      path: WEBHOOK_PATHS.whatsapp.ycloud,
      method: RequestMethod.POST,
    });
    expect(route(WhatsappController, 'metaWebhook')).toEqual({
      path: WEBHOOK_PATHS.whatsapp.meta,
      method: RequestMethod.POST,
    });
    // Meta verifica la suscripción con un GET a la misma URL.
    expect(route(WhatsappController, 'verify')).toEqual({
      path: WEBHOOK_PATHS.whatsapp.meta,
      method: RequestMethod.GET,
    });
    expect(route(VoiceController, 'retellWebhook')).toEqual({
      path: WEBHOOK_PATHS.voice.retell,
      method: RequestMethod.POST,
    });
    expect(route(VoiceController, 'vapiWebhook')).toEqual({
      path: WEBHOOK_PATHS.voice.vapi,
      method: RequestMethod.POST,
    });
  });
});

describe('publicBaseUrl', () => {
  const req = (headers: Record<string, string>, protocol = 'http') =>
    ({ headers, protocol }) as never;

  it('usa PUBLIC_API_URL si está configurada (sin la barra final)', () => {
    expect(
      publicBaseUrl('https://api.empresa.cl/', req({ host: 'interno:3000' })),
    ).toBe('https://api.empresa.cl');
  });

  it('detrás del proxy (Railway, Cloud Run) usa el protocolo y host públicos', () => {
    expect(
      publicBaseUrl(
        undefined,
        req({
          host: '10.0.0.5:3000',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'agentes.up.railway.app',
        }),
      ),
    ).toBe('https://agentes.up.railway.app');
  });

  it('si el proxy manda una lista, toma el primer valor', () => {
    expect(
      publicBaseUrl(
        undefined,
        req({ host: 'api.empresa.cl', 'x-forwarded-proto': 'https, http' }),
      ),
    ).toBe('https://api.empresa.cl');
  });

  it('sin proxy usa el host de la petición', () => {
    expect(publicBaseUrl(undefined, req({ host: 'localhost:3000' }))).toBe(
      'http://localhost:3000',
    );
  });
});

describe('buildWebhookInfo', () => {
  it('arma la URL de cada proveedor sobre la URL pública', () => {
    const info = buildWebhookInfo('https://api.empresa.cl', 'token-meta');

    expect(info.whatsapp.ycloud.url).toBe(
      'https://api.empresa.cl/whatsapp/ycloud/webhook',
    );
    expect(info.whatsapp.ycloud.events).toEqual([
      'whatsapp.inbound_message.received',
    ]);
    expect(info.whatsapp.meta).toEqual({
      url: 'https://api.empresa.cl/whatsapp/webhook',
      verifyToken: 'token-meta',
      fields: ['messages'],
    });
    expect(info.voice.retell.url).toBe(
      'https://api.empresa.cl/voice/retell/webhook',
    );
    expect(info.voice.vapi.url).toBe(
      'https://api.empresa.cl/voice/vapi/webhook',
    );
    expect(info.local).toBe(false);
  });

  it('marca como local una URL a la que un proveedor externo no puede llegar', () => {
    expect(buildWebhookInfo('http://localhost:3000').local).toBe(true);
    expect(buildWebhookInfo('http://127.0.0.1:3000').local).toBe(true);
  });

  it('sin token de verificación de Meta configurado, lo informa como null', () => {
    expect(buildWebhookInfo('https://x.cl').whatsapp.meta.verifyToken).toBe(
      null,
    );
    expect(
      buildWebhookInfo('https://x.cl', '  ').whatsapp.meta.verifyToken,
    ).toBe(null);
  });
});
