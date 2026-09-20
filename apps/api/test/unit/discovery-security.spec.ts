import { AesGcmSourceCredentialCipher } from '../../src/modules/discovery/infrastructure/source-credential-cipher';
import { parseDouyinNetscapeCookie } from '../../src/modules/discovery/infrastructure/netscape-cookie';
import { sanitizeProviderError, sanitizeProviderUrl } from '../../src/modules/discovery/infrastructure/url-sanitizer';

describe('Discovery credential and provider data security', () => {
  const cookie = '.douyin.com\tTRUE\t/\tTRUE\t0\tttwid\tsecret-value';
  it('accepts only Douyin Netscape cookies and keeps large IDs as strings', () => {
    expect(parseDouyinNetscapeCookie(cookie)).toEqual([expect.objectContaining({ domain: 'douyin.com', name: 'ttwid', value: 'secret-value' })]);
    expect(() => parseDouyinNetscapeCookie('.evil.example\tTRUE\t/\tTRUE\t0\tttwid\tsecret')).toThrow('outside douyin.com');
    expect(() => parseDouyinNetscapeCookie('not-a-cookie')).toThrow('Invalid Netscape');
    const externalId = '999999999999999999999999999999'; expect(String(externalId)).toBe(externalId);
  });
  it('uses a source-specific authenticated envelope', () => {
    const cipher = new AesGcmSourceCredentialCipher(Buffer.alloc(32, 8).toString('base64'));
    const encrypted = cipher.encrypt(cookie);
    expect(encrypted.toString('utf8')).not.toContain('secret-value');
    expect(cipher.decrypt(encrypted)).toBe(cookie);
    encrypted[encrypted.length - 2] = (encrypted[encrypted.length - 2] ?? 0) ^ 1;
    expect(() => cipher.decrypt(encrypted)).toThrow();
  });
  it('strips signed query values before persistence or error reporting', () => {
    const result = sanitizeProviderUrl('https://v.douyin.com/video.mp4?quality=hd&a_bogus=secret&msToken=private');
    expect(result).toMatchObject({ canonicalUrl: 'https://v.douyin.com/video.mp4?quality=hd', requiresRefresh: true });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/u);
    expect(sanitizeProviderError(new Error('request https://x.test/path?a_bogus=secret cookie=private'))).not.toMatch(/secret|private/u);
  });
});
