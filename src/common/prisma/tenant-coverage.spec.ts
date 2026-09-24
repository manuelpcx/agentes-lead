import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_SCOPED_MODELS } from './tenant.extension';

/**
 * Modelos con `companyId` que quedan FUERA del aislamiento automático a
 * propósito, y por qué. Agregar uno acá es una decisión de seguridad: hay que
 * poder explicarla.
 */
const EXENTOS: Record<string, string> = {
  // Plano de autenticación: siempre se consulta por `raw` con ids explícitos
  // (userId + companyId) ANTES de que exista un contexto de tenant.
  Membership: 'auth-plane, consultado por raw con ids explícitos',
};

/** Nombres de los modelos del schema que declaran un campo `companyId`. */
function modelosConCompanyId(): string[] {
  const schema = readFileSync(
    join(__dirname, '../../../prisma/schema.prisma'),
    'utf8',
  );
  const modelos: string[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) {
    if (/^\s*companyId\s/m.test(m[2])) {
      modelos.push(m[1]);
    }
  }
  return modelos;
}

/**
 * Regresión del bug más caro que puede tener un SaaS multi-tenant: un modelo
 * nuevo con `companyId` que nadie agregó a `TENANT_SCOPED_MODELS`, con lo que
 * `prisma.db.<modelo>.findMany()` devuelve datos de TODAS las empresas.
 * Pasó dos veces (Integration, ComplianceIssue); este test lo hace imposible
 * de repetir en silencio.
 */
describe('cobertura del aislamiento multi-tenant', () => {
  it('todo modelo con companyId está en TENANT_SCOPED_MODELS o exento con motivo', () => {
    const sinCubrir = modelosConCompanyId().filter(
      (modelo) => !TENANT_SCOPED_MODELS.has(modelo) && !(modelo in EXENTOS),
    );
    expect(sinCubrir).toEqual([]);
  });

  it('el set no lista modelos que ya no existen en el schema', () => {
    const existentes = new Set(modelosConCompanyId());
    const fantasmas = [...TENANT_SCOPED_MODELS].filter(
      (modelo) => !existentes.has(modelo),
    );
    expect(fantasmas).toEqual([]);
  });

  it('el schema tiene los modelos que esperamos (sanity del parser)', () => {
    const modelos = modelosConCompanyId();
    expect(modelos).toEqual(expect.arrayContaining(['Lead', 'Integration']));
    expect(modelos.length).toBeGreaterThan(10);
  });
});
