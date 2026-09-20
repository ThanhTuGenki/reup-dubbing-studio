import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { SettingsModule } from './modules/settings';
import { ProfilesModule } from './modules/profiles';
import { VoicesModule } from './modules/voices';
import { DiscoveryModule } from './modules/discovery';
import type { AppConfig } from './platform/config/config';
import { HealthModule } from './platform/health/health.module';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule, SettingsModule.register(config), ProfilesModule.register(config), VoicesModule.register(config), DiscoveryModule.register(config)],
    };
  }
}
