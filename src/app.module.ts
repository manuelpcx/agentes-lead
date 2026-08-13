import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, EnvVars } from './common/config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { CommonModule } from './common/common.module';
import { TenantContext } from './common/tenant/tenant-context';
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware';
import { QueueModule } from './queue/queue.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { LlmModule } from './llm/llm.module';
import { PromptsModule } from './prompts/prompts.module';
import { CompaniesModule } from './companies/companies.module';
import { AgentsModule } from './agents/agents.module';
import { InteractionsModule } from './interactions/interactions.module';
import { LeadsModule } from './leads/leads.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AgentActionsModule } from './agent-actions/agent-actions.module';
import { AgentModule } from './agent/agent.module';
import { FollowupModule } from './followup/followup.module';
import { EmailModule } from './email/email.module';
import { VapiModule } from './vapi/vapi.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ImprovementModule } from './improvement/improvement.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { PanelModule } from './panel/panel.module';
import { PanelAdminModule } from './panel-admin/panel-admin.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Configuración global + validación fail-fast del entorno.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    // Scheduler para el cron de seguimiento (Fase 4).
    ScheduleModule.forRoot(),
    // Logging estructurado (pino). `mixin` inyecta correlationId/companyId
    // desde el TenantContext en CADA línea de log (HTTP y workers).
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          mixin: () => {
            const store = TenantContext.get();
            if (!store) {
              return {};
            }
            const props: Record<string, string> = {
              correlationId: store.correlationId,
            };
            if (store.companyId) {
              props.companyId = store.companyId;
            }
            return props;
          },
        },
      }),
    }),

    // Infraestructura transversal.
    PrismaModule,
    CryptoModule,
    CommonModule,
    QueueModule,
    EmbeddingsModule,
    LlmModule,
    PromptsModule,
    EmailModule,
    VapiModule,

    // Dominios de la Fase 1.
    CompaniesModule,
    AgentsModule,
    InteractionsModule,
    LeadsModule,
    WebhooksModule,

    // Fase 2: base de conocimiento.
    KnowledgeModule,

    // Fase 3: el agente vivo (WhatsApp).
    WhatsappModule,
    AgentActionsModule,
    AgentModule,

    // Fase 4: seguimiento automático.
    FollowupModule,

    // Fase 5: canales adicionales (correo, llamadas, agendamiento).
    AppointmentsModule,

    // Fase 6: mejora continua (con aprobación humana).
    ImprovementModule,

    // Fase 7A: panel mínimo (auth + API del panel).
    AuditModule,
    AuthModule,
    PanelModule,
    PanelAdminModule,

    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Abre el contexto de tenant/correlación para todas las rutas.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
