import { redactLog } from '../../src/platform/observability/log-redaction';

const REDACTED = '[Redacted]';

describe('structured log redaction', () => {
  it.each([
    ['authorization', 'Bearer authorization-sentinel'],
    ['cookie', 'session=cookie-sentinel'],
    ['token', 'token-sentinel'],
    ['secret', 'secret-sentinel'],
    ['apiKey', 'api-key-sentinel'],
    ['password', 'password-sentinel'],
  ])('redacts %s values recursively', (key, value) => {
    const output = redactLog({
      request: {
        headers: { [key]: value },
        nested: [{ [key]: value }],
      },
    });

    expect(output).toEqual({
      request: {
        headers: { [key]: REDACTED },
        nested: [{ [key]: REDACTED }],
      },
    });
    expect(JSON.stringify(output)).not.toContain(value);
  });

  it('redacts a full query string from URLs and standalone query fields', () => {
    const output = redactLog({
      url: '/v1/health/live?sentinel=query-secret&token=also-secret',
      query: 'sentinel=query-secret&token=also-secret',
      nested: { href: 'https://example.test/path?sentinel=query-secret' },
    });

    expect(output).toEqual({
      url: `/v1/health/live?${REDACTED}`,
      query: REDACTED,
      nested: { href: `https://example.test/path?${REDACTED}` },
    });
    expect(JSON.stringify(output)).not.toContain('query-secret');
    expect(JSON.stringify(output)).not.toContain('also-secret');
  });

  it('redacts presigned URL fields completely', () => {
    const presignedUrl = 'https://bucket.example.test/private/object.mp4?X-Amz-Signature=signature-sentinel';
    const output = redactLog({ presignedUrl, nested: { signedUrl: presignedUrl } });

    expect(output).toEqual({ presignedUrl: REDACTED, nested: { signedUrl: REDACTED } });
    expect(JSON.stringify(output)).not.toContain('private/object.mp4');
    expect(JSON.stringify(output)).not.toContain('signature-sentinel');
  });

  it('does not mutate the original log object while redacting it', () => {
    const input = { authorization: 'authorization-sentinel', message: 'safe' };

    const output = redactLog(input);

    expect(input).toEqual({ authorization: 'authorization-sentinel', message: 'safe' });
    expect(output).toEqual({ authorization: REDACTED, message: 'safe' });
  });
});
