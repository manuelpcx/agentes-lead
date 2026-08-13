import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PanelRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';

/** Membresía expuesta al panel (empresa + rol). */
export interface MembershipView {
  companyId: string;
  companyName: string;
  role: PanelRole;
}

export interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; name: string | null };
  memberships: MembershipView[];
}

/**
 * Auth del panel: usuarios (auth-plane, transversal a empresas), membresías con
 * rol y emisión de JWT. Usa el cliente crudo (User/Membership no son
 * tenant-scoped).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly companies: CompaniesService,
  ) {}

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
    const passwordHash = await bcrypt.hash(dto.password, 10);
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
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });
    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name },
      memberships: await this.getMemberships(user.id),
    };
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
}
