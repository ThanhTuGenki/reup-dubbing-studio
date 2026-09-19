import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { SettingsService } from './application/settings.service';
import { SettingsController } from './http/web/settings.controller';
import { AesGcmCredentialCipher } from './infrastructure/aes-gcm-credential-cipher';
import { HttpContentAgentProbe } from './infrastructure/content-agent-probe';
import { PrismaSettingsRepository } from './infrastructure/prisma-settings-repository';
import { R2StorageProbe } from './infrastructure/r2-storage-probe';

@Module({})
export class SettingsModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule {
    return {
      module: SettingsModule,
      controllers: [SettingsController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
        {
          provide: PrismaSettingsRepository,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => new PrismaSettingsRepository(prisma),
        },
        {
          provide: AesGcmCredentialCipher,
          useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey),
        },
        HttpContentAgentProbe,
        R2StorageProbe,
        {
          provide: SettingsService,
          inject: [PrismaSettingsRepository, AesGcmCredentialCipher, HttpContentAgentProbe, R2StorageProbe],
          useFactory: (
            repository: PrismaSettingsRepository,
            cipher: AesGcmCredentialCipher,
            contentAgentProbe: HttpContentAgentProbe,
            storageProbe: R2StorageProbe,
          ) => new SettingsService(repository, cipher, contentAgentProbe, storageProbe),
        },
      ],
    };
  }
}
