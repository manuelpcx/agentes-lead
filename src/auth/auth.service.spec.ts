import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService, hashToken } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { PlatformEmailService } from '../email/platform-email.service';

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  isActive: boolean;
  passwordChangedAt: Date | null;
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: Date | null;
  onboardingCompletedAt: Date | null;
  isPlatformAdmin: boolean;
}

function buildHarness(seed: UserRow[] = []) {
  const users = [...seed];
  const user = {
    findUnique: jest.fn(
      ({ where }: { where: { email?: string; id?: string } }) =>
        Promise.resolve(
          users.find(
            (u) =>
              (where.email && u.email === where.email) ||
              (where.id && u.id === where.id),
          ) ?? null,
        ),
    ),
    findFirst: jest.fn(
      ({ where }: { where: { passwordResetTokenHash: string } }) =>
        Promise.resolve(
          users.find(
            (u) => u.passwordResetTokenHash === where.passwordResetTokenHash,
          ) ?? null,
        ),
    ),
    upsert: jest.fn(({ create }: { create: { email: string } }) => {
      const row: UserRow = {
        id: 'user-nuevo',
        email: create.email,
        passwordHash: '',
        name: null,
        isActive: true,
        passwordChangedAt: null,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        onboardingCompletedAt: null,
        isPlatformAdmin: false,
      };
      users.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    ),
  };
  const membership = {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([
      {
        companyId: 'company-nueva',
        role: 'OWNER',
        company: { name: 'Demo SpA' },
      },
    ]),
  };
  const prisma = { raw: { user, membership } } as unknown as PrismaService;
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('jwt-token'),
  } as unknown as JwtService;
  const companies = {
    create: jest.fn().mockResolvedValue({
      company: { id: 'company-nueva', name: 'Demo SpA' },
      webhookSecret: 'secreto-en-claro',
    }),
  } as unknown as CompaniesService;
  const platformEmail = {
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as PlatformEmailService;
  const config = {
    get: jest.fn((key: string) =>
      key === 'CORS_ORIGIN' ? 'https://panel.demo.cl, https://otro' : undefined,
    ),
  } as unknown as ConfigService<never, true>;

  return {
    service: new AuthService(prisma, jwt, companies, platformEmail, config),
    users,
    user,
    membership,
    companies,
    platformEmail,
  };
}

const DTO = {
  companyName: 'Demo SpA',
  rut: '76.123.456-7',
  email: 'ana@demo.cl',
  password: 'contraseña-larga',
  name: 'Ana',
};

async function usuario(overrides: Partial<UserRow> = {}): Promise<UserRow> {
  return {
    id: 'user-1',
    email: 'ana@demo.cl',
    passwordHash: await bcrypt.hash('actual-123', 4),
    name: 'Ana',
    isActive: true,
    passwordChangedAt: null,
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null,
    onboardingCompletedAt: null,
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('AuthService.registerCompany', () => {
  it('con un email ya registrado responde 409 y NO crea la empresa', async () => {
    const { service, companies, membership } = buildHarness([await usuario()]);

    await expect(service.registerCompany(DTO)).rejects.toThrow(
      ConflictException,
    );
    expect(companies.create).not.toHaveBeenCalled();
    expect(membership.upsert).not.toHaveBeenCalled();
  });

  it('con un email nuevo crea empresa + OWNER y devuelve el JWT y el secreto', async () => {
    const { service, companies, user, membership } = buildHarness();
    // El upsert del harness no guarda hash: se simula que el login lo encuentra.
    const passwordHash = await bcrypt.hash(DTO.password, 4);
    user.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
      id: 'user-nuevo',
      email: DTO.email,
      passwordHash,
      name: null,
      isActive: true,
      passwordChangedAt: null,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      onboardingCompletedAt: null,
      isPlatformAdmin: false,
    });

    const result = await service.registerCompany(DTO);

    expect(companies.create).toHaveBeenCalledWith({
      name: DTO.companyName,
      rut: DTO.rut,
    });
    expect(membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          companyId: 'company-nueva',
          role: 'OWNER',
        }),
      }),
    );
    expect(result.accessToken).toBe('jwt-token');
    expect(result.webhookSecret).toBe('secreto-en-claro');
  });
});

describe('AuthService.changePassword', () => {
  it('con la contraseña actual correcta la reemplaza, marca el cambio y emite otro JWT', async () => {
    const { service, users } = buildHarness([await usuario()]);

    const result = await service.changePassword(
      'user-1',
      'actual-123',
      'nueva-456',
    );

    expect(result).toEqual({ accessToken: 'jwt-token' });
    expect(await bcrypt.compare('nueva-456', users[0].passwordHash)).toBe(true);
    expect(users[0].passwordChangedAt).toBeInstanceOf(Date);
  });

  it('rechaza si la contraseña actual no coincide, sin tocar nada', async () => {
    const { service, users } = buildHarness([await usuario()]);
    const antes = users[0].passwordHash;

    await expect(
      service.changePassword('user-1', 'equivocada', 'nueva-456'),
    ).rejects.toThrow(BadRequestException);
    expect(users[0].passwordHash).toBe(antes);
  });
});

describe('AuthService.requestPasswordReset', () => {
  it('guarda solo el hash del token y manda el enlace al panel', async () => {
    const { service, users, platformEmail } = buildHarness([await usuario()]);

    await service.requestPasswordReset('ana@demo.cl');

    const [message] = (platformEmail.send as jest.Mock).mock.calls[0];
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(
      message.text,
    )?.[1];
    expect(token).toBeDefined();
    expect(message.text).toContain(
      'https://panel.demo.cl/reset-password?token=',
    );
    // Lo guardado no es el token: es su huella.
    expect(users[0].passwordResetTokenHash).toBe(hashToken(token!));
    expect(users[0].passwordResetTokenHash).not.toBe(token);
    expect(users[0].passwordResetExpiresAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('con un email desconocido no manda nada y no falla (sin enumeración)', async () => {
    const { service, platformEmail } = buildHarness([await usuario()]);
    await expect(
      service.requestPasswordReset('nadie@demo.cl'),
    ).resolves.toBeUndefined();
    expect(platformEmail.send).not.toHaveBeenCalled();
  });
});

describe('AuthService.resetPassword', () => {
  it('con un token vigente fija la contraseña, lo consume y marca el cambio', async () => {
    const { service, users } = buildHarness([
      await usuario({
        passwordResetTokenHash: hashToken('token-valido-de-prueba'),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      }),
    ]);

    await service.resetPassword('token-valido-de-prueba', 'nueva-789');

    expect(await bcrypt.compare('nueva-789', users[0].passwordHash)).toBe(true);
    expect(users[0].passwordResetTokenHash).toBeNull();
    expect(users[0].passwordChangedAt).toBeInstanceOf(Date);
  });

  it('rechaza un token vencido o desconocido', async () => {
    const { service } = buildHarness([
      await usuario({
        passwordResetTokenHash: hashToken('token-vencido'),
        passwordResetExpiresAt: new Date(Date.now() - 1000),
      }),
    ]);
    await expect(
      service.resetPassword('token-vencido', 'nueva-789'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.resetPassword('token-inventado', 'nueva-789'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AuthService — tour de bienvenida', () => {
  it('un usuario que nunca lo vio queda en null', async () => {
    const { service } = buildHarness([await usuario()]);

    const perfil = await service.getProfile('user-1');

    expect(perfil.onboardingCompletedAt).toBeNull();
    expect(perfil).toEqual(
      expect.objectContaining({ id: 'user-1', email: 'ana@demo.cl' }),
    );
  });

  it('el perfil no expone el hash de la contraseña ni el token de recuperación', async () => {
    const { service } = buildHarness([
      await usuario({ passwordResetTokenHash: 'secreto' }),
    ]);

    const perfil = await service.getProfile('user-1');

    expect(Object.keys(perfil).sort()).toEqual([
      'email',
      'id',
      'isPlatformAdmin',
      'name',
      'onboardingCompletedAt',
    ]);
  });

  it('marcarlo guarda la fecha', async () => {
    const { service, users } = buildHarness([await usuario()]);

    const perfil = await service.completeOnboarding('user-1');

    expect(perfil.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(users[0].onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it('es idempotente: no pisa la fecha de quien ya lo hizo', async () => {
    const antes = new Date('2026-01-15T10:00:00.000Z');
    const { service, users } = buildHarness([
      await usuario({ onboardingCompletedAt: antes }),
    ]);

    const perfil = await service.completeOnboarding('user-1');

    expect(perfil.onboardingCompletedAt).toEqual(antes);
    expect(users[0].onboardingCompletedAt).toEqual(antes);
  });

  it('el login trae el estado del tour, para saber si mostrarlo', async () => {
    const { service } = buildHarness([await usuario()]);

    const { user } = await service.login('ana@demo.cl', 'actual-123');

    expect(user.onboardingCompletedAt).toBeNull();
  });
});
