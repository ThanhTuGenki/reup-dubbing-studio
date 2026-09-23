import { useQuery } from '@tanstack/react-query';
import type {
  Dashboard,
  DashboardActivityItem,
  DashboardAttentionItem,
} from '@reup-dubbing-studio/api-client';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  Clock3Icon,
  CpuIcon,
  ListTodoIcon,
  RefreshCwIcon,
  UploadIcon,
  VideoIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ListState } from '@/shared/ui/list-state';
import { DISPLAY_TIMEZONE } from '@/shared/lib/display-time';

import { dashboardQuery } from '../api/dashboard-query';

const videoStatuses: Array<{ key: keyof Dashboard['videos']['countsByStatus']; label: string }> = [
  { key: 'PROCESSING', label: 'Đang xử lý' },
  { key: 'AWAITING_REVIEW', label: 'Chờ duyệt' },
  { key: 'READY_TO_PUBLISH', label: 'Sẵn sàng đăng' },
  { key: 'PUBLISHED', label: 'Đã đăng' },
  { key: 'FAILED', label: 'Thất bại' },
];

const quickActions = [
  { href: '/discovery', label: 'Khám phá video', detail: 'Tìm nội dung nguồn mới', icon: WandSparklesIcon },
  { href: '/queue', label: 'Xem hàng đợi', detail: 'Theo dõi job và task', icon: ListTodoIcon },
  { href: '/library', label: 'Mở thư viện', detail: 'Duyệt video trong pipeline', icon: VideoIcon },
  { href: '/publishing', label: 'Bàn đăng bài', detail: 'Hoàn tất luồng đăng thủ công', icon: UploadIcon },
  { href: '/workers', label: 'GPU Workers', detail: 'Kiểm tra capacity và chi phí', icon: CpuIcon },
] as const;

export function DashboardPage() {
  const query = useQuery(dashboardQuery());

  if (query.isPending) {
    return <div className="page dashboard-page"><ListState state="loading" title="Đang tải tổng quan" description="Đang tổng hợp dữ liệu vận hành mới nhất…" /></div>;
  }

  if (query.isError) {
    return <div className="page dashboard-page"><ListState state="error" title="Không thể tải tổng quan" description="Kiểm tra kết nối Control Plane rồi thử lại." action={<Button onClick={() => void query.refetch()}>Thử lại</Button>} /></div>;
  }

  const dashboard = query.data;
  return <div className="page dashboard-page">
    <header className="dashboard-heading">
      <div><p className="eyebrow">Control Plane</p><h1>Tổng quan vận hành</h1><p className="lede">Theo dõi pipeline, việc cần xử lý và chi phí đang mở trong một nơi.</p></div>
      <div className="dashboard-updated"><span>Cập nhật {formatDateTime(dashboard.generatedAt)}</span><Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCwIcon className={query.isFetching ? 'animate-spin' : ''} />Làm mới</Button></div>
    </header>

    <KpiGrid dashboard={dashboard} />

    <div className="dashboard-layout">
      <div className="dashboard-primary">
        <VideoSummary dashboard={dashboard} />
        <AttentionList items={dashboard.attention.items} total={dashboard.attention.total} />
        <ActivityList items={dashboard.recentActivity.items} />
      </div>
      <aside className="dashboard-secondary" aria-label="Thông tin vận hành bổ sung">
        <WorkerCostSummary dashboard={dashboard} />
        <QuickActions />
      </aside>
    </div>
  </div>;
}

function KpiGrid({ dashboard }: { dashboard: Dashboard }) {
  const items = [
    { label: 'Job đang chạy', value: dashboard.queue.running, note: `${dashboard.queue.active} job đang hoạt động`, icon: RefreshCwIcon, tone: 'brand' },
    { label: 'Chờ GPU', value: dashboard.queue.waitingForGpu, note: dashboard.queue.waitingForGpu ? 'Cần kiểm tra capacity' : 'Không có job bị chặn', icon: Clock3Icon, tone: dashboard.queue.waitingForGpu ? 'warning' : 'neutral' },
    { label: 'Video chờ duyệt', value: dashboard.videos.awaitingReview, note: `${dashboard.videos.processing} video đang xử lý`, icon: CheckCircle2Icon, tone: 'neutral' },
    { label: 'Sẵn sàng đăng', value: dashboard.videos.readyToPublish, note: `${dashboard.publishing.upcoming} lịch trong 7 ngày tới`, icon: UploadIcon, tone: 'brand' },
  ];
  return <section className="dashboard-kpis" aria-label="Chỉ số vận hành">{items.map((item) => <Card key={item.label} className={`dashboard-kpi tone-${item.tone}`}><CardContent><div className="dashboard-kpi-icon"><item.icon /></div><div><span>{item.label}</span><strong>{formatInteger(item.value)}</strong><small>{item.note}</small></div></CardContent></Card>)}</section>;
}

function VideoSummary({ dashboard }: { dashboard: Dashboard }) {
  const maximum = Math.max(dashboard.videos.totalActive, 1);
  return <Card className="dashboard-panel"><CardHeader><div><CardTitle>Trạng thái video</CardTitle><p>{formatInteger(dashboard.videos.totalActive)} video đang hoạt động trong pipeline</p></div><Button asChild variant="ghost" size="sm"><Link to="/library">Mở thư viện<ArrowRightIcon /></Link></Button></CardHeader><CardContent className="dashboard-video-statuses">{videoStatuses.map(({ key, label }) => { const value = dashboard.videos.countsByStatus[key]; const percent = Math.round((value / maximum) * 100); return <div key={key} className="dashboard-video-status"><div><span>{label}</span><strong>{formatInteger(value)}</strong></div><Progress value={percent} aria-label={`${label}: ${formatInteger(value)}`} /></div>; })}</CardContent></Card>;
}

function AttentionList({ items, total }: { items: DashboardAttentionItem[]; total: number }) {
  return <Card className="dashboard-panel"><CardHeader><div><CardTitle>Việc cần chú ý</CardTitle><p>Ưu tiên theo mức độ nghiêm trọng và thời điểm phát sinh</p></div>{total > 0 && <Badge variant="outline">{formatInteger(total)} việc</Badge>}</CardHeader><CardContent>{items.length ? <div className="dashboard-feed">{items.map((item) => <Link className="dashboard-feed-item" to={item.href} key={item.id}><span className={`dashboard-feed-icon severity-${item.severity.toLowerCase()}`}><AlertTriangleIcon /></span><span><strong>{item.title}</strong><small>{item.detail}</small><time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time></span><ArrowRightIcon /></Link>)}</div> : <InlineEmpty icon={CheckCircle2Icon} title="Không có việc khẩn cấp" detail="Các nguồn dữ liệu hiện không báo cảnh báo cần xử lý." />}</CardContent></Card>;
}

function ActivityList({ items }: { items: DashboardActivityItem[] }) {
  return <Card className="dashboard-panel"><CardHeader><div><CardTitle>Hoạt động gần đây</CardTitle><p>Sự kiện có ý nghĩa từ queue, audit và publishing</p></div></CardHeader><CardContent>{items.length ? <div className="dashboard-feed dashboard-activity">{items.map((item) => <Link className="dashboard-feed-item" to={item.href} key={item.id}><span className="dashboard-feed-icon"><Clock3Icon /></span><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}<time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time></span><ArrowRightIcon /></Link>)}</div> : <InlineEmpty icon={Clock3Icon} title="Chưa có hoạt động" detail="Hoạt động mới sẽ xuất hiện khi pipeline bắt đầu xử lý." />}</CardContent></Card>;
}

function WorkerCostSummary({ dashboard }: { dashboard: Dashboard }) {
  const cost = dashboard.cost;
  return <Card className="dashboard-panel dashboard-worker-cost"><CardHeader><CardTitle>Worker & chi phí mở</CardTitle></CardHeader><CardContent><dl><Metric label="Worker online" value={formatInteger(dashboard.workers.online)} /><Metric label="Đang bận" value={formatInteger(dashboard.workers.busy)} /><Metric label="Active lease" value={formatInteger(dashboard.workers.activeLeases)} /><Metric label="An toàn để kết thúc" value={formatInteger(dashboard.workers.safeToTerminate)} /></dl><div className="dashboard-cost"><span>Ước tính hiện tại</span><strong>{formatCp(cost.estimatedCostCp)}</strong><small>{formatVnd(cost.estimatedCostVnd, cost.vndCoverage)}</small><Badge variant="outline">{cost.openBillingSessions} phiên billing</Badge></div><Button asChild variant="outline"><Link to="/workers">Xem GPU Workers<ArrowRightIcon /></Link></Button></CardContent></Card>;
}

function QuickActions() {
  return <Card className="dashboard-panel"><CardHeader><CardTitle>Thao tác nhanh</CardTitle></CardHeader><CardContent className="dashboard-quick-actions">{quickActions.map(({ href, label, detail, icon: Icon }) => <Button asChild variant="ghost" key={href}><Link to={href}><Icon /><span><strong>{label}</strong><small>{detail}</small></span><ArrowRightIcon /></Link></Button>)}</CardContent></Card>;
}

function InlineEmpty({ icon: Icon, title, detail }: { icon: typeof Clock3Icon; title: string; detail: string }) {
  return <div className="dashboard-inline-empty"><Icon /><strong>{title}</strong><span>{detail}</span></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatInteger(value: number) { return new Intl.NumberFormat('vi-VN').format(value); }
function formatCp(value: string) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value))} CP`; }
function formatVnd(value: string | null, coverage: Dashboard['cost']['vndCoverage']) {
  if (coverage === 'PARTIAL') return 'Dữ liệu quy đổi VND chỉ có một phần';
  if (value === null || coverage === 'NONE') return 'Chưa đủ tỷ giá để quy đổi VND';
  const formatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value));
  return formatted;
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: DISPLAY_TIMEZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
