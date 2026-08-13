import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { SemanticSearchService } from './semantic-search.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';

/**
 * Administración de documentos de conocimiento + búsqueda semántica de prueba.
 * Aislado por tenant vía `CompanyAuthGuard` (firma HMAC por empresa).
 */
@Controller('knowledge')
@UseGuards(CompanyAuthGuard)
export class KnowledgeController {
  constructor(
    private readonly documents: KnowledgeDocumentService,
    private readonly search: SemanticSearchService,
  ) {}

  @Post('documents')
  create(@Body() dto: CreateDocumentDto) {
    return this.documents.create(dto);
  }

  @Get('documents')
  list() {
    return this.documents.list();
  }

  @Get('documents/:id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.getById(id);
  }

  @Patch('documents/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documents.update(id, dto);
  }

  @Delete('documents/:id')
  deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.deactivate(id);
  }

  /** Buscador de prueba: "pregúntale algo al conocimiento". */
  @Post('search')
  searchKnowledge(@Body() dto: SearchKnowledgeDto) {
    return this.search.search(dto.query, {
      topK: dto.topK,
      minSimilarity: dto.minSimilarity,
    });
  }
}
