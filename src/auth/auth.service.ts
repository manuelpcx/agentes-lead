import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PanelRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { PlatformEmailService } from '../email/platform-email.service';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';

/** Costo de bcrypt. */
const BCRYPT_ROUNDS = 10;
/** Vigencia del enlace de recuperación de contraseña. */
const RESET_TTL_MS = 60 * 60 * 1000;

/** Membresía expuesta al panel (empresa + rol). */
export interface MembershipView {
  companyId: string;
  companyName: string;
  role: PanelRole;
}

/** Usuario tal como lo consume el panel. */
export interface UserView {
  id: string;
  email: string;
  name: string | null;
  /** Null si nunca completó ni saltó el tour de bienvenida. */
  onboardingCompletedAt: Date | null;
  /** Administrador de la plataforma: ve el mantenedor de clientes. */
  isPlatformAdmin: boolean;
}

export interface LoginResult {
  accessToken: string;
  user: UserView;
  memberships: MembershipView[];
}

/**
 * Auth del panel: usuarios (auth-plane, transversal a empresas), membresías con
 * rol, emisión de JWT y ciclo de vida de la contraseña. Usa el cliente crudo
 * (User/Membership no son tenant-scoped).
 */
@Injectable()
export class AuthService {
  private readonly panelUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly companies: CompaniesService,
    private readonly platformEmail: PlatformEmailService,
    config: ConfigService<EnvVars, true>,
  ) {
    // Para los enlaces de los correos: PANEL_URL, o el primer origen de CORS
    // (que en producción es justamente el dominio del panel), o el dev server.
    this.panelUrl = (
      config.get('PANEL_URL', { infer: true }) ??
      config.get('CORS_ORIGIN', { infer: true })?.split(',')[0]?.trim() ??
      'http://localhost:5173'
    ).replace(/\/+$/, '');
  }

  /**
   * Registro autoservicio: crea la empresa (con su agente por defecto), el
   * usuario OWNER y devuelve el JWT + el secreto de webhook (una sola vez).
   */
  async registerCompany(dto: RegisterCompanyDto): Promise<
    LoginResult & {
      company: { id: string; name: string };
      webhookSecret: string;
    }
  > {
    // Antes de crear nada: si el email ya tiene cuenta, se corta acá. Si no,
    // el upsert de más abajo no tocaba la contraseña pero SÍ le colgaba al
    // usuario ajeno una membresía OWNER en la empresa recién creada — y el
    // login final fallaba, dejando la empresa huérfana.
    const existing = await this.prisma.raw.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe una cuenta con ese email. Inicia sesión con ella.',
      );
    }

    const { company, webhookSecret } = await this.companies.create({
      name: dto.companyName,
      rut: dto.rut,
    });
    await this.createUser(
      {
        email: dto.email,
        password: dto.password,
        name: dto.name,
        role: PanelRole.OWNER,
      },
      company.id,
    );
    const login = await this.login(dto.email, dto.password);
    return {
      ...login,
      company: { id: company.id, name: company.name },
      webhookSecret,
    };
  }

  /**
   * Crea (o actualiza) un usuario y le asigna una membresía en la empresa
   * indicada. Se invoca autenticando por HMAC de la empresa (bootstrap).
   */
  async createUser(
    dto: CreateUserDto,
    companyId: string,
  ): Promise<{ userId: string; email: string; role: PanelRole }> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.raw.user.upsert({
      where: { email: dto.email },
      create: { email: dto.email, passwordHash, name: dto.name },
      update: dto.name ? { name: dto.name } : {},
    });
    await this.prisma.raw.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      create: { userId: user.id, companyId, role: dto.role },
      update: { role: dto.role },
    });
    return { userId: user.id, email: user.email, role: dto.role };
  }

  /** Valida credenciales, emite el JWT y devuelve las membresías del usuario. */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.raw.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return {
      accessToken: await this.issueToken(user.id, user.email),
      user: toUserView(user),
      memberships: await this.getMemberships(user.id),
    };
  }

  /** Perfil del usuario de la sesión, para `GET /auth/me`. */
  async getProfile(userId: string): Promise<UserView> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión inválida');
    }
    return toUserView(user);
  }

  /**
   * Marca el tour de bienvenida como visto. Lo llama tanto terminarlo como
   * saltarlo: la idea es que no persiga a nadie. Es idempotente — si ya estaba
   * marcado, conserva la fecha original.
   */
  async completeOnboarding(userId: string): Promise<UserView> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    });
    if (user?.onboardingCompletedAt) {
      return this.getProfile(userId);
    }
    const updated = await this.prisma.raw.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date() },
    });
    return toUserView(updated);
  }

  /**
   * Cambio de contraseña con sesión activa. Fija `passwordChangedAt`, con lo
   * que TODOS los JWT anteriores dejan de valer (ver `JwtAuthGuard`), y emite
   * uno nuevo para no cortar la sesión desde la que se cambió.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión inválida');
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      // 400 y no 401: el panel cierra sesión ante un 401, y equivocarse al
      // escribir la contraseña actual no debe expulsar a nadie.
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
    return { accessToken: await this.issueToken(user.id, user.email) };
  }

  /**
   * Manda el enlace de recuperación. Responde igual exista o no la cuenta:
   * el formulario no puede servir para averiguar qué emails están registrados.
   * Solo se guarda el hash del token; el token en claro va en el correo.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.raw.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return;
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    const link = `${this.panelUrl}/reset-password?token=${token}`;
    await this.platformEmail.send({
      to: user.email,
      subject: 'Recuperar tu contraseña — Agentes Lead',
      text:
        `Hola${user.name ? ` ${user.name}` : ''},\n\n` +
        'Pediste recuperar la contraseña de tu cuenta en Agentes Lead. ' +
        'Entra a este enlace para elegir una nueva (vale por 1 hora):\n\n' +
        `${link}\n\n` +
        'Si no fuiste tú, ignora este correo: tu contraseña no cambia.',
    });
  }

  /** Fija la contraseña nueva con el token del enlace y lo consume. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.prisma.raw.user.findFirst({
      where: { passwordResetTokenHash: hashToken(token) },
    });
    if (
      !user ||
      !user.isActive ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'El enlace no es válido o ya venció. Pide uno nuevo.',
      );
    }
    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
  }

  /** Devuelve las empresas a las que un usuario tiene acceso, con su rol. */
  async getMemberships(userId: string): Promise<MembershipView[]> {
    const memberships = await this.prisma.raw.membership.findMany({
      where: { userId },
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      role: m.role,
    }));
  }

  /** Devuelve el rol del usuario en una empresa, o null si no tiene acceso. */
  async roleFor(userId: string, companyId: string): Promise<PanelRole | null> {
    const membership = await this.prisma.raw.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    return membership?.role ?? null;
  }

  private issueToken(userId: string, email: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, email });
  }
}

/** SHA-256 hex del token de recuperación: es lo único que se guarda. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Proyecta la fila de usuario a lo que ve el panel (sin hashes ni tokens). */
function toUserView(user: {
  id: string;
  email: string;
  name: string | null;
  onboardingCompletedAt: Date | null;
  isPlatformAdmin: boolean;
}): UserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    onboardingCompletedAt: user.onboardingCompletedAt,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
