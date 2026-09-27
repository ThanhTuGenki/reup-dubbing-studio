import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { channelProfile, seriesProfile, voiceProfile } from '@/test/fixtures/control-plane';
import type * as ProfilesApi from '../api/profiles-api';
import { ChannelProfileDialog, SeriesProfileDialog } from './profile-dialogs';

const { saveChannelProfile, saveSeriesProfile } = vi.hoisted(() => ({ saveChannelProfile: vi.fn(), saveSeriesProfile: vi.fn() }));
vi.mock('../api/profiles-api', async (original) => ({
  ...(await original<typeof ProfilesApi>()),
  saveChannelProfile,
  saveSeriesProfile,
}));

describe('ChannelProfileDialog', () => {
  beforeEach(() => { saveChannelProfile.mockReset().mockResolvedValue({ profile: channelProfile, etag: '"4"' }); });

  it('picks the target and subtitle language by name and submits the codes', async () => {
    const user = userEvent.setup();
    renderApp(<ChannelProfileDialog open snapshot={{ profile: channelProfile, etag: '"3"' }} onOpenChange={vi.fn()} />);
    await user.click(screen.getByLabelText('Ngôn ngữ đích'));
    await user.click(screen.getByRole('option', { name: 'Tiếng Anh' }));
    await user.click(screen.getByLabelText('Ngôn ngữ subtitle'));
    await user.click(screen.getByRole('option', { name: 'Tiếng Nhật' }));
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(saveChannelProfile).toHaveBeenCalledTimes(1));
    expect(saveChannelProfile.mock.calls[0]?.[2]).toMatchObject({ pipeline: expect.objectContaining({ targetLanguage: 'en', subtitleLanguage: 'ja' }) });
  });

  it('picks the default voice from the voice library by name and submits its id', async () => {
    const user = userEvent.setup();
    renderApp(<ChannelProfileDialog open snapshot={{ profile: channelProfile, etag: '"3"' }} onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Giọng mặc định')).toBeEnabled());
    await user.click(screen.getByLabelText('Giọng mặc định'));
    await user.click(screen.getByRole('option', { name: `${voiceProfile.name} · Tiếng Việt` }));
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(saveChannelProfile).toHaveBeenCalledTimes(1));
    expect(saveChannelProfile.mock.calls[0]?.[2]).toMatchObject({ pipeline: expect.objectContaining({ defaultVoiceProfileId: voiceProfile.id }) });
  });
});

describe('SeriesProfileDialog', () => {
  beforeEach(() => { saveSeriesProfile.mockReset().mockResolvedValue({ profile: seriesProfile, etag: '"2:2"' }); });

  it('keeps the override language and voice selects disabled until overridden', () => {
    renderApp(<SeriesProfileDialog open snapshot={{ profile: seriesProfile, etag: '"2:2"' }} channels={[channelProfile]} onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText('Ngôn ngữ đích')).toBeDisabled();
    expect(screen.getByLabelText('Giọng mặc định')).toBeDisabled();
  });

  it('submits the code of an overridden language picked by name', async () => {
    const user = userEvent.setup();
    const overridden = { ...seriesProfile, inheritance: { ...seriesProfile.inheritance, targetLanguage: 'SERIES' as const } };
    renderApp(<SeriesProfileDialog open snapshot={{ profile: overridden, etag: '"2:2"' }} channels={[channelProfile]} onOpenChange={vi.fn()} />);
    const select = screen.getByLabelText('Ngôn ngữ đích');
    expect(select).toBeEnabled();
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Tiếng Anh' }));
    await user.click(screen.getByRole('button', { name: 'Lưu series' }));
    await waitFor(() => expect(saveSeriesProfile).toHaveBeenCalledTimes(1));
    expect(saveSeriesProfile.mock.calls[0]?.[2]).toMatchObject({ overrides: expect.objectContaining({ targetLanguage: 'en' }) });
  });

  it('submits the id of an overridden default voice picked by name', async () => {
    const user = userEvent.setup();
    const overridden = { ...seriesProfile, inheritance: { ...seriesProfile.inheritance, defaultVoiceProfileId: 'SERIES' as const } };
    renderApp(<SeriesProfileDialog open snapshot={{ profile: overridden, etag: '"2:2"' }} channels={[channelProfile]} onOpenChange={vi.fn()} />);
    const select = screen.getByLabelText('Giọng mặc định');
    await waitFor(() => expect(select).toBeEnabled());
    await user.click(select);
    await user.click(screen.getByRole('option', { name: `${voiceProfile.name} · Tiếng Việt` }));
    await user.click(screen.getByRole('button', { name: 'Lưu series' }));
    await waitFor(() => expect(saveSeriesProfile).toHaveBeenCalledTimes(1));
    expect(saveSeriesProfile.mock.calls[0]?.[2]).toMatchObject({ overrides: expect.objectContaining({ defaultVoiceProfileId: voiceProfile.id }) });
  });

  it('blocks submitting an overridden default voice left blank instead of silently inheriting', async () => {
    const user = userEvent.setup();
    renderApp(<SeriesProfileDialog open snapshot={{ profile: seriesProfile, etag: '"2:2"' }} channels={[channelProfile]} onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole('switch', { name: 'Ghi đè Giọng mặc định' }));
    const select = screen.getByLabelText('Giọng mặc định');
    await waitFor(() => expect(select).toBeEnabled());
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Chưa chọn giọng' }));
    await user.click(screen.getByRole('button', { name: 'Lưu series' }));
    expect(await screen.findByText('Chọn giọng để ghi đè hoặc tắt ghi đè.')).toBeInTheDocument();
    expect(saveSeriesProfile).not.toHaveBeenCalled();
  });
});
