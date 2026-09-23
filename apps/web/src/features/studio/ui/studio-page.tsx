import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, Clock3Icon, PlayIcon, RefreshCwIcon, SaveIcon, SendIcon, Volume2Icon } from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ListState } from '@/shared/ui/list-state';
import { useQueryInvalidationStream } from '@/shared/api/use-query-invalidation-stream';
import { useTransientStreamToast } from '@/shared/ui/use-transient-stream-toast';
import { regenerateSegment, renderStudio, requestSegmentPreview, reviewStudio, saveStudioSegment, StudioApiError, studioWorkflowEventsUrl } from '../api/studio-api';
import { studioKeys, studioQuery } from '../api/studio-query';

export function StudioPage() {
  const { videoId = '' } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery(studioQuery(videoId));
  const streamState = useQueryInvalidationStream({ url: studioWorkflowEventsUrl(), queryKeys: [studioKeys.detail(videoId)], eventName: 'queue.invalidate', enabled: typeof EventSource !== 'undefined' });
  useTransientStreamToast({ id: `studio-event-stream:${videoId}`, label: 'Studio', state: streamState });
  const [selectedId, setSelectedId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [audioUrl, setAudioUrl] = useState<string>();
  const [reviewDecision, setReviewDecision] = useState<'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'>('APPROVED');
  const [reviewNote, setReviewNote] = useState('');
  const studio = query.data;
  const selected = useMemo(() => studio?.segments.find((item) => item.id === selectedId) ?? studio?.segments[0], [selectedId, studio]);
  const selectedText = selected ? drafts[selected.id] ?? selected.revision?.translatedText ?? '' : '';
  const dirty = Boolean(selected && drafts[selected.id] !== undefined && drafts[selected.id] !== selected.revision?.translatedText);
  const hasUnsavedChanges = Boolean(studio && Object.entries(drafts).some(([id, text]) => studio.segments.find((segment) => segment.id === id)?.revision?.translatedText !== text));
  useEffect(() => { if (!hasUnsavedChanges) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [hasUnsavedChanges]);
  const save = useMutation({ mutationFn: () => selected && studio ? saveStudioSegment(videoId, selected.id, studio.video.version, { translatedText: selectedText, editReason: 'Web Studio edit' }) : Promise.reject(new Error('Chưa chọn segment')), onSuccess: () => { setDrafts({}); void queryClient.invalidateQueries({ queryKey: studioKeys.detail(videoId) }); toast.success('Đã lưu revision segment.'); }, onError: (error) => { if (error instanceof StudioApiError && error.code === 'VERSION_CONFLICT') void query.refetch(); notifyStudioError(error); } });
  const preview = useMutation({ mutationFn: () => selected ? requestSegmentPreview(videoId, selected.id) : Promise.reject(new Error('Chưa chọn segment')), onSuccess: (grant) => { setAudioUrl(grant.url); toast.success('Preview audio đã sẵn sàng.'); }, onError: notifyStudioError });
  const regenerate = useMutation({ mutationFn: () => selected && studio ? regenerateSegment(videoId, selected.id, studio.video.version, `studio-${videoId}-${selected.id}-${studio.video.version}`) : Promise.reject(new Error('Chưa chọn segment')), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: studioKeys.detail(videoId) }); toast.success('Đã đưa segment vào hàng đợi tạo lại.'); }, onError: notifyStudioError });
  const review = useMutation({ mutationFn: () => studio ? reviewStudio(videoId, studio.video.version, { scope: 'SCRIPT', subjectVersion: String(studio.video.version), decision: reviewDecision, ...(reviewNote ? { note: reviewNote } : {}) }) : Promise.reject(new Error('Studio chưa tải')), onSuccess: () => { setReviewNote(''); void queryClient.invalidateQueries({ queryKey: studioKeys.detail(videoId) }); toast.success('Đã lưu quyết định review.'); }, onError: notifyStudioError });
  const render = useMutation({ mutationFn: () => studio ? renderStudio(videoId, studio.video.version, `studio-render-${videoId}-${studio.video.version}`) : Promise.reject(new Error('Studio chưa tải')), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: studioKeys.detail(videoId) }); toast.success('Đã gửi yêu cầu render.'); }, onError: notifyStudioError });

  if (query.isPending) return <div className="page"><ListState state="loading" title="Đang mở Studio" description="Đang tải transcript và revision mới nhất…" /></div>;
  if (query.isError || !studio) return <div className="page"><ListState state="error" title="Không thể mở Studio" description={query.error instanceof Error ? query.error.message : 'Video có thể đã bị xoá hoặc kết nối gặp lỗi.'} action={<Button asChild><Link to="/library">Quay lại thư viện</Link></Button>} /></div>;
  return <div className="page studio-page">
    <header className="queue-heading"><div><p className="eyebrow">Studio biên tập</p><h1>{studio.video.title || 'Video chưa có tiêu đề'}</h1><p className="lede">{studio.video.status} · Version {studio.video.version} · {studio.segments.length} segment</p><Badge variant="outline">{liveStatus(streamState, query.isFetching)}</Badge></div><div className="studio-header-actions"><Button asChild variant="outline"><Link to={`/library/${videoId}`} onClick={(event) => confirmNavigation(event, hasUnsavedChanges)}>Chi tiết video</Link></Button><Button onClick={() => render.mutate()} disabled={!studio.capabilities.canRender || render.isPending || hasUnsavedChanges}><SendIcon />{render.isPending ? 'Đang gửi…' : 'Yêu cầu render'}</Button></div></header>
    <div className="studio-grid">
      <section className="queue-list-card studio-player" aria-label="Player preview"><div className="studio-player-art"><PlayIcon aria-hidden="true" /></div><div className="studio-player-controls"><Badge variant="outline">{studio.video.sourceDurationMs ? formatDuration(studio.video.sourceDurationMs) : 'Chưa có duration'}</Badge><span>Preview audio chỉ tạo khi người dùng yêu cầu.</span></div>{audioUrl && <audio controls src={audioUrl} aria-label="Audio preview" />}</section>
      <aside className="queue-list-card studio-cast"><div className="studio-section-heading"><div><p className="eyebrow">Cast sheet</p><h2>Nhân vật và giọng</h2></div><Badge variant="outline">{studio.cast?.status ?? 'Chưa gán'}</Badge></div>{studio.cast?.entries.length ? <ul className="studio-cast-list">{studio.cast.entries.map((entry) => <li key={entry.id}><span><strong>{entry.displayName}</strong><small>{entry.characterKey} · {entry.roleKind}</small></span><Badge variant="outline">{entry.voice.name}</Badge></li>)}</ul> : <p className="muted">Chưa có cast sheet cho series này.</p>}</aside>
    </div>
    <section className="queue-list-card studio-editor"><div className="studio-section-heading"><div><p className="eyebrow">Transcript editor</p><h2>{studio.segments.length} đoạn thoại</h2></div><Badge variant={dirty ? 'secondary' : 'outline'}>{dirty ? 'Chưa lưu thay đổi' : 'Đã đồng bộ'}</Badge></div><div className="studio-editor-layout"><nav className="studio-segment-list" aria-label="Danh sách segment">{studio.segments.map((item) => <button key={item.id} type="button" aria-current={item.id === selected?.id ? 'true' : undefined} className={item.id === selected?.id ? 'is-active' : ''} onClick={() => setSelectedId(item.id)}><span>{String(item.ordinal).padStart(2, '0')}</span><span>{item.revision?.translatedText || 'Chưa có bản dịch'}</span><Badge variant="outline">{item.revision?.status ?? 'MISSING'}</Badge></button>)}</nav>{selected && <div className="studio-segment-form"><div className="studio-segment-meta"><Badge variant="outline">{formatDuration(selected.sourceStartMs)}–{formatDuration(selected.sourceEndMs)}</Badge><span>Revision {selected.revision?.revision ?? '—'}</span><span>{selected.revision?.voice.name ?? 'Chưa có voice'}</span></div><label><span>Bản dịch</span><Textarea aria-label="Bản dịch segment" value={selectedText} onChange={(event) => setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} rows={5} /></label>{actionError(save.error ?? preview.error ?? regenerate.error) && <Alert variant="destructive"><AlertTitle>Không thể hoàn tất thao tác</AlertTitle><AlertDescription>{actionError(save.error ?? preview.error ?? regenerate.error)}</AlertDescription></Alert>}<div className="studio-form-actions"><Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}><SaveIcon />{save.isPending ? 'Đang lưu…' : save.isError ? 'Thử lưu lại' : 'Lưu revision'}</Button><Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || !selected.revision?.preview}><Volume2Icon />{preview.isPending ? 'Đang tạo…' : 'Nghe preview'}</Button><Button variant="outline" onClick={() => regenerate.mutate()} disabled={regenerate.isPending || !studio.capabilities.canRegenerate}><RefreshCwIcon />{regenerate.isError ? 'Thử re-generate lại' : 'Re-generate'}</Button></div></div>}</div></section>
    <section className="queue-list-card studio-review"><div className="studio-section-heading"><div><p className="eyebrow">Review gate</p><h2>Duyệt bản dựng hiện tại</h2></div><Clock3Icon aria-hidden="true" /></div><div className="studio-review-form"><label><span>Quyết định</span><NativeSelect aria-label="Quyết định review" value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as typeof reviewDecision)}><NativeSelectOption value="APPROVED">Approve</NativeSelectOption><NativeSelectOption value="CHANGES_REQUESTED">Yêu cầu chỉnh sửa</NativeSelectOption><NativeSelectOption value="REJECTED">Reject</NativeSelectOption></NativeSelect></label><label><span>Ghi chú</span><Input aria-label="Ghi chú review" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Tuỳ chọn" /></label><Button onClick={() => review.mutate()} disabled={review.isPending || hasUnsavedChanges}><CheckCircle2Icon />{review.isPending ? 'Đang lưu…' : 'Lưu review'}</Button></div></section>
  </div>;
}

function formatDuration(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function liveStatus(state: string, fetching: boolean) { if (fetching) return 'Đang đồng bộ trạng thái'; if (state === 'open') return 'Cập nhật trực tiếp'; if (state === 'reconnecting' || state === 'connecting') return 'Đang kết nối cập nhật'; return 'Tự động kiểm tra khi đang xử lý'; }
function actionError(error: unknown) { if (!error) return ''; if (error instanceof StudioApiError && error.code === 'VERSION_CONFLICT') return 'Studio đã có phiên bản mới. Dữ liệu mới nhất đã được tải; bản nháp của bạn vẫn được giữ để thử lưu lại.'; return error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.'; }
function notifyStudioError(error: unknown) { toast.error(actionError(error) || 'Không thể hoàn tất thao tác trong Studio.'); }
function confirmNavigation(event: MouseEvent<HTMLAnchorElement>, dirty: boolean) { if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Rời Studio và bỏ các thay đổi này?')) event.preventDefault(); }
