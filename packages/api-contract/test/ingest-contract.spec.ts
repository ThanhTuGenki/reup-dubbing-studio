import { describe, expect, it } from 'vitest';
import type { IngestCreateItem, IngestDisposition, IngestSelection } from '../src';

describe('Ingest contract', () => {
  it('keeps selection explicit and exposes per-item dispositions', () => {
    const selection: IngestSelection = {
      sourceAccountId: '01994429-ec00-7000-8000-000000000101',
      sourceContentIds: ['01994429-ec00-7000-8000-000000000102'],
      channelProfileId: '01994429-ec00-7000-8000-000000000103',
      seriesProfileId: null,
    };
    const disposition: IngestDisposition = 'SOURCE_CREDENTIAL_REQUIRED';
    const resultKeys: (keyof IngestCreateItem)[] = ['videoId', 'jobId', 'taskId', 'issues'];
    expect(selection.sourceContentIds).toHaveLength(1);
    expect(disposition).toBe('SOURCE_CREDENTIAL_REQUIRED');
    expect(resultKeys).not.toContain('credential');
  });
});
