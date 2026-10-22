import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_AGENT_TURN, QUEUE_LEAD_MEMORY } from '../queue/queue.constants';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AgentActionsModule } from '../agent-actions/agent-actions.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ImprovementModule } from '../improvement/improvement.module';
import { CrmEventsModule } from '../crm/crm-events.module';
import { AGENT_TOOLS, AgentTool } from './tools/tool.interface';
import { BuscarConocimientoTool } from './tools/buscar-conocimiento.tool';
import { ConsultarDatoTool } from './tools/consultar-dato.tool';
import { EnviarWhatsAppTool } from './tools/enviar-whatsapp.tool';
import { ActualizarEstadoLeadTool } from './tools/actualizar-estado-lead.tool';
import { EscalarAHumanoTool } from './tools/escalar-a-humano.tool';
import { EnviarCorreoTool } from './tools/enviar-correo.tool';
import { AgendarCitaTool } from './tools/agendar-cita.tool';
import { IniciarLlamadaTool } from './tools/iniciar-llamada.tool';
import { DerivarAAgenteTool } from './tools/derivar-a-agente.tool';
import { RegistrarPromesaPagoTool } from './tools/registrar-promesa-pago.tool';
import { ProgramarRecontactoTool } from './tools/programar-recontacto.tool';
import { ActualizarCompromisoTool } from './tools/actualizar-compromiso.tool';
import { ConsultarCrmTool } from './tools/consultar-crm.tool';
import { CancelarSeguimientoTool } from './tools/cancelar-seguimiento.tool';
import { CalificarLeadTool } from './tools/calificar-lead.tool';
import { GuardarEnMemoriaTool } from './tools/guardar-en-memoria.tool';
import { ToolRegistry } from './tools/tool-registry.service';
import { ContextBuilder } from './context-builder.service';
import { AgentRunner } from './agent-runner.service';
import { AgentTurnProcessor } from './agent-turn.processor';
import { TurnLockService } from './turn-lock.service';

/**
 * El agente vivo (Fase 3): bucle de decisión contra Anthropic, herramientas,
 * armado de contexto y worker de turnos. `LlmModule` y `PromptsModule` son
 * globales.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AGENT_TURN }),
    BullModule.registerQueue({ name: QUEUE_LEAD_MEMORY }),
    KnowledgeModule,
    LeadsModule,
    InteractionsModule,
    WhatsappModule,
    AgentActionsModule,
    AppointmentsModule,
    ImprovementModule,
    CrmEventsModule,
  ],
  providers: [
    BuscarConocimientoTool,
    ConsultarDatoTool,
    EnviarWhatsAppTool,
    ActualizarEstadoLeadTool,
    EscalarAHumanoTool,
    EnviarCorreoTool,
    AgendarCitaTool,
    IniciarLlamadaTool,
    DerivarAAgenteTool,
    RegistrarPromesaPagoTool,
    ConsultarCrmTool,
    CancelarSeguimientoTool,
    CalificarLeadTool,
    GuardarEnMemoriaTool,
    ProgramarRecontactoTool,
    ActualizarCompromisoTool,
    {
      provide: AGENT_TOOLS,
      inject: [
        BuscarConocimientoTool,
        ConsultarDatoTool,
        EnviarWhatsAppTool,
        ActualizarEstadoLeadTool,
        EscalarAHumanoTool,
        EnviarCorreoTool,
        AgendarCitaTool,
        IniciarLlamadaTool,
        DerivarAAgenteTool,
        RegistrarPromesaPagoTool,
        ConsultarCrmTool,
        CancelarSeguimientoTool,
        CalificarLeadTool,
        GuardarEnMemoriaTool,
        ProgramarRecontactoTool,
        ActualizarCompromisoTool,
      ],
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
    },
    ToolRegistry,
    ContextBuilder,
    AgentRunner,
    TurnLockService,
    AgentTurnProcessor,
  ],
  exports: [AgentRunner],
})
export class AgentModule {}
