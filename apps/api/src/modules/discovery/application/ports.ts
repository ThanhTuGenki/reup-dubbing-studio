import type { NormalizedContent } from '../domain/discovery';

export type ProviderPage = { items: NormalizedContent[]; nextCursor: unknown | null; hasMore: boolean; skippedCounts: Record<string, number> };
export interface SourceDiscoveryProvider {
  scan(input: { mode: string; input?: string; query?: string; categoryExternalKey?: string; cursor?: unknown; limit: number; cookie: string }): Promise<ProviderPage>;
  validate(cookie: string): Promise<'ACTIVE' | 'EXPIRED' | 'CAPTCHA_REQUIRED' | 'INVALID'>;
}

export interface SourceCredentialCipher {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
