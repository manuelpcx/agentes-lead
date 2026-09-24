import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { AgentActionsModule } from '../agent-actions/agent-actions.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuditModule } from '../audit/audit.module';
import { PanelService } from './panel.service';
import { PanelController } from './panel.controller';
import { PanelAppointmentsController } from './panel-appointments.controller';

/** API del panel: bandeja, CRM propio (leads, notas) y calendario. */
@Module({
  imports: [
    LeadsModule,
    InteractionsModule,
    AgentActionsModule,
    AppointmentsModule,
    WhatsappModule,
    AuditModule,
  ],
  controllers: [PanelController, PanelAppointmentsController],
  providers: [PanelService],
  // Lo reusa `ApiModule` (/api/v1) para que la API pública y el panel
  // compartan lógica y auditoría en vez de duplicarlas.
  exports: [PanelService],
})
export class PanelModule {}
