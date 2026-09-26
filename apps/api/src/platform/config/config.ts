import { isIP } from 'node:net';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  logLevel: LogLevel;
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  healthRateLimitMax: number;
  trustProxy: false | string[];
  databaseUrl: string;
  settingsEncryptionKey: string;
  /** Omitted means the official provider APIs. */
  contentAgentBaseUrls?: ContentAgentBaseUrls;
}

/** Provider API roots; overridable so a compatible proxy (e.g. a local CLI proxy) can serve them. */
export interface ContentAgentBaseUrls { anthropic: string; openai: string }
export const DEFAULT_CONTENT_AGENT_BASE_URLS: ContentAgentBaseUrls = {
  anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com',
};

export function contentAgentEndpoint(provider: 'ANTHROPIC' | 'OPENAI', baseUrls: ContentAgentBaseUrls): string {
  return provider === 'ANTHROPIC' ? `${baseUrls.anthropic}/v1/messages` : `${baseUrls.openai}/v1/responses`;
}

const required = ['NODE_ENV', 'PORT', 'LOG_LEVEL', 'CORS_ORIGINS', 'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_MS', 'HEALTH_RATE_LIMIT_MAX', 'DATABASE_URL', 'SETTINGS_ENCRYPTION_KEY'] as const;
const allowedEnvironments = new Set<NodeEnvironment>(['development', 'test', 'production']);
const allowedLogLevels = new Set<LogLevel>(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

/** Parse and validate all runtime configuration once, before the HTTP server listens. */
export function parseConfig(environment: NodeJS.ProcessEnv): AppConfig {
  for (const field of required) {
    if (!environment[field]?.trim()) throw new Error(`Invalid runtime configuration: ${field} is required`);
  }

  const nodeEnv = environment.NODE_ENV as NodeEnvironment;
  if (!allowedEnvironments.has(nodeEnv)) throw new Error('Invalid runtime configuration: NODE_ENV');
  const logLevel = environment.LOG_LEVEL as LogLevel;
  if (!allowedLogLevels.has(logLevel)) throw new Error('Invalid runtime configuration: LOG_LEVEL');

  const port = positiveInteger(environment.PORT, 'PORT', 65535);
  const rateLimitMax = positiveInteger(environment.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX');
  const rateLimitWindowMs = positiveInteger(environment.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS');
  const healthRateLimitMax = positiveInteger(environment.HEALTH_RATE_LIMIT_MAX, 'HEALTH_RATE_LIMIT_MAX');
  const corsOrigins = parseOrigins(environment.CORS_ORIGINS, nodeEnv);
  validateDatabaseUrl(environment.DATABASE_URL);
  validateEncryptionKey(environment.SETTINGS_ENCRYPTION_KEY);

  return {
    nodeEnv, port, logLevel, corsOrigins, rateLimitMax, rateLimitWindowMs,
    healthRateLimitMax, trustProxy: parseTrustProxy(environment.TRUST_PROXY),
    databaseUrl: environment.DATABASE_URL!,
    settingsEncryptionKey: environment.SETTINGS_ENCRYPTION_KEY!,
    contentAgentBaseUrls: {
      anthropic: parseBaseUrl(environment.CONTENT_AGENT_ANTHROPIC_BASE_URL, DEFAULT_CONTENT_AGENT_BASE_URLS.anthropic, 'CONTENT_AGENT_ANTHROPIC_BASE_URL'),
      openai: parseBaseUrl(environment.CONTENT_AGENT_OPENAI_BASE_URL, DEFAULT_CONTENT_AGENT_BASE_URLS.openai, 'CONTENT_AGENT_OPENAI_BASE_URL'),
    },
  };
}

function parseBaseUrl(value: string | undefined, fallback: string, field: string): string {
  if (!value?.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/u, '');
  } catch {
    throw new Error(`Invalid runtime configuration: ${field}`);
  }
}

function validateDatabaseUrl(value: string | undefined): void {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error();
  } catch {
    throw new Error('Invalid runtime configuration: DATABASE_URL');
  }
}

function validateEncryptionKey(value: string | undefined): void {
  if (!value || Buffer.from(value, 'base64').byteLength !== 32) {
    throw new Error('Invalid runtime configuration: SETTINGS_ENCRYPTION_KEY');
  }
}

function positiveInteger(value: string | undefined, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!value || !/^\d+$/u.test(value)) throw new Error(`Invalid runtime configuration: ${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Invalid runtime configuration: ${field}`);
  return parsed;
}

function parseOrigins(value: string | undefined, environment: NodeEnvironment): string[] {
  const origins = value?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (origins.length === 0 || origins.includes('*') || origins.some((origin) => !isOrigin(origin))) {
    throw new Error('Invalid runtime configuration: CORS_ORIGINS');
  }
  if (environment !== 'production' && (origins.length !== 1 || origins[0] !== 'http://localhost:5173')) {
    throw new Error('Invalid runtime configuration: CORS_ORIGINS');
  }
  return origins;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !url.username && !url.password && !url.pathname.replace('/', '')
      && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function parseTrustProxy(value: string | undefined): false | string[] {
  if (!value || value.trim() === 'false') return false;
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !isIpOrCidr(entry) || entry === '0.0.0.0/0' || entry === '::/0')) {
    throw new Error('Invalid runtime configuration: TRUST_PROXY');
  }
  return entries;
}

function isIpOrCidr(value: string): boolean {
  const [address, prefix] = value.split('/');
  if (!address || ![4, 6].includes(isIP(address))) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/u.test(prefix)) return false;
  const max = isIP(address) === 4 ? 32 : 128;
  return Number(prefix) >= 0 && Number(prefix) <= max;
}
