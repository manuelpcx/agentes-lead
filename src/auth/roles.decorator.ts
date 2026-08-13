import { SetMetadata } from '@nestjs/common';
import { PanelRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe una ruta a los roles indicados (evaluado por `RolesGuard`). */
export const Roles = (...roles: PanelRole[]) => SetMetadata(ROLES_KEY, roles);
