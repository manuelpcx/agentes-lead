import { Inject, Injectable } from '@nestjs/common';
import {
  StartCallParams,
  VOICE_PROVIDER,
  VoiceProvider,
} from './providers/voice-provider.interface';

/** Fachada de llamadas de voz. El agente inicia llamadas a través de aquí. */
@Injectable()
export class VoiceService {
  constructor(
    @Inject(VOICE_PROVIDER)
    private readonly provider: VoiceProvider,
  ) {}

  startCall(params: StartCallParams): Promise<{ callId: string }> {
    return this.provider.startCall(params);
  }
}
