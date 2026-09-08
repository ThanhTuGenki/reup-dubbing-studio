import type { IncomingMessage } from 'node:http';

import { getRequestContext } from './context/request-context';

type RequestWithUrl = Pick<IncomingMessage, 'method' | 'headers'> & { url?: string };

const REDACTED = '[Redacted]';
const sensitiveKeyPattern = /token|secret|apikey|password/i;

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>());
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    if (/^https?:\/\/[^?]+\?/.test(value)) return `${value.split('?')[0]}?[Redacted]`;
    return value;
  }
  if (value instanceof URL) {
    const url = value.toString();
    return url.includes('?') ? `${url.split('?')[0]}?[Redacted]` : url;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (value instanceof Error) {
      const copy = Object.create(Object.getPrototypeOf(value)) as Error;
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        if ('value' in descriptor) {
          descriptor.value = sensitiveKeyPattern.test(key)
            ? REDACTED
            : sanitizeValue(descriptor.value, seen);
        }
        Object.defineProperty(copy, key, descriptor);
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKeyPattern.test(key) ? REDACTED : sanitizeValue(item, seen),
      ]),
    );
  }
  return value;
}

export function redactRequest(request: RequestWithUrl): Record<string, unknown> {
  const url = request.url ?? '';
  const queryStart = url.indexOf('?');
  const safeUrl = queryStart === -1 ? url : `${url.slice(0, queryStart)}?[Redacted]`;
  const headers = request.headers;
  return {
    method: request.method,
    url: safeUrl,
    ...(headers?.authorization || headers?.cookie
      ? {
          headers: {
            ...(headers.authorization ? { authorization: REDACTED } : {}),
            ...(headers.cookie ? { cookie: REDACTED } : {}),
          },
        }
      : {}),
  };
}

export function loggingOptions() {
  const production = process.env.NODE_ENV === 'production';
  const pinoHttp = {
    level: process.env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    ...(production
      ? { stream: process.stdout }
      : { transport: { target: 'pino-pretty', options: { colorize: false, singleLine: true } } }),
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: REDACTED,
    },
    serializers: { req: redactRequest },
    formatters: {
      bindings: (bindings: Record<string, unknown>) =>
        sanitizeLogValue(bindings) as Record<string, unknown>,
      log: (object: Record<string, unknown>) => sanitizeLogValue(object) as Record<string, unknown>,
    },
    mixin: () => getRequestContext() ?? {},
    mixinMergeStrategy: (mergeObject: object, mixinObject: object) =>
      sanitizeLogValue({ ...mergeObject, ...mixinObject }) as Record<string, unknown>,
    hooks: {
      logMethod(inputArgs: unknown[], method: (...args: unknown[]) => void): void {
        if (inputArgs[0] && typeof inputArgs[0] === 'object') {
          inputArgs[0] = sanitizeLogValue(inputArgs[0]);
        }
        method.apply(this, inputArgs);
      },
      streamWrite(line: string): string {
        try {
          return `${JSON.stringify(sanitizeLogValue(JSON.parse(line)))}\n`;
        } catch {
          return line;
        }
      },
    },
  };

  return {
    pinoHttp,
  };
}
