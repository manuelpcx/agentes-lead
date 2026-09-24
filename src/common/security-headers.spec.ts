import type { NextFunction, Request, Response } from 'express';
import { SECURITY_HEADERS, securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  it('fija todas las cabeceras y sigue la cadena', () => {
    const set: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        set[k] = v;
      },
    } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;

    securityHeaders({} as Request, res, next);

    expect(set).toEqual(SECURITY_HEADERS);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('la CSP de la API no permite cargar ni embeber nada', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain(
      "default-src 'none'",
    );
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });
});
