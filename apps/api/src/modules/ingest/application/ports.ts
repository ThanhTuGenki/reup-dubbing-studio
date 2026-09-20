import type { IngestCreateResult, IngestPreflight, IngestSelection } from '../domain/ingest';

export interface IngestRepository {
  preflight(input: IngestSelection): Promise<IngestPreflight>;
  create(input: IngestSelection, idempotencyKey: string, requestHash: string, requestId?: string): Promise<IngestCreateResult>;
}
