import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PanelRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import {
  ImportPreview,
  ImportResult,
  LeadImportService,
} from './lead-import.service';
import { parseImportOptions } from './import-options';
import { decodeCsvBuffer } from './csv';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';

/** 10 MB: un CSV de 5.000 contactos pesa bastante menos. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Forma mínima de lo que produce Multer con memoryStorage. Igual que en
 * `PanelKnowledgeController`: no usamos `Express.Multer.File` porque requiere
 * `@types/multer` y no podemos instalar dependencias en este entorno.
 */
interface UploadedMulterFile {
  originalname: string;
  buffer: Buffer;
}

/**
 * Importación de la base de leads desde el CRM anterior del cliente. Dos
 * pasos, a propósito: primero `preview` (lee el archivo y propone el mapeo,
 * sin escribir nada) y después `import` con el mapeo ya confirmado por la
 * persona. Traerse miles de contactos ajenos adivinando qué columna es el
 * teléfono no es algo que deba pasar sin que alguien lo mire.
 *
 * El archivo se manda las dos veces: así no hay que guardar estado a medias
 * entre un paso y el otro.
 */
@Controller('panel/leads/import')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
@RateLimit({ limit: 10, windowSec: 60, scope: 'auth' })
export class PanelImportController {
  constructor(private readonly imports: LeadImportService) {}

  @Post('preview')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  preview(@UploadedFile() file?: UploadedMulterFile): Promise<ImportPreview> {
    return this.imports.preview(readCsv(file));
  }

  @Post()
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  run(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: UploadedMulterFile,
  ): Promise<ImportResult> {
    const csv = readCsv(file);
    const options = parseImportOptions(body, file?.originalname);
    return this.imports.run(csv, options, user.userId);
  }
}

/** Valida el archivo y lo pasa a texto. */
function readCsv(file?: UploadedMulterFile): string {
  if (!file) {
    throw new BadRequestException('Falta el archivo.');
  }
  if (!/\.csv$/i.test(file.originalname)) {
    throw new BadRequestException(
      'El archivo debe ser .csv. Si lo tienes en Excel, usa "Guardar como > CSV".',
    );
  }
  return decodeCsvBuffer(file.buffer);
}
