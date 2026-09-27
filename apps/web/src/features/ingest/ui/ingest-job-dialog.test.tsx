import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { IngestJobDialog } from './ingest-job-dialog';

describe('IngestJobDialog', () => {
  it('shows the target language of the effective config by name instead of a raw code', async () => {
    renderApp(<IngestJobDialog open sourceAccountId="acc" sources={[{ id: 'src-1', title: 'Video mẫu' }]} onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Cấu hình sẽ snapshot')).toBeInTheDocument();
    expect(await screen.findByText('Tiếng Việt')).toBeInTheDocument();
  });
});
