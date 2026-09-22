import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { AesGcmCredentialCipher } from '../settings';
import { R2LibraryObjectStore } from '../library/infrastructure/r2-library-object-store';
import { PublishingService } from './application/publishing.service';
import { PublishingController } from './http/web/publishing.controller';
import { PrismaPublishingRepository } from './infrastructure/prisma-publishing-repository';

@Module({})
export class PublishingModule {
  static register(config: Pick<AppConfig, 'databaseUrl'|'settingsEncryptionKey'>): DynamicModule {
    return { module: PublishingModule, controllers: [PublishingController], providers: [
      { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
      { provide: PrismaPublishingRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaPublishingRepository(prisma) },
      { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) },
      { provide: R2LibraryObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2LibraryObjectStore(prisma, cipher) },
      { provide: PublishingService, inject: [PrismaPublishingRepository, R2LibraryObjectStore], useFactory: (repository: PrismaPublishingRepository, objects: R2LibraryObjectStore) => new PublishingService(repository, objects) },
    ] }; 
  }
}
