import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TenantContext } from '../tenant/tenant-context';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId: string;
  timestamp: string;
  path: string;
}

/**
 * Captura toda excepción y responde con un cuerpo uniforme, incluyendo el
 * `correlationId` para poder cruzar la respuesta con los logs. No filtra
 * detalles internos al cliente en errores 5xx.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = TenantContext.get()?.correlationId ?? 'sin-contexto';

    const { status, message, error } = this.normalize(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Error no controlado en ${req.method} ${req.url} (correlationId=${correlationId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      correlationId,
      timestamp: new Date().toISOString(),
      path: req.url,
    };

    res.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { status, message: response, error: exception.name };
      }
      const obj = response as Record<string, unknown>;
      return {
        status,
        message: (obj.message as string | string[]) ?? exception.message,
        error: (obj.error as string) ?? exception.name,
      };
    }
    // Errores 4xx de body-parser (cuerpo demasiado grande, JSON mal formado):
    // siguen la convención de `http-errors` (`status` + `expose`). Son culpa
    // de quien llama, no nuestra: antes salían como 500 y ensuciaban las
    // alertas, y el remitente no sabía qué había hecho mal.
    const clientError = exception as {
      status?: unknown;
      expose?: unknown;
      message?: unknown;
    } | null;
    if (
      clientError &&
      clientError.expose === true &&
      typeof clientError.status === 'number' &&
      clientError.status >= 400 &&
      clientError.status < 500
    ) {
      return {
        status: clientError.status,
        message:
          typeof clientError.message === 'string'
            ? clientError.message
            : 'Solicitud inválida',
        error: exception instanceof Error ? exception.name : 'BadRequest',
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
      error: 'InternalServerError',
    };
  }
}
