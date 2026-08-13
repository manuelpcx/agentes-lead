import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AppointmentsService } from './appointments.service';
import { RemindersScheduler } from './reminders.scheduler';

/** Agendamiento + recordatorios (Fase 5). EmailModule es global. */
@Module({
  imports: [LeadsModule, InteractionsModule, WhatsappModule],
  providers: [AppointmentsService, RemindersScheduler],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
