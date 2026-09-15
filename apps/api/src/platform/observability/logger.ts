import type { LoggerOptions } from 'pino';

import type { LogLevel, NodeEnvironment } from '../config/config';
import { redactLog } from './log-redaction';
import { currentRequestContext } from './request-context';

export function createLoggerOptions(
  nodeEnv: NodeEnvironment,
  level: LogLevel,
): LoggerOptions {
  return {
    level,
    base: null,
    mixin() {
      const context = currentRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
    hooks: {
      logMethod(args, method) {
        Reflect.apply(method, this, args.map((argument) => (
          typeof argument === 'object' && argument !== null ? redactLog(argument) : argument
        )));
      },
    },
    serializers: {
      req(request: { method?: string; url?: string; headers?: unknown }) {
        return redactLog({ method: request.method, url: request.url, headers: request.headers });
      },
    },
    ...(nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  };
}
