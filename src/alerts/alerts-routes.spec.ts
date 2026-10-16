import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CompanyGuard } from '../auth/guards/company.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { PlatformController } from '../platform/platform.controller';
import { PanelAlertsController } from './panel-alerts.controller';

describe('rutas de alertas', () => {
  it('/panel/alerts va detrás del guard de empresa', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PanelAlertsController)).toBe(
      'panel/alerts',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PanelAlertsController),
    ).toContain(CompanyGuard);
  });

  it('/platform/incidents queda detrás del guard de administradores', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        PlatformController.prototype.listIncidents,
      ),
    ).toBe('incidents');
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformController)).toContain(
      PlatformAdminGuard,
    );
  });
});
