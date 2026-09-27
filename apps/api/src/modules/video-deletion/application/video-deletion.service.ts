import { createHash } from 'node:crypto';

import { VideoDeletionError } from '../domain/video-deletion-errors';
import type { PrismaVideoDeletionRepository } from '../infrastructure/prisma-video-deletion-repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class VideoDeletionService {
  constructor(private readonly repository: PrismaVideoDeletionRepository) {}
  delete(videoId: string, version: number, key: string, requestId?: string) { const id = uuid(videoId); return this.repository.request(id, version, idempotencyKey(key), hash({ videoId: id, version }), requestId); }
  deleteMany(items: Array<{ videoId: string; version: number }>, key: string, requestId?: string) {
    if (items.length < 1 || items.length > 100) invalid('items must contain 1 to 100 videos');
    if (new Set(items.map((item) => item.videoId)).size !== items.length) invalid('items must not repeat a video');
    const normalized = items.map((item) => ({ videoId: uuid(item.videoId), version: item.version }));
    return this.repository.requestMany(normalized, idempotencyKey(key), hash({ items: normalized }), requestId);
  }
}
function uuid(value: string) { if (!UUID.test(value)) invalid('videoId must be a UUID'); return value.toLowerCase(); }
function idempotencyKey(value: string) { if (!/^[\x21-\x7e]{8,128}$/u.test(value)) invalid('Idempotency-Key must contain 8 to 128 visible ASCII characters'); return value; }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function invalid(message: string): never { throw new VideoDeletionError('VIDEO_DELETION_VALIDATION_FAILED', message); }
