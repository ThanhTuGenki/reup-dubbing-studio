import type { SourceCredentialCipher, SourceDiscoveryProvider } from './ports';
import type { PrismaDiscoveryRepository } from '../infrastructure/prisma-discovery-repository';
import { sanitizeProviderError } from '../infrastructure/url-sanitizer';

export class DiscoveryRunner {
  constructor(private readonly repository: PrismaDiscoveryRepository, private readonly cipher: SourceCredentialCipher, private readonly provider: SourceDiscoveryProvider) {}
  dispatch(id: string) { setImmediate(() => { void this.execute(id); }); }
  async execute(id: string) {
    const run = await this.repository.claimRun(id); if (!run) return;
    let total = 0;
    try {
      const credential = await this.repository.activeCredential(run.sourceAccountId);
      const cookie = this.cipher.decrypt(Buffer.from(credential.ciphertext));
      let cursor: unknown = run.providerCursor; let pageIndex = 0; const limit = run.requestedLimit ?? 50;
      do {
        const page = await this.provider.scan({ mode: run.mode, ...(run.input ? { input: run.input } : {}), ...(run.query ? { query: run.query } : {}), ...(run.category ? { categoryExternalKey: run.category.externalKey } : {}), cursor, limit: Math.min(20, limit - total), cookie });
        const persisted = await this.repository.persistPage(run.id, run.sourceAccount.platform, pageIndex, page.items, page.nextCursor, page.skippedCounts);
        if (!persisted) return; total += page.items.length; cursor = page.nextCursor; pageIndex += 1;
        if (!page.hasMore || total >= limit || page.items.length === 0) break;
      } while (pageIndex < 20);
      await this.repository.finishRun(run.id, 'SUCCEEDED');
    } catch (error) { const code = providerCode(error); const detail = sanitizeProviderError(error); if (total > 0) await this.repository.finishRun(run.id, 'PARTIAL', code, detail); else await this.repository.failRun(run.id, code, detail); }
  }
}

function providerCode(error: unknown) { if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') return error.code; return 'DISCOVERY_PROVIDER_FAILED'; }
