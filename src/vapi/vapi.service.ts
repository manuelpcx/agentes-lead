import { Inject, Injectable } from '@nestjs/common';
import {
  StartCallParams,
  VAPI_PROVIDER,
  VapiProvider,
} from './providers/vapi-provider.interface';

/** Fachada de llamadas de voz. */
@Injectable()
export class VapiService {
  constructor(
    @Inject(VAPI_PROVIDER)
    private readonly provider: VapiProvider,
  ) {}

  startCall(params: StartCallParams): Promise<{ callId: string }> {
    return this.provider.startCall(params);
  }
}
