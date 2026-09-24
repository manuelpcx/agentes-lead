import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { PanelService } from './panel.service';
import { ReplyDto } from './dto/reply.dto';
import { CreateLeadDto, ListLeadsQuery, UpdateLeadDto } from './dto/lead.dto';
import { CreateLeadNoteDto } from './dto/lead-note.dto';
import { UpdateLeadMemoryDto } from './dto/lead-memory.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * API del panel. Todas las rutas requieren JWT + membresía en la empresa
 * seleccionada (`X-Company-Id`). Las acciones de escritura exigen rol
 * OWNER/OPERADOR; SOLO_LECTURA solo puede leer.
 */
@Controller('panel')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelController {
  constructor(private readonly panel: PanelService) {}

  @Get('leads')
  listLeads(@Query() query: ListLeadsQuery) {
    return this.panel.listLeads(query);
  }

  @Post('leads')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  createLead(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.panel.createLead(dto, user.userId);
  }

  @Get('leads/:id')
  getLead(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.panel.getLeadDetail(id);
  }

  @Patch('leads/:id')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  updateLead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.updateLead(id, dto, user.userId);
  }

  @Patch('leads/:id/memory')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  updateMemory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLeadMemoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.updateMemory(id, dto, user.userId);
  }

  @Get('leads/:id/notes')
  listNotes(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.panel.listNotes(id);
  }

  @Post('leads/:id/notes')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  addNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateLeadNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.addNote(id, dto.body, user.userId);
  }

  @Delete('notes/:noteId')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  deleteNote(
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.deleteNote(noteId, user.userId);
  }

  @Post('leads/:id/take-control')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  takeControl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.takeControl(id, user.userId);
  }

  @Post('leads/:id/release-control')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  releaseControl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.releaseControl(id, user.userId);
  }

  @Post('leads/:id/reply')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  reply(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReplyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.humanReply(id, dto.text, user.userId);
  }
}
