import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { DiscoveryService, UnavailableDouyinDiscoveryProvider } from './application/discovery.service';
import { DiscoveryRunner } from './application/discovery-runner';
import { DiscoveryController } from './http/web/discovery.controller';
import { PrismaDiscoveryRepository } from './infrastructure/prisma-discovery-repository';
import { AesGcmSourceCredentialCipher } from './infrastructure/source-credential-cipher';

@Module({})
export class DiscoveryModule {
  static register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey'>): DynamicModule {
    return { module: DiscoveryModule, controllers: [DiscoveryController], providers: [
      { provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) },
      { provide: PrismaDiscoveryRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaDiscoveryRepository(prisma) },
      { provide: AesGcmSourceCredentialCipher, useFactory: () => new AesGcmSourceCredentialCipher(config.settingsEncryptionKey) },
      UnavailableDouyinDiscoveryProvider,
      { provide: DiscoveryRunner, inject: [PrismaDiscoveryRepository, AesGcmSourceCredentialCipher, UnavailableDouyinDiscoveryProvider], useFactory: (repository: PrismaDiscoveryRepository, cipher: AesGcmSourceCredentialCipher, provider: UnavailableDouyinDiscoveryProvider) => new DiscoveryRunner(repository, cipher, provider) },
      { provide: DiscoveryService, inject: [PrismaDiscoveryRepository, AesGcmSourceCredentialCipher, UnavailableDouyinDiscoveryProvider, DiscoveryRunner], useFactory: (repository: PrismaDiscoveryRepository, cipher: AesGcmSourceCredentialCipher, provider: UnavailableDouyinDiscoveryProvider, runner: DiscoveryRunner) => new DiscoveryService(repository, cipher, provider, runner) },
    ] };
  }
}
