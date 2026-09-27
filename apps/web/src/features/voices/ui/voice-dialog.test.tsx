import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { voiceProfile } from '@/test/fixtures/control-plane';
import type * as VoicesApi from '../api/voices-api';
import { VoiceDialog } from './voice-dialog';

const { addVoice, saveVoice, uploadVoiceSample, readAudioDurationMs } = vi.hoisted(() => ({
  addVoice: vi.fn(), saveVoice: vi.fn(), uploadVoiceSample: vi.fn(), readAudioDurationMs: vi.fn(),
}));
vi.mock('../api/voices-api', async (original) => ({
  ...(await original<typeof VoicesApi>()),
  addVoice, saveVoice, uploadVoiceSample, readAudioDurationMs,
}));

if (!URL.createObjectURL) {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:mock' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined });
}

describe('VoiceDialog', () => {
  beforeEach(() => {
    addVoice.mockReset().mockResolvedValue({ profile: voiceProfile, etag: '"1"' });
    saveVoice.mockReset().mockResolvedValue({ profile: voiceProfile, etag: '"4"' });
    uploadVoiceSample.mockReset().mockResolvedValue(undefined);
    readAudioDurationMs.mockReset().mockResolvedValue(7_400);
  });

  it('picks the primary language by name and submits the code when creating a Voice', async () => {
    const user = userEvent.setup();
    renderApp(<VoiceDialog open snapshot={null} onOpenChange={vi.fn()} />);
    await user.type(screen.getByLabelText('Tên giọng'), 'Giọng mới');
    await user.selectOptions(screen.getByLabelText('Ngôn ngữ chính'), 'Tiếng Anh');
    await user.click(screen.getByRole('button', { name: 'Lưu Voice' }));
    await waitFor(() => expect(addVoice).toHaveBeenCalledTimes(1));
    expect(addVoice.mock.calls[0]?.[0]).toMatchObject({ primaryLanguage: 'en' });
  });

  it('picks the sample language by name and submits its code with the sample', async () => {
    const user = userEvent.setup();
    renderApp(<VoiceDialog open snapshot={{ profile: voiceProfile, etag: '"3"' }} onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText('File audio'), new File(['x'], 'sample.wav', { type: 'audio/wav' }));
    await user.selectOptions(screen.getByLabelText('Ngôn ngữ sample'), 'Tiếng Anh');
    await user.type(screen.getByLabelText('Transcript'), 'Xin chào');
    await waitFor(() => expect(screen.getByText('Thời lượng: 7,4 giây')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Lưu Voice' }));
    await waitFor(() => expect(uploadVoiceSample).toHaveBeenCalledTimes(1));
    expect(uploadVoiceSample.mock.calls[0]?.[0]).toMatchObject({ language: 'en', transcript: 'Xin chào', durationMs: 7_400 });
  });

  it('detects the duration from the chosen audio file instead of asking for it', async () => {
    const user = userEvent.setup();
    renderApp(<VoiceDialog open snapshot={{ profile: voiceProfile, etag: '"3"' }} onOpenChange={vi.fn()} />);
    expect(screen.queryByLabelText('Thời lượng (giây)')).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText('File audio'), new File(['x'], 'sample.wav', { type: 'audio/wav' }));
    await waitFor(() => expect(readAudioDurationMs).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Thời lượng: 7,4 giây')).toBeInTheDocument();
  });

  it('blocks upload and shows the existing error when the detected duration is out of range', async () => {
    readAudioDurationMs.mockReset().mockResolvedValue(2_000);
    const user = userEvent.setup();
    renderApp(<VoiceDialog open snapshot={{ profile: voiceProfile, etag: '"3"' }} onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText('File audio'), new File(['x'], 'sample.wav', { type: 'audio/wav' }));
    await user.type(screen.getByLabelText('Transcript'), 'Xin chào');
    await waitFor(() => expect(screen.getByText('Thời lượng: 2,0 giây')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Lưu Voice' }));
    expect(await screen.findByText('Sample cần transcript và thời lượng từ 3–10 giây.')).toBeInTheDocument();
    expect(uploadVoiceSample).not.toHaveBeenCalled();
  });
});
