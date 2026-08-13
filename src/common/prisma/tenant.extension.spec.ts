import { applyTenantScope, OperationArgs } from './tenant.extension';

const COMPANY = 'company-abc';

describe('applyTenantScope (aislamiento multi-tenant)', () => {
  it('inyecta companyId en data al crear un modelo tenant-scoped', () => {
    const args: OperationArgs = { data: { externalId: 'x1' } };
    const out = applyTenantScope('Lead', 'create', args, COMPANY);
    expect((out.data as Record<string, unknown>).companyId).toBe(COMPANY);
  });

  it('inyecta companyId en cada item de un createMany', () => {
    const args: OperationArgs = {
      data: [{ externalId: 'a' }, { externalId: 'b' }],
    };
    const out = applyTenantScope('Interaction', 'createMany', args, COMPANY);
    const data = out.data as Array<Record<string, unknown>>;
    expect(data.every((d) => d.companyId === COMPANY)).toBe(true);
  });

  it('añade companyId al where en lecturas', () => {
    const args: OperationArgs = { where: { status: 'NUEVO' } };
    const out = applyTenantScope('Lead', 'findMany', args, COMPANY);
    expect(out.where).toEqual({ status: 'NUEVO', companyId: COMPANY });
  });

  it('añade companyId al where en updates y deletes', () => {
    const upd = applyTenantScope(
      'Lead',
      'update',
      { where: { id: '1' } },
      COMPANY,
    );
    expect(upd.where).toEqual({ id: '1', companyId: COMPANY });

    const del = applyTenantScope(
      'Agent',
      'delete',
      { where: { id: '2' } },
      COMPANY,
    );
    expect(del.where).toEqual({ id: '2', companyId: COMPANY });
  });

  it('en upsert inyecta companyId en create y en where', () => {
    const args: OperationArgs = {
      where: { id: '1' },
      create: { externalId: 'x' },
      update: {},
    };
    const out = applyTenantScope('Lead', 'upsert', args, COMPANY);
    expect((out.create as Record<string, unknown>).companyId).toBe(COMPANY);
    expect(out.where).toEqual({ id: '1', companyId: COMPANY });
  });

  it('NO toca la entidad raíz Company (no es tenant-scoped)', () => {
    const args: OperationArgs = { where: { id: 'c1' } };
    const out = applyTenantScope('Company', 'findFirst', args, COMPANY);
    expect(out.where).toEqual({ id: 'c1' });
  });

  it('sin companyId en contexto, deja los args intactos', () => {
    const args: OperationArgs = { where: { status: 'NUEVO' } };
    const out = applyTenantScope('Lead', 'findMany', args, undefined);
    expect(out.where).toEqual({ status: 'NUEVO' });
  });

  it('respeta un companyId ya presente en data (no lo sobrescribe)', () => {
    const args: OperationArgs = {
      data: { companyId: 'otra', externalId: 'x' },
    };
    const out = applyTenantScope('Lead', 'create', args, COMPANY);
    expect((out.data as Record<string, unknown>).companyId).toBe('otra');
  });
});
