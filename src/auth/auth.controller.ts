import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { TenantContext } from '../common/tenant/tenant-context';

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
  registerCompany(@Body() dto: RegisterCompanyDto) {
    return this.auth.registerCompany(dto);
  }

  /** Login: devuelve el JWT y las empresas a las que el usuario tiene acceso. */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** Datos del usuario + membresías (para el selector de empresa del panel). */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return {
      user,
      memberships: await this.auth.getMemberships(user.userId),
    };
  }
}
