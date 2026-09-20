import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { AesGcmCredentialCipher } from '../settings';
import { R2ProfileObjectStore } from '../profiles/infrastructure/r2-profile-object-store';
import { VoicesService } from './application/voices.service';
import { VoiceSamplesService } from './application/voice-samples.service';
import { VoicesController } from './http/web/voices.controller';
import { PrismaVoiceRepository } from './infrastructure/prisma-voice-repository';
import { PrismaVoiceSampleRepository } from './infrastructure/prisma-voice-sample-repository';
@Module({})
export class VoicesModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule {
    return { module: VoicesModule, controllers: [VoicesController], providers: [
      { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
      { provide: PrismaVoiceRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaVoiceRepository(prisma) },
      { provide: PrismaVoiceSampleRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaVoiceSampleRepository(prisma) },
      { provide: AesGcmCredentialCipher, useFactory: () => new AesGcmCredentialCipher(config.settingsEncryptionKey) },
      { provide: R2ProfileObjectStore, inject: [PrismaService, AesGcmCredentialCipher], useFactory: (prisma: PrismaService, cipher: AesGcmCredentialCipher) => new R2ProfileObjectStore(prisma, cipher) },
      { provide: VoicesService, inject: [PrismaVoiceRepository], useFactory: (repo: PrismaVoiceRepository) => new VoicesService(repo) },
      { provide: VoiceSamplesService, inject: [PrismaVoiceSampleRepository, R2ProfileObjectStore], useFactory: (repo: PrismaVoiceSampleRepository, store: R2ProfileObjectStore) => new VoiceSamplesService(repo, store) },
    ] };
  }
}
