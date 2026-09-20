import { createHash } from 'node:crypto';
import type { CreateRun, CreateSourceAccount, CreateWatchlist, DiscoveryItemQuery, DiscoveryMode, UpdateWatchlist } from '../domain/discovery';
import { ENABLED_DISCOVERY_MODES } from '../domain/discovery';
import { DiscoveryError } from '../domain/discovery-errors';
import { cookieExpiry, parseDouyinNetscapeCookie } from '../infrastructure/netscape-cookie';
import type { PrismaDiscoveryRepository } from '../infrastructure/prisma-discovery-repository';
import type { SourceCredentialCipher, SourceDiscoveryProvider } from './ports';
import type { DiscoveryRunner } from './discovery-runner';

export class DiscoveryService {
  constructor(private readonly repository: PrismaDiscoveryRepository, private readonly cipher: SourceCredentialCipher, private readonly provider: SourceDiscoveryProvider, private readonly runner: DiscoveryRunner) {}
  listAccounts(platform?: 'DOUYIN' | 'BILIBILI' | 'YOUTUBE') { return this.repository.listAccounts(platform); }
  createAccount(input: CreateSourceAccount, key: string) { if (!input.displayName.trim() || input.displayName.trim().length > 120) invalid('Display name must contain 1 to 120 characters'); return this.repository.createAccount(input, key, hash(input)); }
  async importCredential(id: string, value: string) { const parsed = parseDouyinNetscapeCookie(value); return this.repository.storeCredential(id, this.cipher.encrypt(value), cookieExpiry(parsed)); }
  revokeCredential(id: string) { return this.repository.revokeCredential(id); }
  async validateAccount(id: string) { const credential = await this.repository.activeCredential(id); const status = credential.expiresAt && credential.expiresAt <= new Date() ? 'EXPIRED' : await this.provider.validate(this.cipher.decrypt(Buffer.from(credential.ciphertext))); return this.repository.recordValidation(id, status); }
  listCategories(platform: 'DOUYIN' | 'BILIBILI' | 'YOUTUBE') { return this.repository.listCategories(platform); }
  async createRun(input: CreateRun, key: string) { validateMode(input.mode); validateRun(input); const run = await this.repository.createRun(input, key, hash(input)); this.runner.dispatch(run.id); return run; }
  getRun(id: string) { return this.repository.run(id); }
  cancelRun(id: string) { return this.repository.cancelRun(id); }
  listItems(query: DiscoveryItemQuery) { return this.repository.listItems(query); }
  createWatchlist(input: CreateWatchlist, key: string) { if (input.mode !== 'CREATOR') disabled(input.mode); const identity = creatorIdentity(input.input); if (!input.displayName.trim() || input.displayName.trim().length > 120) invalid('Display name must contain 1 to 120 characters'); return this.repository.createWatchlist(input, key, hash(input), identity); }
  listWatchlists() { return this.repository.listWatchlists(); }
  updateWatchlist(id: string, version: number, input: UpdateWatchlist) { if (!Object.keys(input).length) invalid('Watchlist patch cannot be empty'); if (input.displayName !== undefined && !input.displayName.trim()) invalid('Watchlist name cannot be empty'); return this.repository.updateWatchlist(id, version, input); }
  deleteWatchlist(id: string, version: number) { return this.repository.deleteWatchlist(id, version); }
  async runWatchlist(id: string, key: string) { const watchlist = await this.repository.watchlist(id); if (watchlist.status !== 'ACTIVE') invalid('Watchlist is not active'); const active = await this.repository.createRun({ sourceAccountId: watchlist.sourceAccountId, mode: 'WATCHLIST', input: JSON.stringify(watchlist.resolvedInput), requestedLimit: 100 }, key, hash({ id, version: watchlist.version }), id); this.runner.dispatch(active.id); return active; }
}

export class UnavailableDouyinDiscoveryProvider implements SourceDiscoveryProvider {
  async validate(): Promise<never> { throw new DiscoveryError('DISCOVERY_PROVIDER_UNAVAILABLE', 'Browser discovery provider is not configured'); }
  async scan(): Promise<never> { throw new DiscoveryError('DISCOVERY_PROVIDER_UNAVAILABLE', 'Browser discovery provider is not configured'); }
}

function validateMode(mode: DiscoveryMode) { if (!(ENABLED_DISCOVERY_MODES as readonly string[]).includes(mode)) disabled(mode); }
function validateRun(input: CreateRun) { if (input.mode === 'CATEGORY' && !input.categoryId) invalid('Category mode requires categoryId'); if (input.mode === 'CREATOR') creatorIdentity(input.input ?? ''); if (input.requestedLimit !== undefined && ![20, 50, 100].includes(input.requestedLimit)) invalid('Requested limit must be 20, 50 or 100'); }
function creatorIdentity(value: string) { try { const url = new URL(value); if (url.protocol !== 'https:' || (url.hostname !== 'douyin.com' && !url.hostname.endsWith('.douyin.com'))) throw new Error(); const match = /^\/user\/([^/?#]+)/u.exec(url.pathname); if (!match?.[1]) throw new Error(); return match[1]; } catch { invalid('Creator input must be an https Douyin user URL'); } }
function disabled(mode: string): never { throw new DiscoveryError('DISCOVERY_MODE_DISABLED', `Discovery mode ${mode} is disabled until fixture and live smoke validation`); }
function invalid(message: string): never { throw new DiscoveryError('DISCOVERY_VALIDATION_FAILED', message); }
function hash(value: unknown) { return createHash('sha256').update(stable(value)).digest('hex'); }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`; return JSON.stringify(value); }
