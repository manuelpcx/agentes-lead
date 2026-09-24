import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeSourceType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import {
  KnowledgeDocumentService,
  IndexResult,
} from './knowledge-document.service';
import { extractText } from './extract-text';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB — de sobra para texto plano

/**
 * Forma mínima de lo que produce Multer con memoryStorage. No usamos el tipo
 * ambient `Express.Multer.File` porque requiere `@types/multer`, y instalar
 * cualquier dependencia nueva rompe `node_modules` en este entorno (conflicto
 * npm/pnpm preexistente, no de red).
 */
interface UploadedMulterFile {
  originalname: string;
  buffer: Buffer;
}

/**
 * Carga de documentos desde el panel (chat del asistente incluido) — distinto
 * de `KnowledgeController` (guardado por HMAC, para integraciones externas
 * tipo n8n). Reutiliza el mismo `KnowledgeDocumentService`, solo cambia quién
 * puede llamarlo y cómo llega el contenido (archivo en vez de texto ya listo).
 */
@Controller('panel/knowledge')
@UseGuards(JwtAuthGuard, CompanyGuard)
export class PanelKnowledgeController {
  constructor(private readonly documents: KnowledgeDocumentService) {}

  @Post('upload')
  // Cada archivo genera embeddings (API de pago): se acota por usuario.
  @RateLimit({ limit: 20, windowSec: 60, scope: 'auth' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @UploadedFile() file?: UploadedMulterFile,
  ): Promise<IndexResult & { title: string }> {
    if (!file) {
      throw new BadRequestException('Falta el archivo.');
    }
    const content = extractText(file);
    const result = await this.documents.create({
      title: file.originalname,
      content,
      sourceType: KnowledgeSourceType.archivo,
    });
    return { ...result, title: file.originalname };
  }
}
