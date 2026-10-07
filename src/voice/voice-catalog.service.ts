import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';
import { ELEVENLABS_API } from './providers/elevenlabs.provider';
import { VoiceService } from './voice.service';

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

/** Tope de páginas de voces de ElevenLabs (100 por página). */
const ELEVENLABS_MAX_PAGES = 5;

/**
 * Lista las voces disponibles del proveedor de voz de la empresa: Retell
 * (`list-voices`) o ElevenLabs (`/v2/voices`, que incluye las voces propias y
 * clonadas de la cuenta). Usa la API key que el cliente configuró en el panel.
 * Sin credenciales de esos proveedores, devuelve lista vacía.
 * Doc: https://docs.retellai.com/api-references/list-voices
 * Doc: https://elevenlabs.io/docs/api-reference/voices/search
 */
@Injectable()
export class VoiceCatalogService {
  private readonly logger = new Logger('VoiceCatalog');

  constructor(
    private readonly credentials: CredentialsService,
    private readonly voice: VoiceService,
  ) {}

  async list(): Promise<VoiceOption[]> {
    const c = await this.credentials.get('voice');
    if (c?.provider === 'elevenlabs' && c.secret) {
      return this.listElevenLabs(c.secret);
    }
    const key = c?.provider === 'retell' ? c.secret : undefined;
    if (!key) {
      // Sin cuenta propia de voz: las voces de la cuenta de la plataforma,
      // que es por donde llama la voz gestionada.
      const platformKey = c?.secret ? undefined : this.voice.managedApiKey;
      return platformKey ? this.listElevenLabs(platformKey) : [];
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

  private async listElevenLabs(apiKey: string): Promise<VoiceOption[]> {
    const out: VoiceOption[] = [];
    let token: string | undefined;
    try {
      for (let page = 0; page < ELEVENLABS_MAX_PAGES; page++) {
        const qs = new URLSearchParams({ page_size: '100' });
        if (token) {
          qs.set('next_page_token', token);
        }
        const res = await fetch(`${ELEVENLABS_API}/v2/voices?${qs}`, {
          headers: { 'xi-api-key': apiKey },
        });
        if (!res.ok) {
          this.logger.warn(`ElevenLabs /v2/voices respondió ${res.status}`);
          break;
        }
        const json = (await res.json()) as {
          voices?: Array<Record<string, unknown>>;
          has_more?: boolean;
          next_page_token?: string | null;
        };
        for (const v of json.voices ?? []) {
          const labels = (v.labels ?? {}) as Record<string, unknown>;
          const voiceId = String(v.voice_id ?? '');
          if (!voiceId) {
            continue;
          }
          out.push({
            voiceId,
            name: String(v.name ?? voiceId),
            provider: 'elevenlabs',
            gender: labels.gender as string | undefined,
            accent: labels.accent as string | undefined,
            age: labels.age as string | undefined,
            previewUrl: (v.preview_url as string | null) ?? undefined,
          });
        }
        if (!json.has_more || !json.next_page_token) {
          break;
        }
        token = json.next_page_token;
      }
    } catch (e) {
      this.logger.warn(`Error al listar voces: ${(e as Error).message}`);
    }
    return out;
  }
}
