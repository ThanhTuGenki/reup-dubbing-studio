import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { PrismaProfileRepository } from '../profiles/infrastructure/prisma-profile-repository';
import { IngestService } from './application/ingest.service';
import { IngestController } from './http/web/ingest.controller';
import { PrismaIngestRepository } from './infrastructure/prisma-ingest-repository';

@Module({})
export class IngestModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule {
    return {
      module: IngestModule,
      controllers: [IngestController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        {
          provide: PrismaProfileRepository,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => new PrismaProfileRepository(prisma),
        },
        {
          provide: PrismaIngestRepository,
          inject: [PrismaService, PrismaProfileRepository],
          useFactory: (prisma: PrismaService, profiles: PrismaProfileRepository) => new PrismaIngestRepository(prisma, profiles),
        },
        {
          provide: IngestService,
          inject: [PrismaIngestRepository],
          useFactory: (repository: PrismaIngestRepository) => new IngestService(repository),
        },
      ],
    };
  }
}
