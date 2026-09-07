import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../infra/prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @HttpCode(200)
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
