import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { VideoDeletionError } from '../domain/video-deletion-errors';
import type { PrismaVideoDeletionRepository, PurgeAsset } from '../infrastructure/prisma-video-deletion-repository';
import type { VideoDeletionObjectStore } from '../infrastructure/r2-video-deletion-object-store';

const POLL_MS = 2_000;

/** Removes DELETING videos in the background: objects first (one exact key each), then the DB rows. */
export class VideoDeletionRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoDeletionRunner.name);
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopping = false;

  constructor(
    private readonly repository: PrismaVideoDeletionRepository,
    private readonly objects: VideoDeletionObjectStore,
    private readonly enabled = true,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.active) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /** Processes at most one video. */
  async tick(): Promise<void> {
    if (this.active || this.stopping) return;
    this.active = true;
    try {
      const claimed = await this.repository.claimNext(this.clock());
      if (!claimed) return;
      try { await this.process(claimed); } catch (error) {
        const code = error instanceof VideoDeletionError ? error.code : 'DELETION_FAILED';
        this.logger.warn(`Video deletion attempt failed videoId=${claimed.id} code=${code}`);
        await this.repository.recordFailure(claimed.id, claimed.attempts, code, this.clock());
      }
    } catch {
      // A later poll retries database-level failures; the soft lease makes this safe.
      this.logger.warn('Video deletion tick failed');
    } finally { this.active = false; }
  }

  private async process(claimed: { id: string; graceUntil: Date | null }) {
    const assets = await this.repository.assetsToPurge(claimed.id);
    for (const asset of assets.filter((item) => item.previousStatus !== 'PENDING')) await this.purge(asset);
    if (claimed.graceUntil && this.clock() < claimed.graceUntil) { await this.repository.scheduleAt(claimed.id, claimed.graceUntil); return; }
    for (const asset of assets.filter((item) => item.previousStatus === 'PENDING')) await this.purge(asset);
    const outcome = await this.repository.finalize(claimed.id, this.clock());
    if (outcome === 'DELETED') this.logger.log(`Video deleted videoId=${claimed.id}`);
  }

  private async purge(asset: PurgeAsset) {
    if (asset.storageBackend === 'R2') await this.objects.deleteObject(asset.bucket, asset.objectKey);
    await this.repository.markAssetDeleted(asset.id);
  }
}
