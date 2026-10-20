import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { EmbeddingsService } from '../embeddings/embeddings.service';

/** Ejemplo recuperado para inyectar como few-shot. */
export interface SimilarExample {
  situation: string;
  agentResponse: string;
}

/** Ejemplo pendiente de aprobar (sin el embedding). */
export interface PendingExample {
  id: string;
  situation: string;
  agentResponse: string;
  outcome: string;
  createdAt: Date;
}

/** Lo que se embebe de un ejemplo (al guardarlo y al reindexarlo). */
export function textoDeEjemplo(
  situation: string,
  agentResponse: string,
): string {
  return `${situation}\n${agentResponse}`;
}

@Injectable()
export class ExampleLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Guarda un ejemplo (sin aprobar) con su embedding (SQL crudo por pgvector). */
  async record(
    situation: string,
    agentResponse: string,
    outcome: string,
  ): Promise<void> {
    const companyId = TenantContext.requireCompanyId();
    const [embedding] = await this.embeddings.embedDocuments([
      textoDeEjemplo(situation, agentResponse),
    ]);
    const vector = `[${embedding.join(',')}]`;
    const id = randomUUID();
    await this.prisma.raw.$executeRaw`
      INSERT INTO "ExampleLibrary"
        (id, "companyId", situation, "agentResponse", outcome, embedding, "embeddingModel", "isApproved", "usageCount", "createdAt")
      VALUES
        (${id}::uuid, ${companyId}::uuid, ${situation}, ${agentResponse}, ${outcome},
         ${vector}::vector, ${this.embeddings.modelId}, false, 0, now())
    `;
  }

  /** Recupera ejemplos aprobados más similares a la consulta (few-shot). */
  async findSimilar(query: string, topK = 2): Promise<SimilarExample[]> {
    const companyId = TenantContext.requireCompanyId();
    const qv = await this.embeddings.embedQuery(query);
    const vector = `[${qv.join(',')}]`;
    return this.prisma.raw.$queryRaw<SimilarExample[]>`
      SELECT situation, "agentResponse"
      FROM "ExampleLibrary"
      WHERE "companyId" = ${companyId}::uuid AND "isApproved" = true
        AND "embeddingModel" = ${this.embeddings.modelId}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${topK}
    `;
  }

  /** Lista los ejemplos pendientes de aprobación (sin el embedding). */
  async listPending(): Promise<PendingExample[]> {
    return this.prisma.db.exampleLibrary.findMany({
      where: { isApproved: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        situation: true,
        agentResponse: true,
        outcome: true,
        createdAt: true,
      },
    });
  }

  /** Aprueba un ejemplo (queda disponible para few-shot). */
  async approve(id: string): Promise<void> {
    await this.prisma.db.exampleLibrary.updateMany({
      where: { id },
      data: { isApproved: true },
    });
  }
}
