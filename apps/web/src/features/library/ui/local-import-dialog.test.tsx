import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { channelProfile } from '@/test/fixtures/control-plane';
import type * as LocalImportApi from '../api/local-import-api';
import { LocalImportDialog } from './local-import-dialog';

const { importLocalVideo } = vi.hoisted(() => ({ importLocalVideo: vi.fn() }));
vi.mock('../api/local-import-api', async (original) => ({
  ...(await original<typeof LocalImportApi>()),
  importLocalVideo,
  readVideoMetadata: vi.fn(async () => ({ durationMs: 60_000, width: 1920, height: 1080 })),
}));

describe('LocalImportDialog', () => {
  beforeEach(() => { importLocalVideo.mockReset().mockResolvedValue({ videoId: 'v', jobId: 'j', rawAssetId: 'a', status: 'WAITING_FOR_GPU' }); });

  it('explains the job in plain language and names fields for operators', async () => {
    renderApp(<LocalImportDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Tải video lên và tạo job lồng tiếng. Job sẽ chờ GPU sau khi tải lên xong.')).toBeInTheDocument();
    expect(screen.getByLabelText('Hồ sơ kênh')).toBeInTheDocument();
    expect(screen.getByLabelText('Series (không bắt buộc)')).toBeInTheDocument();
    expect(screen.queryByText(/faster-whisper|R2/u)).not.toBeInTheDocument();
  });

  it('picks the source language by name, defaulting to Chinese', async () => {
    const user = userEvent.setup();
    renderApp(<LocalImportDialog open onOpenChange={vi.fn()} />);
    const language = screen.getByLabelText('Ngôn ngữ nguồn');
    expect(language).toHaveTextContent('Tiếng Trung');
    await user.click(language);
    expect(screen.getAllByRole('option', { name: /^Tiếng / }).map((option) => option.textContent)).toEqual(['Tiếng Trung', 'Tiếng Anh', 'Tiếng Nhật', 'Tiếng Hàn', 'Tiếng Thái']);
    expect(screen.getByText('Ngôn ngữ đang nói trong video. Video sẽ được lồng tiếng sang tiếng Việt.')).toBeInTheDocument();
  });

  it('sends the language code of the chosen name', async () => {
    const user = userEvent.setup();
    renderApp(<LocalImportDialog open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText('File video'), new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    await user.click(screen.getByLabelText('Ngôn ngữ nguồn'));
    await user.click(screen.getByRole('option', { name: 'Tiếng Anh' }));
    const channel = screen.getByLabelText('Hồ sơ kênh');
    await waitFor(() => expect(channel).toBeEnabled());
    await user.click(channel);
    await user.click(screen.getByRole('option', { name: channelProfile.name }));
    await user.click(screen.getByRole('button', { name: 'Upload và tạo job' }));
    await waitFor(() => expect(importLocalVideo).toHaveBeenCalledTimes(1));
    expect(importLocalVideo.mock.calls[0]?.[0]).toMatchObject({ sourceLanguage: 'en', title: 'clip', channelProfileId: channelProfile.id });
  });
});
