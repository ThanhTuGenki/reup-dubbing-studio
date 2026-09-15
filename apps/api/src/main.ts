import 'reflect-metadata';

import { createApplication } from './application';
import { parseConfig } from './platform/config/config';

async function bootstrap(): Promise<void> {
  // Configuration is parsed before the application is created or a port is opened.
  const config = parseConfig(process.env);
  const app = await createApplication(config);
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap().catch(() => {
  // Keep startup errors safe: invalid values and credentials must never be echoed.
  process.stderr.write('API startup failed\n');
  process.exitCode = 1;
});
