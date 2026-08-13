import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Company, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AgentsService } from '../agents/agents.service';
import { CreateCompanyDto } from './dto/create-company.dto';

/** Resultado de crear una empresa: la fila + el secreto en claro (una vez). */
export interface CreatedCompany {
  company: Company;
  /**
   * Secreto para firmar los webhooks. Se devuelve SOLO al crear la empresa;
   * en la BD queda cifrado y no vuelve a exponerse.
   */
  webhookSecret: string;
}

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly agents: AgentsService,
  ) {}

  /**
   * Crea la empresa y su agente por defecto (VENTAS) de forma atómica, y
   * genera un `webhookSecret` cifrado en reposo. Devuelve el secreto en claro
   * una única vez.
   */
  async create(dto: CreateCompanyDto): Promise<CreatedCompany> {
    const webhookSecret = randomBytes(32).toString('hex');
    const encryptedSecret = this.crypto.encrypt(webhookSecret);

    const company = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: dto.name,
          rut: dto.rut,
          timezone: dto.timezone ?? 'America/Santiago',
          businessHours: (dto.businessHours ?? {}) as Prisma.InputJsonValue,
          channelsConfig: (dto.channelsConfig ?? {}) as Prisma.InputJsonValue,
          webhookSecret: encryptedSecret,
        },
      });

      await this.agents.createDefaultAgent(created.id, tx);
      return created;
    });

    this.logger.log(
      `Empresa creada con agente por defecto: ${company.name} (companyId=${company.id})`,
    );

    return { company, webhookSecret };
  }

  /** Devuelve una empresa por id (sin exponer el secreto). */
  async findById(id: string): Promise<Company | null> {
    return this.prisma.raw.company.findUnique({ where: { id } });
  }
}
