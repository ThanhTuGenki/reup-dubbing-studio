import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { AesGcmCredentialCipher } from '../settings';
import { LibraryService } from './application/library.service';
import { LibraryController } from './http/web/library.controller';
import { PrismaLibraryRepository } from './infrastructure/prisma-library-repository';
import { R2LibraryObjectStore } from './infrastructure/r2-library-object-store';
@Module({})
export class LibraryModule { static register(config: Pick<AppConfig, 'databaseUrl'|'settingsEncryptionKey'>): DynamicModule { return { module: LibraryModule, controllers: [LibraryController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: PrismaLibraryRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaLibraryRepository(prisma) }, { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) }, { provide: R2LibraryObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2LibraryObjectStore(prisma, cipher) }, { provide: LibraryService, inject: [PrismaLibraryRepository, R2LibraryObjectStore], useFactory: (repo: PrismaLibraryRepository, objects: R2LibraryObjectStore) => new LibraryService(repo, objects) }] }; } }
