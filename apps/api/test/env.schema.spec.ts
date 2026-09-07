import { formatConfigError, parseEnv } from '../src/config/env.schema';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  LOG_LEVEL: 'info',
  CORS_ORIGINS: 'http://localhost:3001, https://example.test',
  SHUTDOWN_TIMEOUT_MS: '10000',
};

describe('environment schema', () => {
  it('returns a typed config', () => {
    expect(parseEnv(validEnv)).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: validEnv.DATABASE_URL,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:3001', 'https://example.test'],
      SHUTDOWN_TIMEOUT_MS: 10000,
    });
  });

  it('names missing and invalid variables', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: undefined, PORT: 'abc' })).toThrow();

    try {
      parseEnv({ ...validEnv, DATABASE_URL: undefined, PORT: 'abc' });
    } catch (error) {
      expect(formatConfigError(error)).toContain('DATABASE_URL');
      expect(formatConfigError(error)).toContain('PORT');
    }
  });
});
