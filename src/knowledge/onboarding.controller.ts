import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { OnboardingService } from './onboarding.service';
import { OnboardingDto } from './dto/onboarding.dto';

/**
 * Onboarding de conocimiento: recibe el cuestionario de la empresa y lo
 * convierte en hechos estructurados + documentos indexados.
 */
@Controller('onboarding')
@UseGuards(CompanyAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post()
  run(@Body() dto: OnboardingDto) {
    return this.onboarding.run(dto);
  }
}
