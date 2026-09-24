import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { HelpService, AskHelpResult } from './help.service';
import { AskHelpDto } from './dto/ask-help.dto';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';

/**
 * Asistente de ayuda de uso de la plataforma. Puede proponer un agente
 * nuevo (`proposal`), pero nunca lo crea — eso lo hace el panel cuando la
 * persona confirma, contra el endpoint de agentes que ya existe.
 */
@Controller('panel/help')
@UseGuards(JwtAuthGuard, CompanyGuard)
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Post('ask')
  // Cada pregunta es una llamada al LLM: se acota el gasto por usuario.
  @RateLimit({ limit: 30, windowSec: 60, scope: 'auth' })
  ask(@Body() dto: AskHelpDto): Promise<AskHelpResult> {
    return this.help.ask(dto.messages);
  }
}
