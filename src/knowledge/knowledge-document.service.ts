import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { KnowledgeDocument, KnowledgeSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { chunkText } from './chunking';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

/** Resumen tras indexar un documento. */
export interface IndexResult {
  documentId: string;
  version: number;
  chunks: number;
}

/** Datos para insertar un fragmento con su embedding. */
interface ChunkInsert {
  companyId: string;
  documentId: string;
  content: string;
  embedding: number[];
  embeddingModel: string;
  chunkIndex: number;
}

@Injectable()
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * Indexa un documento nuevo: trocea, genera embeddings y persiste documento +
   * fragmentos de forma atómica. Los embeddings se calculan ANTES de abrir la
   * transacción (no se sostiene una transacción durante una llamada externa).
   */
  async create(dto: CreateDocumentDto): Promise<IndexResult> {
    const companyId = TenantContext.requireCompanyId();
    const documentId = randomUUID();
    const chunks = chunkText(dto.content);
    const embeddings = await this.embeddings.embedDocuments(chunks);

    await this.prisma.raw.$transaction(async (tx) => {
      await tx.knowledgeDocument.create({
        data: {
          id: documentId,
          companyId,
          title: dto.title,
          sourceType: dto.sourceType ?? KnowledgeSourceType.manual,
          rawContent: dto.content,
          version: 1,
        },
      });
      await this.insertChunks(tx, documentId, companyId, chunks, embeddings);
    });

    this.logger.log(
      `Documento indexado "${dto.title}" (documentId=${documentId} chunks=${chunks.length})`,
    );
    return { documentId, version: 1, chunks: chunks.length };
  }

  /**
   * Edita un documento. Si cambia el contenido, re-trocea/re-indexa y sube la
   * versión; si solo cambian metadatos (título/tipo), no re-indexa.
   */
  async update(
    documentId: string,
    dto: UpdateDocumentDto,
  ): Promise<IndexResult> {
    const companyId = TenantContext.requireCompanyId();
    const current = await this.getById(documentId);

    const reindex = dto.content !== undefined;
    const newContent = dto.content ?? current.rawContent;
    const chunks = reindex ? chunkText(newContent) : [];
    const embeddings = reindex
      ? await this.embeddings.embedDocuments(chunks)
      : [];
    const newVersion = reindex ? current.version + 1 : current.version;

    await this.prisma.raw.$transaction(async (tx) => {
      await tx.knowledgeDocument.update({
        where: { id: documentId, companyId },
        data: {
          title: dto.title ?? current.title,
          sourceType: dto.sourceType ?? current.sourceType,
          rawContent: newContent,
          version: newVersion,
        },
      });

      if (reindex) {
        await tx.knowledgeChunk.deleteMany({
          where: { documentId, companyId },
        });
        await this.insertChunks(tx, documentId, companyId, chunks, embeddings);
      }
    });

    this.logger.log(
      `Documento actualizado (documentId=${documentId} version=${newVersion} reindex=${reindex})`,
    );
    return {
      documentId,
      version: newVersion,
      chunks: reindex ? chunks.length : await this.countChunks(documentId),
    };
  }

  /** Desactiva un documento: deja de aparecer en la búsqueda semántica. */
  async deactivate(documentId: string): Promise<KnowledgeDocument> {
    await this.getById(documentId);
    return this.prisma.db.knowledgeDocument.update({
      where: { id: documentId },
      data: { isActive: false },
    });
  }

  /** Lista los documentos de la empresa activa (sin el contenido crudo). */
  async list(): Promise<Array<Omit<KnowledgeDocument, 'rawContent'>>> {
    return this.prisma.db.knowledgeDocument.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyId: true,
        title: true,
        sourceType: true,
        version: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Obtiene un documento por id (aislado por tenant) o lanza 404. */
  async getById(documentId: string): Promise<KnowledgeDocument> {
    const doc = await this.prisma.db.knowledgeDocument.findFirst({
      where: { id: documentId },
    });
    if (!doc) {
      throw new NotFoundException('Documento de conocimiento no encontrado');
    }
    return doc;
  }

  // ─────────────────────── privados ───────────────────────

  private async countChunks(documentId: string): Promise<number> {
    return this.prisma.db.knowledgeChunk.count({ where: { documentId } });
  }

  /**
   * Inserta fragmentos con su embedding por SQL crudo (Prisma no maneja el tipo
   * `vector`). El `companyId` va explícito: las queries crudas NO pasan por la
   * extensión multi-tenant.
   */
  private async insertChunks(
    tx: Prisma.TransactionClient,
    documentId: string,
    companyId: string,
    chunks: string[],
    embeddings: number[][],
  ): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      await this.insertChunk(tx, {
        companyId,
        documentId,
        content: chunks[i],
        embedding: embeddings[i],
        embeddingModel: this.embeddings.modelId,
        chunkIndex: i,
      });
    }
  }

  private async insertChunk(
    tx: Prisma.TransactionClient,
    chunk: ChunkInsert,
  ): Promise<void> {
    const id = randomUUID();
    const vectorLiteral = `[${chunk.embedding.join(',')}]`;
    await tx.$executeRaw`
      INSERT INTO "KnowledgeChunk"
        (id, "companyId", "documentId", content, embedding, "embeddingModel", "chunkIndex", metadata, "createdAt")
      VALUES
        (${id}::uuid, ${chunk.companyId}::uuid, ${chunk.documentId}::uuid,
         ${chunk.content}, ${vectorLiteral}::vector, ${chunk.embeddingModel},
         ${chunk.chunkIndex}, '{}'::jsonb, now())
    `;
  }
}
