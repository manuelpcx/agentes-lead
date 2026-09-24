import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { TenantContext } from '../common/tenant/tenant-context';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Alta de un usuario del panel para la empresa autenticada por HMAC
   * (bootstrap del primer usuario con el secreto de la empresa).
   */
  @Post('users')
  @UseGuards(CompanyAuthGuard)
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto, TenantContext.requireCompanyId());
  }

  /** Registro autoservicio de empresa + usuario OWNER (público). */
  @Post('register-company')
  @RateLimit({ limit: 5, windowSec: 3600 })
  registerCompany(@Body() dto: RegisterCompanyDto) {
    return this.auth.registerCompany(dto);
  }

  /** Login: devuelve el JWT y las empresas a las que el usuario tiene acceso. */
  @Post('login')
  // Frena la fuerza bruta: bcrypt encarece cada intento, esto los acota.
  @RateLimit({ limit: 10, windowSec: 60 })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** Datos del usuario + membresías (para el selector de empresa del panel). */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return {
      user: await this.auth.getProfile(user.userId),
      memberships: await this.auth.getMemberships(user.userId),
    };
  }

  /**
   * Marca el tour de bienvenida como visto. Lo llama el panel tanto al
   * terminarlo como al saltarlo.
   */
  @Post('onboarding-complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  completeOnboarding(@CurrentUser() user: AuthUser) {
    return this.auth.completeOnboarding(user.userId);
  }

  /** Cambio de contraseña con sesión. Devuelve un JWT nuevo (los viejos caducan). */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @RateLimit({ limit: 10, windowSec: 60, scope: 'auth' })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  /** Manda el enlace de recuperación. Siempre 200, exista o no el email. */
  @Post('forgot-password')
  @RateLimit({ limit: 5, windowSec: 3600 })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { ok: true };
  }

  /** Fija la contraseña nueva con el token del enlace. */
  @Post('reset-password')
  @RateLimit({ limit: 10, windowSec: 60 })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }
}
