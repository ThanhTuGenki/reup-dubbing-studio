import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import type { ChannelProfile, IngestDisposition, IngestPreflight, SeriesProfile } from '@reup-dubbing-studio/api-client';
import { AlertTriangleIcon, ListPlusIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { paths } from '@/app/router/paths';
import { channelsQuery, seriesListQuery } from '@/features/profiles/api/profiles-query';
import { IngestApiError, preflightSelection, submitIngestJobs } from '../api/ingest-api';

type SelectedSource = { id: string; title: string };
type Props = {
  open: boolean;
  sourceAccountId: string;
  sources: SelectedSource[];
  onOpenChange: (open: boolean) => void;
};

const ready = (value: ChannelProfile | SeriesProfile) => value.status === 'ACTIVE' && value.readiness === 'READY';

export function IngestJobDialog({ open, sourceAccountId, sources, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [channelId, setChannelId] = useState('');
  const [seriesId, setSeriesId] = useState('NONE');
  const [review, setReview] = useState<IngestPreflight>();
  const idempotencyKey = useRef<string | undefined>(undefined);
  const channelOptions = channelsQuery({ query: '', status: 'ACTIVE' });
  const channelsQueryResult = useInfiniteQuery({ ...channelOptions, enabled: open });
  const channels = useMemo(() => channelsQueryResult.data?.pages.flatMap((page) => page.items) ?? [], [channelsQueryResult.data]);
  useEffect(() => {
    if (!open || channelId) return;
    const firstReadyChannel = channels.find(ready);
    if (firstReadyChannel) setChannelId(firstReadyChannel.id);
  }, [channelId, channels, open]);
  const seriesOptions = seriesListQuery({ query: '', status: 'ACTIVE', ...(channelId ? { channelProfileId: channelId } : {}) });
  const seriesQueryResult = useInfiniteQuery({ ...seriesOptions, enabled: open && Boolean(channelId) });
  const series = useMemo(() => seriesQueryResult.data?.pages.flatMap((page) => page.items) ?? [], [seriesQueryResult.data]);
  const selectedChannel = channels.find((item) => item.id === channelId);
  const selectedSeries = series.find((item) => item.id === seriesId);
  const selection = {
    sourceAccountId, sourceContentIds: sources.map((source) => source.id), channelProfileId: channelId,
    seriesProfileId: seriesId === 'NONE' ? null : seriesId,
  };
  const preflight = useMutation({
    mutationFn: () => preflightSelection(selection),
    onSuccess: setReview,
  });
  const create = useMutation({
    mutationFn: () => {
      const creatable = review?.items.filter((item) => item.disposition === 'READY' || item.disposition === 'READY_RETRY').map((item) => item.sourceContentId) ?? [];
      idempotencyKey.current ??= crypto.randomUUID();
      return submitIngestJobs({ ...selection, sourceContentIds: creatable }, idempotencyKey.current);
    },
    onSuccess: (result) => {
      toast.success(`Đã tạo ${result.summary.created} job tải và đưa vào hàng đợi.`);
      onOpenChange(false);
      navigate(paths.queue);
    },
  });

  function changeOpen(value: boolean) {
    if (!value) { setReview(undefined); idempotencyKey.current = undefined; preflight.reset(); create.reset(); }
    onOpenChange(value);
  }
  function chooseChannel(value: string) { setChannelId(value); setSeriesId('NONE'); setReview(undefined); preflight.reset(); }
  const creatableCount = review?.items.filter((item) => item.disposition === 'READY' || item.disposition === 'READY_RETRY').length ?? 0;

  return <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="ingest-dialog sm:max-w-2xl"><DialogHeader><DialogTitle>Tạo job ingest</DialogTitle><DialogDescription>Chọn Profile, kiểm tra {sources.length} video rồi xác nhận đưa vào hàng đợi tải.</DialogDescription></DialogHeader>
    <div className="ingest-steps" aria-label="Tiến độ tạo job"><span className={!review ? 'is-active' : 'is-done'}><b>1</b>Chọn Profile</span><span className={review ? 'is-active' : ''}><b>2</b>Xác nhận</span></div>
    {!review ? <div className="ingest-dialog-body"><div className="ingest-profile-grid"><div><Label htmlFor="ingest-channel">Channel Profile</Label><Select value={channelId} onValueChange={chooseChannel}><SelectTrigger id="ingest-channel"><SelectValue placeholder="Chọn Channel Profile" /></SelectTrigger><SelectContent>{channels.map((item) => <SelectItem key={item.id} value={item.id} disabled={!ready(item)}>{item.name}{ready(item) ? '' : ' · Chưa sẵn sàng'}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="ingest-series">Series Profile (không bắt buộc)</Label><Select value={seriesId} onValueChange={(value) => { setSeriesId(value); setReview(undefined); }} disabled={!channelId}><SelectTrigger id="ingest-series"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">Không dùng Series</SelectItem>{series.map((item) => <SelectItem key={item.id} value={item.id} disabled={!ready(item)}>{item.name}{ready(item) ? '' : ' · Chưa sẵn sàng'}</SelectItem>)}</SelectContent></Select></div></div>
      <section className="ingest-effective" aria-label="Cấu hình hiệu lực"><strong>Cấu hình sẽ snapshot</strong>{selectedChannel ? <dl><div><dt>Ngôn ngữ đích</dt><dd>{selectedSeries?.effectiveConfig.targetLanguage ?? selectedChannel.pipeline.targetLanguage}</dd></div><div><dt>Voice mode</dt><dd>{selectedSeries?.effectiveConfig.voiceMode ?? selectedChannel.pipeline.voiceMode}</dd></div><div><dt>Đầu ra</dt><dd>{outputs(selectedSeries?.effectiveConfig ?? selectedChannel.pipeline)}</dd></div></dl> : <p>Đang tải Profile sẵn sàng…</p>}</section>
      <GpuNotice />{channelsQueryResult.isError && <InlineError error={channelsQueryResult.error} />}{preflight.isError && <InlineError error={preflight.error} />}</div>
      : <div className="ingest-dialog-body"><div className="ingest-review-summary"><span><strong>{review.summary.ready}</strong> có thể tạo</span><span><strong>{duplicateCount(review)}</strong> trùng</span><span><strong>{blockedCount(review)}</strong> bị bỏ qua</span></div><div className="ingest-review-list">{review.items.map((item) => <article key={item.sourceContentId}><div><strong>{sources.find((source) => source.id === item.sourceContentId)?.title ?? item.sourceContentId}</strong><span>{item.sourceContentId}</span></div><Badge variant={dispositionVariant(item.disposition)}>{dispositionLabel(item.disposition)}</Badge>{item.issues.length > 0 && <p>{item.issues.join(', ')}</p>}</article>)}</div><GpuNotice />{create.isError && <InlineError error={create.error} />}</div>}
    <DialogFooter><Button variant="outline" onClick={() => review ? setReview(undefined) : changeOpen(false)}>{review ? 'Quay lại' : 'Hủy'}</Button>{review ? <Button disabled={creatableCount === 0 || create.isPending} onClick={() => create.mutate()}><ListPlusIcon />{create.isPending ? 'Đang tạo…' : `Tạo ${creatableCount} job tải`}</Button> : <Button disabled={!channelId || preflight.isPending || channelsQueryResult.isPending} onClick={() => preflight.mutate()}>{preflight.isPending && <LoaderCircleIcon className="animate-spin" />}Kiểm tra lựa chọn</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}

function GpuNotice() { return <div className="ingest-gpu-note"><AlertTriangleIcon /><div><strong>Chưa bắt đầu xử lý GPU</strong><p>Thao tác này chỉ tạo job tải và đưa vào Queue. Không thuê hoặc chạy GPU worker.</p></div></div>; }
function InlineError({ error }: { error: unknown }) { return <div className="ingest-inline-error" role="alert"><AlertTriangleIcon /><span>{error instanceof IngestApiError ? error.message : 'Không thể hoàn tất thao tác.'}</span></div>; }
function outputs(pipeline: ChannelProfile['pipeline']) { const values = [pipeline.output16x9Enabled && '16:9', pipeline.output9x16Enabled && '9:16'].filter(Boolean); return values.join(' + ') || 'Chưa cấu hình'; }
function duplicateCount(review: IngestPreflight) { return review.items.filter((item) => item.disposition === 'ALREADY_QUEUED' || item.disposition === 'ALREADY_INGESTED').length; }
function blockedCount(review: IngestPreflight) { return review.summary.total - review.summary.ready - duplicateCount(review); }
function dispositionVariant(value: IngestDisposition): 'default' | 'secondary' | 'destructive' | 'outline' { if (value === 'READY' || value === 'READY_RETRY') return 'default'; if (value === 'ALREADY_QUEUED' || value === 'ALREADY_INGESTED') return 'secondary'; return 'destructive'; }
function dispositionLabel(value: IngestDisposition) { return ({ READY: 'Sẵn sàng', READY_RETRY: 'Sẵn sàng retry', ALREADY_QUEUED: 'Đã xếp hàng', ALREADY_INGESTED: 'Đã ingest', SOURCE_NOT_FOUND: 'Không tìm thấy nguồn', SOURCE_UNAVAILABLE: 'Nguồn không khả dụng', SOURCE_NOT_INGEST_ELIGIBLE: 'Chưa hỗ trợ ingest', SOURCE_ACCOUNT_UNAVAILABLE: 'Tài khoản nguồn không khả dụng', SOURCE_CREDENTIAL_REQUIRED: 'Cần cập nhật cookie', PROFILE_NOT_READY: 'Channel chưa sẵn sàng', SERIES_NOT_READY: 'Series chưa sẵn sàng', SERIES_CHANNEL_MISMATCH: 'Series không thuộc Channel', VIDEO_PROFILE_CONFLICT: 'Video dùng Series khác' } satisfies Record<IngestDisposition, string>)[value]; }
