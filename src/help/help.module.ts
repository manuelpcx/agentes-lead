import { Module } from '@nestjs/common';
import { HelpService } from './help.service';
import { HelpController } from './help.controller';

/**
 * Asistente de ayuda de uso de la plataforma (no confundir con el agente de
 * ventas/cobranza): responde dudas sobre cómo usar Agentes Lead basado en la
 * documentación de producto y el estado real de la empresa. Sin acciones —
 * `PrismaService`, `AnthropicService` e `IntegrationsModule` son globales.
 */
@Module({
  controllers: [HelpController],
  providers: [HelpService],
})
export class HelpModule {}
