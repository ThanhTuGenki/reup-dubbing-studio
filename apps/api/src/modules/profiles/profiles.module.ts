import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { ProfilesService } from './application/profiles.service';
import { ProfileAssetsService } from './application/profile-assets.service';
import { ProfilesController } from './http/web/profiles.controller';
import { PrismaProfileRepository } from './infrastructure/prisma-profile-repository';
import { PrismaProfileAssetRepository } from './infrastructure/prisma-profile-asset-repository';
import { R2ProfileObjectStore } from './infrastructure/r2-profile-object-store';
import { AesGcmCredentialCipher } from '../settings';

@Module({})
export class ProfilesModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule {
    return {
      module: ProfilesModule,
      controllers: [ProfilesController],
      exports: [ProfilesService, PrismaProfileRepository],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        {
          provide: PrismaProfileRepository,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => new PrismaProfileRepository(prisma),
        },
        {
          provide: PrismaProfileAssetRepository,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => new PrismaProfileAssetRepository(prisma),
        },
        {
          provide: AesGcmCredentialCipher,
          useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey),
        },
        {
          provide: R2ProfileObjectStore,
          inject: [PrismaService, AesGcmCredentialCipher],
          useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2ProfileObjectStore(prisma, cipher),
        },
        {
          provide: ProfilesService,
          inject: [PrismaProfileRepository],
          useFactory: (repository: PrismaProfileRepository) => new ProfilesService(repository),
        },
        {
          provide: ProfileAssetsService,
          inject: [PrismaProfileAssetRepository, R2ProfileObjectStore],
          useFactory: (repository: PrismaProfileAssetRepository, objectStore: R2ProfileObjectStore) => new ProfileAssetsService(repository, objectStore),
        },
      ],
    };
  }
}
