import type { Request } from 'express';
import { PanelRole } from '@prisma/client';

export interface AuthUser {
  userId: string;
  email: string;
}

export interface AuthMembership {
  companyId: string;
  role: PanelRole;
}

/** Request con el usuario y la membresía resueltos por los guards del panel. */
export interface AuthedRequest extends Request {
  user?: AuthUser;
  membership?: AuthMembership;
}
