import { createHash } from 'node:crypto';

const SENSITIVE = /^(?:a_bogus|msToken|verifyFp|fp|webid|uifid|signature|sign|token|auth_key|x-expires)$/iu;

export function sanitizeProviderUrl(value: string): { canonicalUrl: string | null; urlFingerprint: string; requiresRefresh: boolean } {
  let canonicalUrl: string | null = null;
  let requiresRefresh = false;
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE.test(key)) { url.searchParams.delete(key); requiresRefresh = true; }
    }
    url.searchParams.sort();
    canonicalUrl = url.toString();
  } catch { requiresRefresh = true; }
  const fingerprint = createHash('sha256').update(canonicalUrl ?? 'invalid-provider-url').digest('hex');
  return { canonicalUrl, urlFingerprint: fingerprint, requiresRefresh };
}

export function sanitizeProviderError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/https?:\/\/\S+/gu, '[REDACTED_URL]').replace(/(cookie|a_bogus|msToken|verifyFp|token|signature)\s*[=:]\s*\S+/giu, '$1=[REDACTED]').slice(0, 500);
}
