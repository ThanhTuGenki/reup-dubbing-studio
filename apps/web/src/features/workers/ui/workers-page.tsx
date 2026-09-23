import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWorker, Worker, WorkerImage, WorkerObservedStatus, WorkerRole } from '@reup-dubbing-studio/api-client';
import { AlertTriangleIcon, CheckIcon, Clock3Icon, CopyIcon, PlusIcon, RefreshCwIcon, ShieldAlertIcon } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useQueryInvalidationStream } from '@/shared/api/use-query-invalidation-stream';
import { ListState } from '@/shared/ui/list-state';
import { DISPLAY_TIMEZONE, toVietnamDateTimeInput, vietnamDateTimeInputToIso } from '@/shared/lib/display-time';
import { useQuerySelection } from '@/shared/lib/use-query-selection';
import { addWorker, confirmTermination, requestDrain, workerEventsUrl, WorkersApiError, type CreateWorkerResult } from '../api/workers-api';
import { workerImagesQuery, workerKeys, workerQuery, workersQuery } from '../api/workers-query';

const EMPTY_ID = '00000000-0000-7000-8000-000000000000';

export function WorkersPage() {
  const client = useQueryClient();
  const list = useQuery(workersQuery());
  const images = useQuery(workerImagesQuery());
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreateWorkerResult | null>(null);
  const [selected, setSelected] = useQuerySelection('workerId');
  const [pendingAction, setPendingAction] = useState<{ kind: 'drain' | 'terminate'; worker: Worker } | null>(null);
  const actionKeys = useRef(new Map<string, string>());
  useQueryInvalidationStream({ url: workerEventsUrl(), queryKeys: [workerKeys.all], eventName: 'worker.invalidate', enabled: typeof EventSource !== 'undefined' });
  const workers = list.data?.items ?? [];

  const action = useMutation({
    mutationFn: async (value: { kind: 'drain' | 'terminate'; worker: Worker }) => {
      const mapKey = `${value.kind}:${value.worker.id}:${value.worker.version}`;
      const key = actionKeys.current.get(mapKey) ?? crypto.randomUUID();
      actionKeys.current.set(mapKey, key);
      return value.kind === 'drain' ? requestDrain(value.worker, key) : confirmTermination(value.worker, key);
    },
    onSuccess: async (worker, variables) => {
      actionKeys.current.clear();
      client.setQueryData(workerKeys.detail(worker.id), worker);
      await client.invalidateQueries({ queryKey: workerKeys.list() });
      setPendingAction(null);
      toast.success(variables.kind === 'drain' ? 'Worker đã ngừng nhận job mới.' : 'Đã kết thúc phiên thuê và giữ lại lịch sử chi phí.');
    },
    onError: async (error) => {
      if (error instanceof WorkersApiError && error.code === 'VERSION_CONFLICT') await client.invalidateQueries({ queryKey: workerKeys.all });
      toast.error(error instanceof WorkersApiError ? error.message : 'Không thể cập nhật worker.');
    },
  });

  return <div className="page workers-page">
    <header className="workers-heading"><div><p className="eyebrow">Hạ tầng GPU</p><h1>GPU Workers</h1><p className="lede">Theo dõi capacity, heartbeat và kết thúc rental đúng thứ tự an toàn.</p></div><div className="workers-heading-actions"><Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}><RefreshCwIcon className={list.isFetching ? 'animate-spin' : ''} />Làm mới</Button><Button onClick={() => setAdding(true)}><PlusIcon />Thêm GPU Worker</Button></div></header>
    <Alert className="workers-policy"><ShieldAlertIcon /><AlertTitle>Rental được quản lý thủ công</AlertTitle><AlertDescription>Ứng dụng không thuê, dừng hoặc xóa máy trên EzyCloudX. Hãy drain worker, chờ <code>SAFE_TO_TERMINATE</code>, tự xóa rental tại nhà cung cấp rồi quay lại xác nhận.</AlertDescription></Alert>
    {list.isPending ? <ListState state="loading" title="Đang tải GPU Workers" description="Đang đọc trạng thái heartbeat mới nhất…" /> : list.isError ? <ListState state="error" title="Không thể tải GPU Workers" description="Kiểm tra kết nối Control Plane rồi thử lại." action={<Button onClick={() => void list.refetch()}>Thử lại</Button>} /> : !workers.length ? <ListState state="empty" title="Chưa có GPU Worker" description="Thuê máy ở nhà cung cấp trước, sau đó đăng ký worker và dùng enrollment token một lần." action={<Button onClick={() => setAdding(true)}>Thêm GPU Worker</Button>} /> : <WorkerGroups workers={workers} onSelect={setSelected} onAction={(kind, worker) => setPendingAction({ kind, worker })} />}
    <AddWorkerDialog open={adding} images={images.data ?? []} imagesLoading={images.isPending} onOpenChange={(open) => { setAdding(open); if (!open) setCreated(null); }} created={created} onCreated={async (result) => { setCreated(result); await client.invalidateQueries({ queryKey: workerKeys.list() }); }} />
    <WorkerDetail workerId={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    <WorkerActionDialog value={pendingAction} pending={action.isPending} onOpenChange={(open) => { if (!open) setPendingAction(null); }} onConfirm={() => { if (pendingAction) action.mutate(pendingAction); }} />
  </div>;
}

function WorkerGroups({ workers, onSelect, onAction }: { workers: Worker[]; onSelect: (id: string) => void; onAction: (kind: 'drain' | 'terminate', worker: Worker) => void }) {
  const groups: Array<{ role: WorkerRole; title: string; description: string }> = [
    { role: 'BATCH_MEDIA', title: 'Batch Media Workers', description: 'Xóa hard-sub, ASR, render và xử lý media theo lô.' },
    { role: 'INTERACTIVE_TTS', title: 'Interactive TTS Workers', description: 'Phục vụ nghe thử và tạo giọng có độ trễ thấp.' },
  ];
  return <div className="worker-groups">{groups.map((group) => { const items = workers.filter((item) => item.role === group.role); return <section key={group.role} className="worker-group" aria-labelledby={`worker-${group.role}`}><div className="worker-group-heading"><div><h2 id={`worker-${group.role}`}>{group.title}</h2><p>{group.description}</p></div><Badge variant="outline">{items.length} worker</Badge></div>{items.length ? <div className="worker-grid">{items.map((worker) => <WorkerCard key={worker.id} worker={worker} onSelect={onSelect} onAction={onAction} />)}</div> : <p className="worker-group-empty">Chưa có worker nào trong nhóm này.</p>}</section>; })}</div>;
}

function WorkerCard({ worker, onSelect, onAction }: { worker: Worker; onSelect: (id: string) => void; onAction: (kind: 'drain' | 'terminate', worker: Worker) => void }) {
  const capacity = numericCapacity(worker.currentSession?.capacity);
  const utilization = capacity.total > 0 ? Math.round(((capacity.total - capacity.available) / capacity.total) * 100) : 0;
  const gpu = firstGpu(worker);
  const billing = record(worker.billing);
  const canDrain = worker.desiredStatus === 'ACTIVE' && ['READY', 'BUSY'].includes(worker.observedStatus);
  const canTerminate = worker.safeToTerminate || worker.desiredStatus === 'REVOKED' && worker.activeLeaseCount === 0;
  return <Card className={`worker-card status-${statusTone(worker.observedStatus)}`}>
    <CardHeader><div className="worker-card-title"><div><CardTitle>{worker.displayName}</CardTitle><code>{shortId(worker.id)}</code></div><StatusBadge status={worker.observedStatus} /></div></CardHeader>
    <CardContent className="worker-card-content"><div className="worker-capacity"><div><strong>{capacity.available}<span>/{capacity.total || '—'}</span></strong><small>slot khả dụng</small></div><Progress value={utilization} aria-label={`Capacity đang dùng ${utilization}%`} /><span>{utilization}% đang dùng · {worker.currentSession?.currentTaskCount ?? 0} task</span></div><dl className="worker-metrics"><Metric label="GPU" value={gpu.model} /><Metric label="VRAM" value={gpu.vram} /><Metric label="Heartbeat" value={worker.currentSession ? relativeTime(worker.currentSession.lastHeartbeatAt) : 'Chưa kết nối'} /><Metric label="Image" value={`${worker.approvedImage.semanticVersion} · contract ${worker.approvedImage.contractVersion}`} mono /><Metric label="Rental" value={providerLabel(worker)} /><Metric label="Chi phí ước tính" value={billingCost(billing)} /></dl>{worker.observedStatus === 'DRAINING' && <p className="worker-note">Đang chờ {worker.activeLeaseCount} active lease hoàn tất upload và commit output.</p>}{worker.observedStatus === 'OFFLINE' && <p className="worker-note is-danger">Mất heartbeat. Kiểm tra container tại {worker.provider}; ứng dụng không thể tự khởi động lại máy.</p>}{worker.safeToTerminate && <p className="worker-note is-safe"><CheckIcon />Không còn active lease. Rental an toàn để xóa thủ công.</p>}{worker.lastError && <p className="worker-note is-danger">{safeText(record(worker.lastError).detail) || 'Worker báo lỗi tương thích hoặc runtime.'}</p>}</CardContent>
    <CardFooter className="worker-actions">{canDrain && <Button size="sm" variant="outline" onClick={() => onAction('drain', worker)}>Dừng nhận job</Button>}{canTerminate && <Button size="sm" variant="outline" onClick={() => onAction('terminate', worker)}>Đã xóa rental</Button>}<Button size="sm" variant="ghost" onClick={() => onSelect(worker.id)}>Xem chi tiết</Button></CardFooter>
  </Card>;
}

function AddWorkerDialog({ open, images, imagesLoading, created, onOpenChange, onCreated }: { open: boolean; images: WorkerImage[]; imagesLoading: boolean; created: CreateWorkerResult | null; onOpenChange: (open: boolean) => void; onCreated: (result: CreateWorkerResult) => Promise<void> }) {
  const [role, setRole] = useState<WorkerRole>('BATCH_MEDIA');
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const activeImages = images.filter((image) => image.role === role && image.status === 'ACTIVE');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const vramGb = optionalNumber(data.get('expectedVramGb'));
    const input: CreateWorker = { displayName: required(data, 'displayName'), role, provider: required(data, 'provider'), approvedImageId: required(data, 'approvedImageId'), hourlyRateCp: required(data, 'hourlyRateCp'), billingStartedAt: vietnamDateTimeInputToIso(required(data, 'billingStartedAt')), ...(optional(data, 'providerInstanceId') ? { providerInstanceId: optional(data, 'providerInstanceId') } : {}), ...(optional(data, 'expectedGpuModel') ? { expectedGpuModel: optional(data, 'expectedGpuModel') } : {}), ...(vramGb !== null ? { expectedVramMb: Math.round(vramGb * 1024) } : {}), ...(optional(data, 'paidVndPerCp') ? { paidVndPerCp: optional(data, 'paidVndPerCp') } : {}) };
    setSubmitting(true);
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    try { await onCreated(await addWorker(input, request.current.key)); request.current = null; toast.success('Đã đăng ký worker. Token chỉ hiển thị trong bước này.'); } catch (error) { toast.error(error instanceof WorkersApiError ? error.message : 'Không thể thêm worker.'); } finally { setSubmitting(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="worker-add-dialog sm:max-w-2xl"><DialogHeader><DialogTitle>{created ? 'Lưu enrollment token ngay' : 'Thêm GPU Worker'}</DialogTitle><DialogDescription>{created ? 'Token không thể đọc lại sau khi đóng cửa sổ này. Không gửi token qua log hoặc URL.' : 'Đăng ký rental đã thuê thủ công và chọn đúng image đã được duyệt.'}</DialogDescription></DialogHeader>{created ? <EnrollmentSecret result={created} /> : <form id="add-worker-form" className="worker-form" onSubmit={(event) => void submit(event)}><label><span>Tên hiển thị</span><Input name="displayName" required maxLength={120} placeholder="batch-a100-01" /></label><label><span>Vai trò</span><NativeSelect value={role} onChange={(event) => setRole(event.target.value as WorkerRole)}><NativeSelectOption value="BATCH_MEDIA">Batch Media</NativeSelectOption><NativeSelectOption value="INTERACTIVE_TTS">Interactive TTS</NativeSelectOption></NativeSelect></label><label><span>Nhà cung cấp</span><Input name="provider" required defaultValue="EzyCloudX" /></label><label><span>Mã rental/container</span><Input name="providerInstanceId" placeholder="Tùy chọn" /></label><label><span>GPU dự kiến</span><Input name="expectedGpuModel" placeholder="NVIDIA A100" /></label><label><span>VRAM tối thiểu (GB)</span><Input name="expectedVramGb" type="number" min="0" step="1" placeholder="24" /></label><label className="worker-form-full"><span>Approved image</span><NativeSelect name="approvedImageId" required disabled={imagesLoading || !activeImages.length} defaultValue=""><NativeSelectOption value="" disabled>{imagesLoading ? 'Đang tải image…' : activeImages.length ? 'Chọn image' : 'Chưa có image phù hợp'}</NativeSelectOption>{activeImages.map((image) => <NativeSelectOption key={image.id} value={image.id}>{image.registryRef} · {image.semanticVersion}</NativeSelectOption>)}</NativeSelect></label><label><span>Đơn giá (CP/giờ)</span><Input name="hourlyRateCp" type="number" min="0" step="0.000001" required placeholder="6500" /></label><label><span>Quy đổi VND/CP</span><Input name="paidVndPerCp" type="number" min="0" step="0.00000001" placeholder="1" /></label><label className="worker-form-full"><span>Bắt đầu tính phí</span><Input name="billingStartedAt" type="datetime-local" required defaultValue={localDateTime()} /></label></form>}<DialogFooter>{created ? <Button onClick={() => onOpenChange(false)}>Tôi đã lưu token</Button> : <><Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Hủy</Button><Button type="submit" form="add-worker-form" disabled={submitting || !activeImages.length}>{submitting ? 'Đang tạo…' : 'Tạo worker và token'}</Button></>}</DialogFooter></DialogContent></Dialog>;
}

function EnrollmentSecret({ result }: { result: CreateWorkerResult }) {
  if (!result.enrollment.secretAvailable || !result.enrollment.token) return <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Token không còn khả dụng</AlertTitle><AlertDescription>Request đã được replay an toàn. Hãy phát token mới từ worker để lấy secret mới.</AlertDescription></Alert>;
  const copy = async () => { await navigator.clipboard.writeText(result.enrollment.token ?? ''); toast.success('Đã copy enrollment token.'); };
  return <div className="worker-secret"><Alert><Clock3Icon /><AlertTitle>Token dùng một lần · hết hạn sau 15 phút</AlertTitle><AlertDescription>Chỉ đặt token trong header enrollment của Worker Agent. Không lưu trong source, lịch sử lệnh hoặc file cấu hình lâu dài.</AlertDescription></Alert><div><code>{result.enrollment.token}</code><Button variant="outline" onClick={() => void copy()}><CopyIcon />Copy token</Button></div><p>Image: <code>{result.worker.approvedImage.registryRef}</code></p><p>Hết hạn: {result.enrollment.expiresAt ? formatDate(result.enrollment.expiresAt) : 'Không xác định'}</p></div>;
}

function WorkerDetail({ workerId, onOpenChange }: { workerId: string | null; onOpenChange: (open: boolean) => void }) {
  const detail = useQuery({ ...workerQuery(workerId ?? EMPTY_ID), enabled: Boolean(workerId) });
  const worker = detail.data;
  const capacity = worker?.currentSession?.capacity ?? {};
  const telemetry = record(worker?.currentSession?.telemetry);
  return <Sheet open={Boolean(workerId)} onOpenChange={onOpenChange}><SheetContent className="worker-detail-sheet overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{worker?.displayName ?? 'Chi tiết worker'}</SheetTitle><SheetDescription>Runtime snapshot an toàn từ heartbeat mới nhất.</SheetDescription></SheetHeader>{detail.isPending ? <ListState state="loading" title="Đang tải chi tiết" description="Đang đọc version mới nhất…" /> : worker ? <div className="worker-detail"><div className="worker-detail-status"><StatusBadge status={worker.observedStatus} /><Badge variant="outline">Version {worker.version}</Badge><Badge variant="outline">{roleLabel(worker.role)}</Badge></div><DetailSection title="Registry"><Metric label="Worker ID" value={worker.id} mono /><Metric label="Desired status" value={worker.desiredStatus} mono /><Metric label="Nhà cung cấp" value={providerLabel(worker)} /><Metric label="Image digest" value={worker.approvedImage.imageDigest} mono /></DetailSection><Separator /><DetailSection title="Session và capacity"><Metric label="Heartbeat" value={worker.currentSession ? `${formatDate(worker.currentSession.lastHeartbeatAt)} · ${relativeTime(worker.currentSession.lastHeartbeatAt)}` : 'Chưa có session'} /><Metric label="Agent" value={worker.currentSession?.agentVersion ?? '—'} mono /><Metric label="Active lease" value={String(worker.activeLeaseCount)} /><Metric label="Capacity" value={compactJson(capacity)} mono /><Metric label="Telemetry" value={compactJson(telemetry)} mono /></DetailSection><Separator /><section><h3>Shutdown an toàn</h3><ol className="worker-steps"><li>Bấm “Dừng nhận job” để chặn lease mới.</li><li>Chờ trạng thái <code>SAFE_TO_TERMINATE</code>; active lease phải bằng 0.</li><li>Mở console {worker.provider}, dừng rồi xóa rental <code>{safeText(worker.providerInstanceId) || shortId(worker.id)}</code>.</li><li>Quay lại và bấm “Đã xóa rental” để đóng billing session. Bản ghi chi phí vẫn được giữ.</li></ol></section></div> : null}</SheetContent></Sheet>;
}

function WorkerActionDialog({ value, pending, onOpenChange, onConfirm }: { value: { kind: 'drain' | 'terminate'; worker: Worker } | null; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const terminating = value?.kind === 'terminate';
  return <AlertDialog open={Boolean(value)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{terminating ? 'Xác nhận đã xóa rental' : 'Dừng nhận job mới?'}</AlertDialogTitle><AlertDialogDescription>{terminating ? `Chỉ xác nhận sau khi bạn đã xóa rental ${value?.worker.providerInstanceId ?? ''} tại ${value?.worker.provider}. Worker chuyển TERMINATED và lịch sử chi phí vẫn được giữ.` : 'Worker sẽ chuyển sang DRAINING. Job hiện tại được hoàn tất và rental chỉ an toàn để xóa khi active lease bằng 0.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={onConfirm}>{terminating ? 'Xác nhận đã xóa rental' : 'Dừng nhận job'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3>{title}</h3><dl className="worker-metrics">{children}</dl></section>; }
function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><dt>{label}</dt><dd className={mono ? 'is-mono' : ''} title={value}>{value}</dd></div>; }
function StatusBadge({ status }: { status: WorkerObservedStatus }) { return <Badge variant="outline" className={`worker-status status-${statusTone(status)}`}>{statusLabel(status)}</Badge>; }
function statusTone(status: WorkerObservedStatus) { if (['READY', 'SAFE_TO_TERMINATE'].includes(status)) return 'ready'; if (['BUSY', 'DRAINING'].includes(status)) return 'busy'; if (['OFFLINE', 'ERROR'].includes(status)) return 'danger'; if (status === 'TERMINATED') return 'muted'; return 'pending'; }
function statusLabel(status: WorkerObservedStatus) { return ({ PENDING: 'Chờ enrollment', READY: 'Sẵn sàng', BUSY: 'Đang bận', DRAINING: 'Đang dừng an toàn', SAFE_TO_TERMINATE: 'Có thể tắt máy', OFFLINE: 'Mất kết nối', TERMINATED: 'Đã kết thúc', ERROR: 'Lỗi' } as const)[status]; }
function roleLabel(role: WorkerRole) { return role === 'BATCH_MEDIA' ? 'Batch Media' : 'Interactive TTS'; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function safeText(value: unknown) { return typeof value === 'string' ? value : ''; }
function safeNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function numericCapacity(value: unknown) { const data = record(value); const total = safeNumber(data.totalSlots ?? data.total ?? data.capacity); const available = safeNumber(data.availableSlots ?? data.available ?? data.free); return { total, available: Math.min(total, available) }; }
function firstGpu(worker: Worker) { const inventory = worker.currentSession?.gpuInventory; const gpu = Array.isArray(inventory) ? record(inventory[0]) : {}; const model = safeText(gpu.model) || safeText(worker.expectedGpuModel) || 'Chờ worker báo về'; const vramMb = safeNumber(gpu.vramMb) || safeNumber(worker.expectedVramMb); return { model, vram: vramMb ? `${(vramMb / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} GB` : '—' }; }
function billingCost(data: Record<string, unknown>) { const cp = Number(data.estimatedCostCp); const vnd = Number(data.paidVndPerCp); if (!Number.isFinite(cp)) return '—'; return vnd > 0 ? `${Math.round(cp * vnd).toLocaleString('vi-VN')} ₫ (ước tính)` : `${cp.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} CP`; }
function providerLabel(worker: Worker) { return [worker.provider, safeText(worker.providerInstanceId)].filter(Boolean).join(' · '); }
function relativeTime(value: string) { const seconds = Math.max(0, Math.round((Date.now() - new Date(value).valueOf()) / 1000)); if (seconds < 60) return `${seconds} giây trước`; const minutes = Math.round(seconds / 60); if (minutes < 60) return `${minutes} phút trước`; return `${Math.round(minutes / 60)} giờ trước`; }
function formatDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: DISPLAY_TIMEZONE }).format(new Date(value)); }
function shortId(value: string) { return value.slice(0, 8).toUpperCase(); }
function compactJson(value: unknown) { const data = record(value); return Object.keys(data).length ? JSON.stringify(data) : '—'; }
function optional(data: FormData, key: string) { return String(data.get(key) ?? '').trim(); }
function required(data: FormData, key: string) { return optional(data, key); }
function optionalNumber(value: FormDataEntryValue | null) { const text = String(value ?? '').trim(); if (!text) return null; const result = Number(text); return Number.isFinite(result) ? result : null; }
function localDateTime() { return toVietnamDateTimeInput(new Date()); }
