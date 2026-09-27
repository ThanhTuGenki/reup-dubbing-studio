import { parseConfig } from '../../src/platform/config/config';

const validEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  PORT: '3000',
  LOG_LEVEL: 'info',
  CORS_ORIGINS: 'http://localhost:5173',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW_MS: '60000',
  HEALTH_RATE_LIMIT_MAX: '10',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  SETTINGS_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  TRUST_PROXY: 'false',
  ...overrides,
});

describe('runtime configuration', () => {
  it.each([
    ['NODE_ENV', { NODE_ENV: 'staging' }],
    ['PORT', { PORT: '0' }],
    ['PORT', { PORT: '1.5' }],
    ['LOG_LEVEL', { LOG_LEVEL: 'verbose' }],
    ['RATE_LIMIT_MAX', { RATE_LIMIT_MAX: '-1' }],
    ['RATE_LIMIT_MAX', { RATE_LIMIT_MAX: '1.5' }],
    ['RATE_LIMIT_WINDOW_MS', { RATE_LIMIT_WINDOW_MS: 'not-a-number' }],
    ['RATE_LIMIT_WINDOW_MS', { RATE_LIMIT_WINDOW_MS: '1.5' }],
    ['HEALTH_RATE_LIMIT_MAX', { HEALTH_RATE_LIMIT_MAX: '0' }],
    ['HEALTH_RATE_LIMIT_MAX', { HEALTH_RATE_LIMIT_MAX: '1.5' }],
  ])('rejects invalid %s before the server can listen', (_field, override) => {
    expect(() => parseConfig(validEnvironment(override))).toThrow();
  });

  it.each(['NODE_ENV', 'PORT', 'LOG_LEVEL', 'CORS_ORIGINS', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS', 'HEALTH_RATE_LIMIT_MAX', 'DATABASE_URL', 'SETTINGS_ENCRYPTION_KEY'])(
    'rejects a missing required %s', (field) => {
      const environment = validEnvironment();
      delete environment[field];
      expect(() => parseConfig(environment)).toThrow();
    },
  );

  it('returns typed values instead of raw environment strings', () => {
    expect(parseConfig(validEnvironment({ PORT: '4310', RATE_LIMIT_MAX: '25' }))).toMatchObject({
      nodeEnv: 'development', port: 4310, logLevel: 'info',
      corsOrigins: ['http://localhost:5173'], rateLimitMax: 25,
      rateLimitWindowMs: 60000, healthRateLimitMax: 10, trustProxy: false,
    });
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: 'https://example.test/database' }],
    ['SETTINGS_ENCRYPTION_KEY', { SETTINGS_ENCRYPTION_KEY: 'too-short' }],
  ])('rejects invalid secret-backed %s', (_field, override) => {
    expect(() => parseConfig(validEnvironment(override))).toThrow();
  });

  it('defaults Content Agent endpoints to the official provider APIs', () => {
    expect(parseConfig(validEnvironment()).contentAgentBaseUrls).toEqual({
      anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com',
    });
  });

  it('accepts Content Agent base URL overrides such as a local proxy', () => {
    expect(parseConfig(validEnvironment({
      CONTENT_AGENT_ANTHROPIC_BASE_URL: 'http://host.docker.internal:8317/',
      CONTENT_AGENT_OPENAI_BASE_URL: 'https://proxy.example.test/openai',
    })).contentAgentBaseUrls).toEqual({
      anthropic: 'http://host.docker.internal:8317', openai: 'https://proxy.example.test/openai',
    });
  });

  it.each([
    { CONTENT_AGENT_ANTHROPIC_BASE_URL: 'ftp://proxy.example.test' },
    { CONTENT_AGENT_OPENAI_BASE_URL: 'https://user:pass@proxy.example.test' },
    { CONTENT_AGENT_OPENAI_BASE_URL: 'https://proxy.example.test/?key=1' },
    { CONTENT_AGENT_ANTHROPIC_BASE_URL: 'not a url' },
  ])('rejects an unsafe Content Agent base URL %p', (override) => {
    expect(() => parseConfig(validEnvironment(override))).toThrow('CONTENT_AGENT');
  });

  it('only permits the Vite origin in local development', () => {
    expect(() => parseConfig(validEnvironment({ CORS_ORIGINS: 'http://example.test' }))).toThrow();
    expect(parseConfig(validEnvironment({ CORS_ORIGINS: 'http://localhost:5173' }))).toMatchObject({
      corsOrigins: ['http://localhost:5173'],
    });
  });

  it.each([
    ['an empty allowlist', ''], ['a wildcard allowlist', '*'],
    ['a wildcard among origins', 'https://studio.example, *'],
  ])('rejects %s in production', (_description, corsOrigins) => {
    expect(() => parseConfig(validEnvironment({ NODE_ENV: 'production', CORS_ORIGINS: corsOrigins }))).toThrow();
  });

  it('accepts an explicit production CORS allowlist', () => {
    expect(parseConfig(validEnvironment({ NODE_ENV: 'production', CORS_ORIGINS: 'https://studio.example,https://admin.example' }))).toMatchObject({
      nodeEnv: 'production', corsOrigins: ['https://studio.example', 'https://admin.example'],
    });
  });

  it.each(['true', '*', '0.0.0.0/0'])('rejects overly broad TRUST_PROXY value %s', (trustProxy) => {
    expect(() => parseConfig(validEnvironment({ TRUST_PROXY: trustProxy }))).toThrow();
  });

  it.each(['not-an-ip-or-cidr', 'https://proxy.example'])('rejects invalid TRUST_PROXY value %s', (trustProxy) => {
    expect(() => parseConfig(validEnvironment({ TRUST_PROXY: trustProxy }))).toThrow();
  });

  it('disables trust proxy by default when TRUST_PROXY is omitted', () => {
    const environment = validEnvironment(); delete environment.TRUST_PROXY;
    expect(parseConfig(environment)).toMatchObject({ trustProxy: false });
  });

  it('allows explicit trusted proxy addresses', () => {
    expect(parseConfig(validEnvironment({ TRUST_PROXY: '10.0.0.1, 10.0.0.0/24' }))).toMatchObject({
      trustProxy: ['10.0.0.1', '10.0.0.0/24'],
    });
  });

  it('does not expose secret values in validation errors', () => {
    const secret = 'cors-secret-sentinel';
    let errorMessage: string | undefined;
    try {
      parseConfig(validEnvironment({ NODE_ENV: 'production', CORS_ORIGINS: `not-an-origin-${secret}` }));
    } catch (error) {
      errorMessage = String(error);
    }
    expect(errorMessage).toBeDefined();
    expect(errorMessage).not.toContain(secret);
  });
});
