import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';

/** Voz disponible para elegir en el panel (del catálogo del proveedor). */
export interface VoiceOption {
  voiceId: string;
  name: string;
  provider?: string;
  gender?: string;
  accent?: string;
  age?: string;
  previewUrl?: string;
}

/**
 * Lista las voces disponibles del proveedor de voz de la empresa (Retell
 * `list-voices`). Usa la API key que el cliente configuró en el panel. Sin
 * credenciales de Retell, devuelve lista vacía.
 * Doc: https://docs.retellai.com/api-references/list-voices
 */
@Injectable()
export class VoiceCatalogService {
  private readonly logger = new Logger('VoiceCatalog');

  constructor(private readonly credentials: CredentialsService) {}

  async list(): Promise<VoiceOption[]> {
    const c = await this.credentials.get('voice');
    const key = c?.provider === 'retell' ? c.secret : undefined;
    if (!key) {
      return [];
    }
    try {
      const res = await fetch('https://api.retellai.com/list-voices', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        this.logger.warn(`Retell list-voices respondió ${res.status}`);
        return [];
      }
      const arr = (await res.json()) as Array<Record<string, unknown>>;
      return arr
        .map((v) => ({
          voiceId: String(v.voice_id ?? ''),
          name: String(v.voice_name ?? v.voice_id ?? ''),
          provider: v.provider as string | undefined,
          gender: v.gender as string | undefined,
          accent: v.accent as string | undefined,
          age: v.age as string | undefined,
          previewUrl: v.preview_audio_url as string | undefined,
        }))
        .filter((v) => v.voiceId);
    } catch (e) {
      this.logger.warn(`Error al listar voces: ${(e as Error).message}`);
      return [];
    }
  }
}
