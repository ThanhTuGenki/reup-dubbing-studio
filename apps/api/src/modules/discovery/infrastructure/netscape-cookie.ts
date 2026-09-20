import { DiscoveryError } from '../domain/discovery-errors';

export type ParsedCookie = { domain: string; path: string; secure: boolean; expiresAt: Date | null; name: string; value: string };

export function parseDouyinNetscapeCookie(value: string): ParsedCookie[] {
  if (Buffer.byteLength(value, 'utf8') > 256 * 1024) invalid('Cookie file is too large');
  const cookies: ParsedCookie[] = [];
  for (const original of value.split(/\r?\n/u)) {
    const line = original.startsWith('#HttpOnly_') ? original.slice('#HttpOnly_'.length) : original;
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length !== 7) invalid('Invalid Netscape cookie format');
    const [domainRaw, , path, secureRaw, expiresRaw, name, cookieValue] = fields as [string, string, string, string, string, string, string];
    const domain = domainRaw.replace(/^\./u, '').toLowerCase();
    if (domain !== 'douyin.com' && !domain.endsWith('.douyin.com')) invalid('Cookie contains a domain outside douyin.com');
    if (!name || /[\r\n]/u.test(cookieValue)) invalid('Invalid cookie entry');
    const seconds = Number(expiresRaw);
    cookies.push({ domain, path: path || '/', secure: secureRaw.toUpperCase() === 'TRUE', expiresAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null, name, value: cookieValue });
  }
  if (!cookies.length) invalid('Cookie file contains no Douyin cookies');
  return cookies;
}

export function cookieExpiry(cookies: ParsedCookie[]): Date | null {
  const dates = cookies.map((cookie) => cookie.expiresAt).filter((date): date is Date => date !== null);
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

function invalid(message: string): never { throw new DiscoveryError('DISCOVERY_VALIDATION_FAILED', message); }
