import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { TenantContext } from '../common/tenant/tenant-context';

/** Un fragmento relevante recuperado por la búsqueda. */
export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

export interface SearchOptions {
  topK?: number;
  minSimilarity?: number;
}

const DEFAULT_TOP_K = 5;
/** Umbral por defecto. Ajustable por consulta; depende del embedder. */
const DEFAULT_MIN_SIMILARITY = 0.3;

interface RawRow {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

@Injectable()
export class SemanticSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * Búsqueda vectorial top-K filtrada por empresa y por documentos activos. Si
   * ningún fragmento supera el umbral de similitud, devuelve `[]` (nunca
   * "basura"): el agente debe poder detectar que no sabe y escalar.
   */
  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const companyId = TenantContext.requireCompanyId();
    const topK = options.topK ?? DEFAULT_TOP_K;
    const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

    const vector = await this.embeddings.embedQuery(query);
    const vectorLiteral = `[${vector.join(',')}]`;

    // Query cruda: pgvector no pasa por Prisma. `<=>` = distancia coseno;
    // similitud = 1 - distancia. companyId explícito (no hay extensión aquí).
    const rows = await this.prisma.raw.$queryRaw<RawRow[]>`
      SELECT c.id            AS "chunkId",
             c."documentId"  AS "documentId",
             d.title         AS "documentTitle",
             c.content       AS content,
             1 - (c.embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d.id = c."documentId"
      WHERE c."companyId" = ${companyId}::uuid
        AND d."isActive" = true
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `;

    return rows
      .map((r) => ({ ...r, similarity: Number(r.similarity) }))
      .filter((r) => r.similarity >= minSimilarity);
  }
}
