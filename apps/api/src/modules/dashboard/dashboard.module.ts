import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { DashboardService } from './application/dashboard.service';
import { DashboardController } from './http/web/dashboard.controller';
import { PrismaDashboardRepository } from './infrastructure/prisma-dashboard-repository';

@Module({})
export class DashboardModule {
  static register(config: Pick<AppConfig, 'databaseUrl'>): DynamicModule {
    return {
      module: DashboardModule,
      controllers: [DashboardController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        { provide: PrismaDashboardRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaDashboardRepository(prisma) },
        { provide: DashboardService, inject: [PrismaDashboardRepository], useFactory: (repository: PrismaDashboardRepository) => new DashboardService(repository) },
      ],
    };
  }
}
