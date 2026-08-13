import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import type { EnvVars } from './common/config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Buffer de logs hasta cablear pino; rawBody habilita la verificación HMAC.
    bufferLogs: true,
    rawBody: true,
  });

  // Logger estructurado (pino) como logger de la app.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<EnvVars, true>);

  // CORS para el panel (SPA en otro origen). `CORS_ORIGIN` (coma-separado) fija
  // los dominios permitidos en producción; sin él, refleja cualquiera (dev).
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Company-Id',
      'X-Signature',
    ],
  });

  // Validación global estricta: rechaza propiedades no declaradas y transforma.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Formato de error uniforme con correlationId.
  app.useGlobalFilters(new HttpExceptionFilter());

  // Cierre ordenado: dispara onModuleDestroy (Prisma/Redis).
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  // Bind a 0.0.0.0: los PaaS (Railway) enrutan el tráfico público por IPv4;
  // el default de Node (`::`) puede no aceptarlo → "Application failed to respond".
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`API escuchando en 0.0.0.0:${port}`);
}

// Captura explícita: si el arranque falla, se imprime crudo y sale con código 1
// (sin esto, el error puede quedar oculto por el buffer de logs en el PaaS).
bootstrap().catch((err) => {
  console.error('Fallo al arrancar la aplicación:', err);
  process.exit(1);
});
