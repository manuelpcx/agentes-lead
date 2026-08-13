import { Injectable, Logger } from '@nestjs/common';
import { FactCategory, KnowledgeSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { StructuredFactsService } from './structured-facts.service';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { OnboardingDto } from './dto/onboarding.dto';

/** Resumen de lo creado durante el onboarding. */
export interface OnboardingResult {
  factsCreated: number;
  documentsCreated: string[];
  businessHoursUpdated: boolean;
}

/**
 * Convierte el cuestionario de una empresa en conocimiento accionable:
 *  - Datos operativos (precios, servicios, horarios, políticas, tono) →
 *    `StructuredFact` (fuente de verdad, consulta directa).
 *  - Texto libre (FAQs, objeciones, catálogo) → documentos indexados (RAG).
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: StructuredFactsService,
    private readonly documents: KnowledgeDocumentService,
  ) {}

  async run(dto: OnboardingDto): Promise<OnboardingResult> {
    const companyId = TenantContext.requireCompanyId();
    let factsCreated = 0;
    const documentsCreated: string[] = [];

    // ── Servicios y precios → StructuredFact + catálogo indexado ──
    if (dto.services?.length) {
      for (const service of dto.services) {
        const slug = this.slug(service.name);
        await this.facts.upsert({
          key: `servicio_${slug}`,
          category: FactCategory.SERVICIO,
          value: { nombre: service.name, descripcion: service.description },
        });
        factsCreated++;

        if (service.price !== undefined) {
          await this.facts.upsert({
            key: `precio_${slug}`,
            category: FactCategory.PRECIO,
            value: {
              servicio: service.name,
              monto: service.price,
              moneda: service.currency ?? 'CLP',
            },
          });
          factsCreated++;
        }
      }

      const catalogo = dto.services
        .map((s) => {
          const precio =
            s.price !== undefined
              ? `\nPrecio: ${s.price} ${s.currency ?? 'CLP'}`
              : '';
          return `## ${s.name}\n${s.description ?? ''}${precio}`;
        })
        .join('\n\n');
      const doc = await this.documents.create({
        title: 'Catálogo de servicios',
        sourceType: KnowledgeSourceType.manual,
        content: catalogo,
      });
      documentsCreated.push(doc.documentId);
    }

    // ── Horarios → Company.businessHours + StructuredFact ──
    let businessHoursUpdated = false;
    if (dto.businessHours) {
      await this.prisma.raw.company.update({
        where: { id: companyId },
        data: { businessHours: dto.businessHours as Prisma.InputJsonValue },
      });
      await this.facts.upsert({
        key: 'horario_atencion',
        category: FactCategory.HORARIO,
        value: dto.businessHours,
      });
      factsCreated++;
      businessHoursUpdated = true;
    }

    // ── Políticas → StructuredFact ──
    if (dto.policies?.length) {
      for (const policy of dto.policies) {
        await this.facts.upsert({
          key: `politica_${this.slug(policy.key)}`,
          category: FactCategory.POLITICA,
          value: { descripcion: policy.description },
        });
        factsCreated++;
      }
    }

    // ── FAQs → documento indexado (sourceType faq) ──
    if (dto.faqs?.length) {
      const content = dto.faqs
        .map((f) => `P: ${f.question}\nR: ${f.answer}`)
        .join('\n\n');
      const doc = await this.documents.create({
        title: 'Preguntas frecuentes',
        sourceType: KnowledgeSourceType.faq,
        content,
      });
      documentsCreated.push(doc.documentId);
    }

    // ── Objeciones → documento indexado ──
    if (dto.objections?.length) {
      const content = dto.objections
        .map((o) => `Objeción: ${o.objection}\nRespuesta: ${o.response}`)
        .join('\n\n');
      const doc = await this.documents.create({
        title: 'Manejo de objeciones',
        sourceType: KnowledgeSourceType.manual,
        content,
      });
      documentsCreated.push(doc.documentId);
    }

    // ── Tono de voz → StructuredFact (config para el prompt del agente) ──
    if (dto.toneOfVoice) {
      await this.facts.upsert({
        key: 'tono_de_voz',
        category: FactCategory.OTRO,
        value: { texto: dto.toneOfVoice },
      });
      factsCreated++;
    }

    this.logger.log(
      `Onboarding completado (companyId=${companyId} facts=${factsCreated} docs=${documentsCreated.length})`,
    );
    return { factsCreated, documentsCreated, businessHoursUpdated };
  }

  /** Normaliza un texto a una clave estable (sin acentos ni símbolos). */
  private slug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }
}
