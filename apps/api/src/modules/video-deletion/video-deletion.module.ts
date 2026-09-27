import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { AesGcmCredentialCipher } from '../settings';
import { VideoDeletionRunner } from './application/video-deletion-runner';
import { VideoDeletionService } from './application/video-deletion.service';
import { VideoDeletionController } from './http/web/video-deletion.controller';
import { PrismaVideoDeletionRepository } from './infrastructure/prisma-video-deletion-repository';
import { R2VideoDeletionObjectStore } from './infrastructure/r2-video-deletion-object-store';

@Module({})
export class VideoDeletionModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey' | 'nodeEnv'>): DynamicModule {
    return {
      module: VideoDeletionModule,
      controllers: [VideoDeletionController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        { provide: PrismaVideoDeletionRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaVideoDeletionRepository(prisma) },
        { provide: VideoDeletionService, inject: [PrismaVideoDeletionRepository], useFactory: (repository: PrismaVideoDeletionRepository) => new VideoDeletionService(repository) },
        { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) },
        { provide: R2VideoDeletionObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2VideoDeletionObjectStore(prisma, cipher) },
        { provide: VideoDeletionRunner, inject: [PrismaVideoDeletionRepository, R2VideoDeletionObjectStore], useFactory: (repository: PrismaVideoDeletionRepository, objects: R2VideoDeletionObjectStore) => new VideoDeletionRunner(repository, objects, config.nodeEnv !== 'test') },
      ],
    };
  }
}
