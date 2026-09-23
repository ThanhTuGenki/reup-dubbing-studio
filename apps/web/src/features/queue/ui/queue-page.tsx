import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueueJob, QueueJobDetail, QueueJobStatus, QueueTask } from '@reup-dubbing-studio/api-client';
import { AlertTriangleIcon, Clock3Icon, ListRestartIcon, RefreshCwIcon, SearchIcon, XCircleIcon } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQueryInvalidationStream } from '@/shared/api/use-query-invalidation-stream';
import { ListState } from '@/shared/ui/list-state';
import { useTransientStreamToast } from '@/shared/ui/use-transient-stream-toast';
import { DISPLAY_TIMEZONE } from '@/shared/lib/display-time';
import { useQuerySelection } from '@/shared/lib/use-query-selection';
import { cancelJob, QueueApiError, queueEventsUrl, retryJob } from '../api/queue-api';
import { queueAttemptsQuery, queueJobQuery, queueJobsQuery, queueKeys } from '../api/queue-query';

const EMPTY_ID = '00000000-0000-7000-8000-000000000000';
type TimeRange = '24h' | '7d' | '30d' | 'all';

export function QueuePage() {
  const client = useQueryClient();
  const [status, setStatus] = useState<QueueJobStatus | 'ALL'>('ALL');
  const [kind, setKind] = useState('ALL');
  const [resource, setResource] = useState('ALL');
  const [range, setRange] = useState<TimeRange>('7d');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useQuerySelection('jobId');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const query = useDeferredValue(search.trim());
  const filters = useMemo(() => ({ ...(status !== 'ALL' ? { status } : {}), ...(kind !== 'ALL' ? { kind } : {}), ...(resource !== 'ALL' ? { resourceClass: resource } : {}), ...(query ? { query } : {}), ...(range !== 'all' ? { createdFrom: new Date(Date.now() - rangeMs(range)).toISOString() } : {}), limit: 20 }), [kind, query, range, resource, status]);
  const list = useInfiniteQuery(queueJobsQuery(filters));
  const jobs = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const detail = useQuery({ ...queueJobQuery(selected ?? EMPTY_ID), enabled: Boolean(selected) });
  const attempts = useQuery({ ...queueAttemptsQuery(selected ?? EMPTY_ID), enabled: Boolean(selected) });
  const actionKeys = useRef(new Map<string, string>());
  const streamState = useQueryInvalidationStream({ url: queueEventsUrl(), queryKeys: [queueKeys.all], eventName: 'queue.invalidate', enabled: typeof EventSource !== 'undefined' });
  useTransientStreamToast({ id: 'queue-event-stream', label: 'hàng đợi', state: streamState });

  const action = useMutation({
    mutationFn: async (kindValue: 'cancel' | 'retry') => {
      if (!detail.data) throw new Error('Queue detail is unavailable');
      const mapKey = `${kindValue}:${detail.data.id}:${detail.data.version}`;
      const key = actionKeys.current.get(mapKey) ?? crypto.randomUUID();
      actionKeys.current.set(mapKey, key);
      return kindValue === 'cancel' ? cancelJob(detail.data, key) : retryJob(detail.data, key);
    },
    onSuccess: async (updated, kindValue) => {
      actionKeys.current.clear();
      client.setQueryData(queueKeys.detail(updated.id), updated);
      await client.invalidateQueries({ queryKey: queueKeys.lists() });
      setConfirmCancel(false);
      toast.success(kindValue === 'cancel' ? 'Đã hủy job.' : 'Đã đưa bước lỗi vào hàng đợi lại.');
    },
    onError: async (error) => {
      if (error instanceof QueueApiError && error.code === 'VERSION_CONFLICT') await client.invalidateQueries({ queryKey: queueKeys.all });
      toast.error(error instanceof QueueApiError ? error.message : 'Không thể cập nhật job.');
    },
  });

  const reset = () => { setStatus('ALL'); setKind('ALL'); setResource('ALL'); setRange('7d'); setSearch(''); };
  return <div className="page queue-page">
    <header className="queue-heading"><div><p className="eyebrow">Vận hành pipeline</p><h1>Hàng đợi xử lý</h1><p className="lede">Theo dõi tiến độ từng job, kiểm tra lịch sử an toàn và xử lý retry hoặc hủy khi cần.</p></div><Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}><RefreshCwIcon className={list.isFetching ? 'animate-spin' : ''} />Làm mới</Button></header>
    <section className="queue-summary" aria-label="Tóm tắt dữ liệu đã tải">{summary(jobs).map((item) => <button key={item.status} type="button" className={status === item.status ? 'is-active' : ''} onClick={() => setStatus(status === item.status ? 'ALL' : item.status)}><span className={`queue-summary-dot status-${tone(item.status)}`} />{statusLabel(item.status)}<strong>{item.count}</strong></button>)}</section>
    <section className="queue-filters" aria-label="Bộ lọc hàng đợi"><label><span>Trạng thái</span><NativeSelect value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><NativeSelectOption value="ALL">Mọi trạng thái</NativeSelectOption>{STATUSES.map((value) => <NativeSelectOption key={value} value={value}>{statusLabel(value)}</NativeSelectOption>)}</NativeSelect></label><label><span>Loại job</span><NativeSelect value={kind} onChange={(event) => setKind(event.target.value)}><NativeSelectOption value="ALL">Mọi loại</NativeSelectOption><NativeSelectOption value="INGEST">Ingest</NativeSelectOption><NativeSelectOption value="FULL_PIPELINE">Toàn pipeline</NativeSelectOption><NativeSelectOption value="RERENDER">Render lại</NativeSelectOption><NativeSelectOption value="REGENERATE_CONTENT">Tạo nội dung lại</NativeSelectOption></NativeSelect></label><label><span>Tài nguyên</span><NativeSelect value={resource} onChange={(event) => setResource(event.target.value)}><NativeSelectOption value="ALL">Mọi tài nguyên</NativeSelectOption><NativeSelectOption value="IO">IO</NativeSelectOption><NativeSelectOption value="CPU">CPU</NativeSelectOption><NativeSelectOption value="GPU_BATCH">GPU batch</NativeSelectOption><NativeSelectOption value="GPU_TTS_INTERACTIVE">GPU TTS</NativeSelectOption><NativeSelectOption value="HUMAN_REVIEW">Người duyệt</NativeSelectOption></NativeSelect></label><label><span>Thời gian</span><NativeSelect value={range} onChange={(event) => setRange(event.target.value as TimeRange)}><NativeSelectOption value="24h">24 giờ</NativeSelectOption><NativeSelectOption value="7d">7 ngày</NativeSelectOption><NativeSelectOption value="30d">30 ngày</NativeSelectOption><NativeSelectOption value="all">Mọi thời điểm</NativeSelectOption></NativeSelect></label><label className="queue-search"><span>Tìm kiếm</span><SearchIcon /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tiêu đề hoặc source ID…" /></label><Button variant="outline" onClick={reset}>Đặt lại</Button></section>
    {list.isPending ? <ListState state="loading" title="Đang tải hàng đợi" description="Đang đồng bộ trạng thái mới nhất từ Control Plane…" /> : list.isError ? <ListState state="error" title="Không thể tải hàng đợi" description="Kiểm tra kết nối rồi thử lại." action={<Button onClick={() => void list.refetch()}>Thử lại</Button>} /> : !jobs.length ? <ListState state="empty" title="Chưa có job phù hợp" description="Thay đổi bộ lọc hoặc tạo job từ màn hình Khám phá video." /> : <QueueList jobs={jobs} onSelect={setSelected} />}
    {list.hasNextPage && <div className="queue-load-more"><Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}</Button></div>}
    <JobSheet job={detail.data} attempts={attempts.data ?? []} open={Boolean(selected)} loading={detail.isPending} attemptsLoading={attempts.isPending} pending={action.isPending} onOpenChange={(open) => { if (!open) setSelected(null); }} onRetry={() => action.mutate('retry')} onCancel={() => setConfirmCancel(true)} />
    <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xác nhận hủy job</AlertDialogTitle><AlertDialogDescription>Job sẽ dừng ở điểm an toàn gần nhất. Thao tác này không xóa output đã có và không quản lý máy GPU thuê bên ngoài.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={action.isPending} onClick={() => action.mutate('cancel')}>Hủy job</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function QueueList({ jobs, onSelect }: { jobs: QueueJob[]; onSelect: (id: string) => void }) { return <section className="queue-list-card"><div className="queue-list-header"><div><strong>Danh sách job</strong><span> · {jobs.length} job đã tải</span></div></div><div className="queue-table"><Table><TableHeader><TableRow><TableHead>Video</TableHead><TableHead>Profile</TableHead><TableHead>Bước hiện tại</TableHead><TableHead>Trạng thái</TableHead><TableHead>Tiến độ</TableHead><TableHead>Cập nhật</TableHead><TableHead><span className="sr-only">Thao tác</span></TableHead></TableRow></TableHeader><TableBody>{jobs.map((job) => <TableRow key={job.id}><TableCell><div className="queue-video"><strong>{job.title || 'Video chưa có tiêu đề'}</strong><code>{shortId(job.videoId)} · {shortId(job.id)}</code></div></TableCell><TableCell>{job.seriesProfileName || job.channelProfileName || 'Chưa đặt tên'}</TableCell><TableCell><TaskLabel task={job.currentTask} /></TableCell><TableCell><JobStatus status={job.status} /></TableCell><TableCell><div className="queue-progress"><Progress value={job.progress.percent} aria-label={`Tiến độ ${job.progress.percent}%`} /><span>{job.progress.percent}% · {job.progress.completedTasks}/{job.progress.totalTasks}</span></div></TableCell><TableCell>{formatDate(job.updatedAt)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => onSelect(job.id)}>Chi tiết</Button></TableCell></TableRow>)}</TableBody></Table></div><div className="queue-cards">{jobs.map((job) => <article key={job.id}><div><JobStatus status={job.status} /><code>{shortId(job.id)}</code></div><h2>{job.title || 'Video chưa có tiêu đề'}</h2><p>{job.seriesProfileName || job.channelProfileName || 'Chưa đặt tên'}</p><TaskLabel task={job.currentTask} /><div className="queue-progress"><Progress value={job.progress.percent} aria-label={`Tiến độ ${job.progress.percent}%`} /><span>{job.progress.percent}% · {job.progress.completedTasks}/{job.progress.totalTasks} bước</span></div><Button variant="outline" onClick={() => onSelect(job.id)}>Xem chi tiết</Button></article>)}</div></section>; }

function JobSheet({ job, attempts, open, loading, attemptsLoading, pending, onOpenChange, onRetry, onCancel }: { job: QueueJobDetail | undefined; attempts: Array<{ id: string; taskType: string; attemptNumber: number; status: string; errorDetail: string | null; startedAt: string }>; open: boolean; loading: boolean; attemptsLoading: boolean; pending: boolean; onOpenChange: (open: boolean) => void; onRetry: () => void; onCancel: () => void }) { return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="queue-sheet overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{job ? shortId(job.id) : 'Chi tiết job'}</SheetTitle><SheetDescription>{job?.title || 'Task, timeline và attempt an toàn.'}</SheetDescription></SheetHeader>{loading ? <ListState state="loading" title="Đang tải chi tiết" description="Đang lấy version mới nhất…" /> : job ? <div className="queue-detail"><div className="queue-detail-summary"><JobStatus status={job.status} /><Badge variant="outline">Version {job.version}</Badge><span>{job.kind}</span></div>{job.failure && <div className="queue-failure" role="alert"><AlertTriangleIcon /><div><strong>{job.failure.code}</strong><p>{job.failure.detail || 'Job dừng do lỗi không có mô tả bổ sung.'}</p></div></div>}<section><h3>Tiến độ pipeline</h3><div className="queue-task-list">{job.tasks.map((taskValue) => <article key={taskValue.id}><span className={`queue-task-dot status-${taskTone(taskValue.status)}`}><Clock3Icon /></span><div><strong>{taskLabel(taskValue.taskType)}</strong><span>{taskStatusLabel(taskValue.status)}{taskValue.progressDetail ? ` · ${taskValue.progressDetail}` : ''}</span></div><span>{taskValue.progressPercent}%</span></article>)}</div></section><Separator /><section><h3>Timeline</h3>{job.timeline.length ? <div className="queue-timeline">{job.timeline.map((event) => <article key={event.id}><span /><div><strong>{eventLabel(event.eventType)}</strong><p>{event.message || [event.fromStatus, event.toStatus].filter(Boolean).join(' → ')}</p></div><time>{formatDate(event.occurredAt)}</time></article>)}</div> : <p className="queue-muted">Chưa có sự kiện workflow.</p>}</section><Separator /><section><h3>Attempts</h3>{attemptsLoading ? <p className="queue-muted">Đang tải attempts…</p> : attempts.length ? <div className="queue-attempts">{attempts.map((item) => <article key={item.id}><div><strong>{taskLabel(item.taskType)} · lần {item.attemptNumber}</strong><span>{item.status} · {formatDate(item.startedAt)}</span>{item.errorDetail && <p>{item.errorDetail}</p>}</div></article>)}</div> : <p className="queue-muted">Chưa có attempt nào.</p>}</section></div> : null}{job && <SheetFooter><Button variant="destructive" disabled={!job.actions.canCancel || pending} onClick={onCancel}><XCircleIcon />Hủy job</Button><Button variant="outline" disabled={!job.actions.canRetry || pending} onClick={onRetry}><ListRestartIcon />Retry bước lỗi</Button></SheetFooter>}</SheetContent></Sheet>; }

const STATUSES: QueueJobStatus[] = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
function summary(jobs: QueueJob[]) { return STATUSES.map((status) => ({ status, count: jobs.filter((job) => job.status === status).length })).filter((item) => item.count > 0); }
function rangeMs(value: Exclude<TimeRange, 'all'>) { return { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }[value]; }
function shortId(value: string) { return value.slice(0, 8).toUpperCase(); }
function formatDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: DISPLAY_TIMEZONE }).format(new Date(value)); }
function statusLabel(value: QueueJobStatus) { return ({ QUEUED: 'Đã xếp hàng', RUNNING: 'Đang chạy', WAITING_FOR_GPU: 'Chờ GPU', WAITING_FOR_REVIEW: 'Chờ duyệt', SUCCEEDED: 'Hoàn thành', FAILED: 'Thất bại', CANCELLED: 'Đã hủy' } as const)[value]; }
function tone(value: QueueJobStatus) { return ({ QUEUED: 'waiting', RUNNING: 'running', WAITING_FOR_GPU: 'gpu', WAITING_FOR_REVIEW: 'review', SUCCEEDED: 'done', FAILED: 'failed', CANCELLED: 'cancelled' } as const)[value]; }
function JobStatus({ status }: { status: QueueJobStatus }) { return <Badge variant="outline" className={`queue-status status-${tone(status)}`}>{statusLabel(status)}</Badge>; }
function TaskLabel({ task: value }: { task: QueueTask | null }) { return value ? <div className="queue-current-task"><strong>{taskLabel(value.taskType)}</strong><span>{taskStatusLabel(value.status)}</span></div> : <span className="queue-muted">Chưa có task</span>; }
function taskLabel(value: string) { return ({ DOWNLOAD: 'Tải video', DESUB: 'Xóa hard-sub', TRANSCRIBE_OCR: 'OCR', TRANSCRIBE_ASR: 'ASR', MERGE_TRANSCRIPT: 'Ghép transcript', TRANSLATE: 'Dịch', ASSIGN_CAST: 'Gán cast', GENERATE_INITIAL_TTS: 'Tạo TTS', WAIT_FOR_REVIEW: 'Chờ duyệt', REGENERATE_SEGMENT: 'Tạo lại segment', SEPARATE_AUDIO: 'Tách audio', RENDER: 'Render', EXPORT_SRT: 'Xuất SRT', UPLOAD_OUTPUTS: 'Upload output', GENERATE_PUBLISH_PACKAGE: 'Tạo gói đăng' } as Record<string, string>)[value] ?? value; }
function taskStatusLabel(value: string) { return ({ BLOCKED: 'Bị chặn', READY: 'Sẵn sàng', LEASED: 'Đã giao', RUNNING: 'Đang chạy', WAITING: 'Đang chờ', SUCCEEDED: 'Hoàn thành', FAILED: 'Thất bại', CANCELLED: 'Đã hủy' } as Record<string, string>)[value] ?? value; }
function taskTone(value: string) { return value === 'FAILED' ? 'failed' : value === 'SUCCEEDED' ? 'done' : ['RUNNING', 'LEASED'].includes(value) ? 'running' : 'waiting'; }
function eventLabel(value: string) { return ({ JOB_CANCELLED: 'Đã hủy job', JOB_RETRIED: 'Đã retry bước lỗi' } as Record<string, string>)[value] ?? value.replaceAll('_', ' ').toLowerCase(); }
