import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { PrismaProfileRepository } from '../profiles/infrastructure/prisma-profile-repository';
import { AesGcmCredentialCipher } from '../settings';
import { LocalImportsService } from './application/local-imports.service';
import { LocalImportsController } from './http/web/local-imports.controller';
import { PrismaLocalImportRepository } from './infrastructure/prisma-local-import-repository';
import { R2LocalImportObjectStore } from './infrastructure/r2-local-import-object-store';

@Module({})
export class LocalImportsModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule {
    return {
      module: LocalImportsModule,
      controllers: [LocalImportsController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        { provide: PrismaProfileRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaProfileRepository(prisma) },
        { provide: PrismaLocalImportRepository, inject: [PrismaService, PrismaProfileRepository], useFactory: (prisma: PrismaService, profiles: PrismaProfileRepository) => new PrismaLocalImportRepository(prisma, profiles) },
        { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) },
        { provide: R2LocalImportObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2LocalImportObjectStore(prisma, cipher) },
        { provide: LocalImportsService, inject: [PrismaLocalImportRepository, R2LocalImportObjectStore], useFactory: (repository: PrismaLocalImportRepository, objects: R2LocalImportObjectStore) => new LocalImportsService(repository, objects) },
      ],
    };
  }
}
