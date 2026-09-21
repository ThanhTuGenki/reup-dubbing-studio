import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { StudioController } from './http/web/studio.controller';
import { PrismaStudioRepository } from './infrastructure/prisma-studio-repository';
import { R2StudioObjectStore } from './infrastructure/r2-studio-object-store';
import { StudioService } from './application/studio.service';
import { AesGcmCredentialCipher } from '../settings';
@Module({})
export class StudioModule { static register(config: Pick<AppConfig, 'databaseUrl'|'settingsEncryptionKey'>): DynamicModule { return { module: StudioModule, controllers: [StudioController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: PrismaStudioRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaStudioRepository(prisma) }, { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) }, { provide: R2StudioObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2StudioObjectStore(prisma, cipher) }, { provide: StudioService, inject: [PrismaStudioRepository, R2StudioObjectStore], useFactory: (repository: PrismaStudioRepository, objects: R2StudioObjectStore) => new StudioService(repository, objects) }] }; } }
