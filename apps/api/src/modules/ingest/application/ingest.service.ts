import { createHash } from 'node:crypto';
import type { IngestRepository } from './ports';
import type { IngestSelection } from '../domain/ingest';
import { IngestError } from '../domain/ingest-errors';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class IngestService {
  constructor(private readonly repository: IngestRepository) {}

  preflight(input: IngestSelection) {
    validate(input);
    return this.repository.preflight(normalize(input));
  }

  create(input: IngestSelection, idempotencyKey: string, requestId?: string) {
    validate(input);
    if (!/^[\x21-\x7e]{8,128}$/u.test(idempotencyKey)) {
      throw new IngestError('INGEST_VALIDATION_FAILED', 'Idempotency-Key must contain 8 to 128 visible ASCII characters');
    }
    const normalized = normalize(input);
    return this.repository.create(normalized, idempotencyKey, hash(normalized), requestId);
  }
}

function validate(input: IngestSelection): void {
  const ids = [input.sourceAccountId, input.channelProfileId, ...(input.seriesProfileId ? [input.seriesProfileId] : []), ...input.sourceContentIds];
  if (ids.some((id) => !UUID_V7.test(id))) fail('All IDs must be UUID v7');
  if (input.sourceContentIds.length < 1 || input.sourceContentIds.length > 100) fail('Select between 1 and 100 source contents');
  if (new Set(input.sourceContentIds).size !== input.sourceContentIds.length) fail('Source content IDs must be unique');
}

function normalize(input: IngestSelection): IngestSelection {
  return { ...input, seriesProfileId: input.seriesProfileId ?? null };
}

function hash(input: IngestSelection): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function fail(message: string): never { throw new IngestError('INGEST_VALIDATION_FAILED', message); }
