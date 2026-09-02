import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { CreateWhatsappTemplateDto } from './dto/create-template.dto';

const YCLOUD_URL = 'https://api.ycloud.com/v2/whatsapp/templates';

/** Plantilla normalizada para el panel. */
export interface TemplateSummary {
  name: string;
  language: string;
  category: string;
  status: string;
  reason?: string;
  body?: string;
  createTime?: string;
}

/**
 * Gestión de plantillas de WhatsApp (HSM) contra YCloud: crear (se envían a
 * aprobación de Meta) y listar con su estado. La aprobación la decide Meta;
 * aquí solo se crea y se consulta el estado (PENDING/APPROVED/REJECTED/...).
 * Doc: https://docs.ycloud.com/reference/whatsapp_template-create
 */
@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger('WhatsappTemplates');

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  private apiKey(): string | undefined {
    return this.config.get('YCLOUD_API_KEY', { infer: true });
  }

  /** Crea la plantilla y la envía a aprobación de Meta. Devuelve su estado inicial. */
  async create(dto: CreateWhatsappTemplateDto): Promise<TemplateSummary> {
    const key = this.apiKey();
    const wabaId = this.config.get('YCLOUD_WABA_ID', { infer: true });
    if (!key || !wabaId) {
      throw new BadRequestException(
        'Falta configurar YCLOUD_API_KEY y/o YCLOUD_WABA_ID para gestionar plantillas.',
      );
    }

    const components: Record<string, unknown>[] = [
      {
        type: 'BODY',
        text: dto.body,
        ...(dto.examples && dto.examples.length > 0
          ? { example: { body_text: [dto.examples] } }
          : {}),
      },
    ];
    if (dto.footer) {
      components.push({ type: 'FOOTER', text: dto.footer });
    }

    const res = await fetch(YCLOUD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({
        wabaId,
        name: dto.name,
        language: dto.language,
        category: dto.category,
        components,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.warn(`YCloud create template ${res.status}: ${text.slice(0, 300)}`);
      throw new BadRequestException(
        `YCloud rechazó la plantilla (${res.status}): ${text.slice(0, 300)}`,
      );
    }
    return this.normalize(text ? JSON.parse(text) : {});
  }

  /** Lista las plantillas con su estado. Sin API key devuelve lista vacía. */
  async list(): Promise<TemplateSummary[]> {
    const key = this.apiKey();
    if (!key) {
      return [];
    }
    const wabaId = this.config.get('YCLOUD_WABA_ID', { infer: true });
    const qs = new URLSearchParams({ limit: '100' });
    if (wabaId) {
      qs.set('filter.wabaId', wabaId);
    }
    const res = await fetch(`${YCLOUD_URL}?${qs.toString()}`, {
      headers: { 'X-API-Key': key },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`YCloud list templates ${res.status}: ${detail.slice(0, 200)}`);
      throw new ServiceUnavailableException('No se pudieron listar las plantillas.');
    }
    const json = (await res.json()) as { items?: unknown[] } | unknown[];
    const items = Array.isArray(json) ? json : (json.items ?? []);
    return items.map((it) => this.normalize(it as Record<string, unknown>));
  }

  /** Extrae los campos relevantes de una plantilla de YCloud. */
  private normalize(t: Record<string, unknown>): TemplateSummary {
    const components = Array.isArray(t.components) ? t.components : [];
    const body = components.find(
      (c) => (c as Record<string, unknown>).type === 'BODY',
    ) as Record<string, unknown> | undefined;
    return {
      name: String(t.name ?? ''),
      language: String(t.language ?? ''),
      category: String(t.category ?? ''),
      status: String(t.status ?? 'PENDING'),
      reason: typeof t.reason === 'string' ? t.reason : undefined,
      body: typeof body?.text === 'string' ? body.text : undefined,
      createTime: typeof t.createTime === 'string' ? t.createTime : undefined,
    };
  }
}
