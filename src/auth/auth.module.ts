import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { CommonModule } from '../common/common.module';
import { CompaniesModule } from '../companies/companies.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CompanyGuard } from './guards/company.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Auth del panel (JWT + memberships/roles). Global para que el resto de la app
 * pueda usar los guards por DI.
 */
@Global()
@Module({
  imports: [
    CommonModule,
    CompaniesModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, CompanyGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, CompanyGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
