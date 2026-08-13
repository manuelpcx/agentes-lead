import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { InteractionsModule } from '../interactions/interactions.module';
import { VapiService } from './vapi.service';
import { VapiController } from './vapi.controller';
import {
  VAPI_PROVIDER,
  VapiProvider,
} from './providers/vapi-provider.interface';
import { LogVapiProvider } from './providers/log.provider';
import { VapiApiProvider } from './providers/vapi-api.provider';

/** Módulo global de llamadas de voz (proveedor `log` o `vapi`). */
@Global()
@Module({
  imports: [InteractionsModule],
  controllers: [VapiController],
  providers: [
    {
      provide: VAPI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>): VapiProvider => {
        if (config.get('VAPI_PROVIDER', { infer: true }) === 'vapi') {
          return new VapiApiProvider({
            apiKey: config.get('VAPI_API_KEY', { infer: true }) as string,
            phoneNumberId: config.get('VAPI_PHONE_NUMBER_ID', { infer: true }),
            assistantId: config.get('VAPI_ASSISTANT_ID', { infer: true }),
          });
        }
        return new LogVapiProvider();
      },
    },
    VapiService,
  ],
  exports: [VapiService],
})
export class VapiModule {}
