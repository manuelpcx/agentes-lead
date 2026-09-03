import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';
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
 * Gestión de plantillas de WhatsApp (HSM) contra la cuenta de YCloud de CADA
 * empresa (BYO). Crea (se envían a aprobación de Meta) y lista con su estado.
 * Doc: https://docs.ycloud.com/reference/whatsapp_template-create
 */
@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger('WhatsappTemplates');

  constructor(private readonly credentials: CredentialsService) {}

  /** Resuelve la cuenta de YCloud de la empresa (API key + WABA). */
  private async ycloud(): Promise<{ key: string; wabaId?: string } | null> {
    const c = await this.credentials.get('whatsapp');
    if (!c || c.provider !== 'ycloud' || !c.secret) {
      return null;
    }
    return {
      key: c.secret,
      wabaId: c.config.wabaId ? String(c.config.wabaId) : undefined,
    };
  }

  /** Crea la plantilla y la envía a aprobación de Meta. */
  async create(dto: CreateWhatsappTemplateDto): Promise<TemplateSummary> {
    const acc = await this.ycloud();
    if (!acc || !acc.wabaId) {
      throw new BadRequestException(
        'Configura WhatsApp (YCloud) con API key y WABA en el panel para crear plantillas.',
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
      headers: { 'Content-Type': 'application/json', 'X-API-Key': acc.key },
      body: JSON.stringify({
        wabaId: acc.wabaId,
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

  /** Lista las plantillas con su estado. Sin WhatsApp YCloud configurado: vacío. */
  async list(): Promise<TemplateSummary[]> {
    const acc = await this.ycloud();
    if (!acc) {
      return [];
    }
    const qs = new URLSearchParams({ limit: '100' });
    if (acc.wabaId) {
      qs.set('filter.wabaId', acc.wabaId);
    }
    const res = await fetch(`${YCLOUD_URL}?${qs.toString()}`, {
      headers: { 'X-API-Key': acc.key },
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
