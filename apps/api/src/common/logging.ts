import type { IncomingMessage } from 'node:http';

import { getRequestContext } from './context/request-context';

type RequestWithUrl = IncomingMessage & { url?: string };

function redactUrl(request: RequestWithUrl): Record<string, unknown> {
  const url = request.url ?? '';
  const queryStart = url.indexOf('?');
  const safeUrl = queryStart === -1 ? url : `${url.slice(0, queryStart)}?[Redacted]`;
  return { method: request.method, url: safeUrl };
}

export function loggingOptions() {
  const production = process.env.NODE_ENV === 'production';
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
      transport: production
        ? undefined
        : { target: 'pino-pretty', options: { colorize: false, singleLine: true } },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '**.token',
          '**.Token',
          '**.secret',
          '**.Secret',
          '**.apiKey',
          '**.ApiKey',
          '**.password',
          '**.Password',
        ],
        censor: '[Redacted]',
      },
      serializers: { req: redactUrl },
      mixin: () => getRequestContext() ?? {},
    },
  };
}
