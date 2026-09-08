import createClient, { type Client, type Middleware } from 'openapi-fetch';

import type { paths } from '@reup-dubbing-studio/api-contract/web';

export type WebClientMiddleware = Middleware;

export function createWebClient(
  baseUrl: string,
  middleware: readonly WebClientMiddleware[] = [],
): Client<paths> {
  const client = createClient<paths>({ baseUrl });
  for (const item of middleware) client.use(item);
  return client;
}
