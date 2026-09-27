import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileVideoIcon, UploadIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchChannelProfiles, fetchSeriesProfiles } from '@/features/profiles/api/profiles-api';
import { SOURCE_LANGUAGE_CODES } from '@/shared/lib/languages';
import { LanguageSelect } from '@/shared/ui/language-select';
import { importLocalVideo, LocalImportApiError, readVideoMetadata, type LocalImportProgress, type LocalVideoMetadata } from '../api/local-import-api';

type Errors = Partial<Record<'file'|'title'|'channelProfileId', string>>;
/** Radix SelectItem can't use value=""; these sentinels stand in for "not chosen yet" and are mapped back to '' at the boundary. */
const NO_CHANNEL_VALUE = '__no-channel__';
const NO_SERIES_VALUE = '__no-series__';

export function LocalImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate(); const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null); const [metadata, setMetadata] = useState<LocalVideoMetadata | null>(null);
  const [title, setTitle] = useState(''); const [sourceLanguage, setSourceLanguage] = useState('zh');
  const [channelProfileId, setChannelProfileId] = useState(''); const [seriesProfileId, setSeriesProfileId] = useState('');
  const [errors, setErrors] = useState<Errors>({}); const [progress, setProgress] = useState<LocalImportProgress | null>(null);
  const channels = useQuery({ queryKey: ['profiles', 'channels', 'local-import'], queryFn: ({ signal }) => fetchChannelProfiles({ status: 'ACTIVE', limit: 100 }, signal), enabled: open });
  const series = useQuery({ queryKey: ['profiles', 'series', 'local-import', channelProfileId], queryFn: ({ signal }) => fetchSeriesProfiles({ status: 'ACTIVE', channelProfileId, limit: 100 }, signal), enabled: open && Boolean(channelProfileId) });
  useEffect(() => { if (!open) return; setFile(null); setMetadata(null); setTitle(''); setSourceLanguage('zh'); setChannelProfileId(''); setSeriesProfileId(''); setErrors({}); setProgress(null); }, [open]);
  const mutation = useMutation({
    mutationFn: () => importLocalVideo({ file: file!, title, sourceLanguage, channelProfileId, ...(seriesProfileId ? { seriesProfileId } : {}), metadata: metadata!, onProgress: setProgress }),
    onSuccess: async (result) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['library'] }), queryClient.invalidateQueries({ queryKey: ['queue'] })]);
      toast.success('Đã nhập video và tạo full pipeline job.'); onOpenChange(false); void navigate(`/queue?jobId=${result.jobId}`);
    },
    onError: (error) => toast.error(error instanceof LocalImportApiError ? error.message : 'Không thể nhập video.'),
  });
  const chooseFile = async (next: File | null) => {
    setFile(next); setMetadata(null); setErrors((current) => { const nextErrors = { ...current }; delete nextErrors.file; return nextErrors; });
    if (!next) return;
    if (next.type !== 'video/mp4' && !next.name.toLowerCase().endsWith('.mp4')) { setErrors((current) => ({ ...current, file: 'Chỉ hỗ trợ file MP4.' })); return; }
    if (!title) setTitle(next.name.replace(/\.mp4$/iu, ''));
    try { setMetadata(await readVideoMetadata(next)); } catch (error) { setErrors((current) => ({ ...current, file: error instanceof Error ? error.message : 'Không đọc được video.' })); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); const next: Errors = {};
    if (!file || !metadata) next.file = 'Chọn một file MP4 hợp lệ.';
    if (!title.trim()) next.title = 'Nhập tiêu đề video.';
    if (!channelProfileId) next.channelProfileId = 'Chọn hồ sơ kênh.';
    setErrors(next); if (!Object.keys(next).length) mutation.mutate();
  };
  const activeChannels = channels.data?.items.filter((profile) => profile.readiness === 'READY') ?? [];
  const activeSeries = series.data?.items.filter((profile) => profile.readiness === 'READY') ?? [];
  return <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) onOpenChange(next); }}><DialogContent className="local-import-dialog sm:max-w-2xl"><form onSubmit={submit} noValidate><DialogHeader><DialogTitle>Nhập video vào pipeline</DialogTitle><DialogDescription>Tải video lên và tạo job lồng tiếng. Job sẽ chờ GPU sau khi tải lên xong.</DialogDescription></DialogHeader><div className="local-import-body"><FieldGroup>
    <Field data-invalid={Boolean(errors.file)}><FieldLabel htmlFor="local-video"><FileVideoIcon />File video</FieldLabel><Input id="local-video" type="file" accept="video/mp4,.mp4" disabled={mutation.isPending} onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} /><FieldDescription>{metadata ? `${formatBytes(file!.size)} · ${metadata.width}×${metadata.height} · ${formatDuration(metadata.durationMs)}` : 'MP4, tối đa 10 GiB.'}</FieldDescription><FieldError>{errors.file}</FieldError></Field>
    <div className="local-import-grid"><Text id="local-title" label="Tiêu đề" value={title} error={errors.title} disabled={mutation.isPending} onChange={setTitle} /><Field><FieldLabel htmlFor="local-language">Ngôn ngữ nguồn</FieldLabel><LanguageSelect id="local-language" value={sourceLanguage} codes={SOURCE_LANGUAGE_CODES} disabled={mutation.isPending} onChange={setSourceLanguage} /><FieldDescription>Ngôn ngữ đang nói trong video. Video sẽ được lồng tiếng sang tiếng Việt.</FieldDescription></Field>
      <Field data-invalid={Boolean(errors.channelProfileId)}><FieldLabel htmlFor="local-channel">Hồ sơ kênh</FieldLabel><Select value={channelProfileId === '' ? NO_CHANNEL_VALUE : channelProfileId} disabled={mutation.isPending || channels.isPending} onValueChange={(next) => { setChannelProfileId(next === NO_CHANNEL_VALUE ? '' : next); setSeriesProfileId(''); }}><SelectTrigger id="local-channel" className="w-full" aria-invalid={Boolean(errors.channelProfileId)}><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_CHANNEL_VALUE}>Chọn hồ sơ kênh</SelectItem>{activeChannels.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select><FieldError>{errors.channelProfileId}</FieldError></Field>
      <Field><FieldLabel htmlFor="local-series">Series (không bắt buộc)</FieldLabel><Select value={seriesProfileId === '' ? NO_SERIES_VALUE : seriesProfileId} disabled={mutation.isPending || !channelProfileId || series.isPending} onValueChange={(next) => setSeriesProfileId(next === NO_SERIES_VALUE ? '' : next)}><SelectTrigger id="local-series" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_SERIES_VALUE}>Không dùng series</SelectItem>{activeSeries.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></Field>
    </div>
    {progress && <section className="local-import-progress" aria-live="polite"><div><strong>{phaseLabel(progress.phase)}</strong><span>{progress.percent}%</span></div><Progress value={progress.percent} /></section>}
  </FieldGroup></div><DialogFooter><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Hủy</Button><Button type="submit" disabled={mutation.isPending || channels.isPending}>{mutation.isPending ? <UploadIcon className="animate-pulse" /> : <UploadIcon />}{mutation.isPending ? phaseLabel(progress?.phase) : 'Upload và tạo job'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Text({ id, label, value, error, disabled, onChange }: { id: string; label: string; value: string; error: string | undefined; disabled: boolean; onChange: (value: string) => void }) { return <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} value={value} disabled={disabled} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} /><FieldError>{error}</FieldError></Field>; }
function phaseLabel(value?: LocalImportProgress['phase']) { return value === 'HASHING' ? 'Đang kiểm tra file…' : value === 'UPLOADING' ? 'Đang tải video lên…' : value === 'COMMITTING' ? 'Đang tạo pipeline…' : 'Đang xử lý…'; }
function formatBytes(value: number) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MiB`; }
function formatDuration(value: number) { const seconds = Math.round(value / 1_000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
