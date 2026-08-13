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
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
      error: 'InternalServerError',
    };
  }
}
