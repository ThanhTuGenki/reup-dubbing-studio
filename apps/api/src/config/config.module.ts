import { Global, Inject, Module, Provider } from '@nestjs/common';

import { parseEnv } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider: Provider = {
  provide: APP_CONFIG,
  useFactory: () => parseEnv(),
};

export const InjectAppConfig = () => Inject(APP_CONFIG);

@Global()
@Module({
  providers: [appConfigProvider],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
