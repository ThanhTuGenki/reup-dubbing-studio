import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelProfile, ProfileStatus, SeriesProfile } from '@reup-dubbing-studio/api-client';
import { ArchiveIcon, PlusIcon, RotateCcwIcon, SearchIcon, Settings2Icon, SlidersHorizontalIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListState } from '@/shared/ui/list-state';
import { changeChannelArchive, changeSeriesArchive, ProfilesApiError, type ChannelSnapshot, type SeriesSnapshot } from '../api/profiles-api';
import { channelDetailQuery, channelsQuery, profileKeys, seriesDetailQuery, seriesListQuery, type ProfileFilters } from '../api/profiles-query';
import { ChannelProfileDialog, SeriesProfileDialog } from './profile-dialogs';

type Kind = 'channels' | 'series';
const EMPTY_PROFILE_ID = '00000000-0000-7000-8000-000000000000';

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>('channels');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ProfileStatus | 'ALL'>('ALL');
  const [channelId, setChannelId] = useState('ALL');
  const [channelDialog, setChannelDialog] = useState(false);
  const [seriesDialog, setSeriesDialog] = useState(false);
  const [selected, setSelected] = useState<{ kind: Kind; id: string } | null>(null);

  const channelFilters: ProfileFilters = { query, status };
  const seriesFilters: ProfileFilters = { query, status, ...(channelId !== 'ALL' ? { channelProfileId: channelId } : {}) };
  const channelList = useInfiniteQuery(channelsQuery(channelFilters));
  const seriesList = useInfiniteQuery(seriesListQuery(seriesFilters));
  const channels = useMemo(() => channelList.data?.pages.flatMap((page) => page.items) ?? [], [channelList.data]);
  const series = useMemo(() => seriesList.data?.pages.flatMap((page) => page.items) ?? [], [seriesList.data]);

  const channelDetail = useQuery({ ...channelDetailQuery(selected?.kind === 'channels' ? selected.id : EMPTY_PROFILE_ID), enabled: selected?.kind === 'channels' });
  const seriesDetail = useQuery({ ...seriesDetailQuery(selected?.kind === 'series' ? selected.id : EMPTY_PROFILE_ID), enabled: selected?.kind === 'series' });
  const currentSnapshot = selected?.kind === 'channels' ? channelDetail.data : seriesDetail.data;
  const archive = useMutation({
    mutationFn: async () => {
      if (!selected || !currentSnapshot) throw new Error('Profile chưa tải xong.');
      const action = currentSnapshot.profile.status === 'ARCHIVED' ? 'restore' : 'archive';
      return selected.kind === 'channels'
        ? changeChannelArchive(selected.id, currentSnapshot.etag, action)
        : changeSeriesArchive(selected.id, currentSnapshot.etag, action);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.success(currentSnapshot?.profile.status === 'ARCHIVED' ? 'Đã khôi phục hồ sơ.' : 'Đã lưu trữ hồ sơ.');
      setSelected(null);
    },
    onError: async (error) => {
      if (error instanceof ProfilesApiError && error.code === 'PROFILE_VERSION_CONFLICT') await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.error(error instanceof ProfilesApiError ? error.message : 'Không thể cập nhật hồ sơ.');
    },
  });

  const active = kind === 'channels' ? channelList : seriesList;
  const items = kind === 'channels' ? channels : series;
  const openCreate = () => kind === 'channels' ? setChannelDialog(true) : setSeriesDialog(true);
  const edit = () => selected?.kind === 'channels' ? setChannelDialog(true) : setSeriesDialog(true);

  return <div className="page profiles-page">
    <header className="profiles-heading"><div><p className="eyebrow">Cấu hình</p><h1>Channel &amp; Series Profiles</h1><p className="lede">Quản lý defaults theo kênh, override theo series và vùng mask subtitle dùng trong pipeline.</p></div><Button onClick={openCreate}><PlusIcon />Tạo {kind === 'channels' ? 'Channel' : 'Series'}</Button></header>
    <Tabs value={kind} onValueChange={(value) => { setKind(value as Kind); setSelected(null); }}><TabsList><TabsTrigger value="channels">Channel Profiles</TabsTrigger><TabsTrigger value="series">Series Profiles</TabsTrigger></TabsList></Tabs>
    <section className="profiles-toolbar" aria-label="Bộ lọc hồ sơ">
      <div className="profiles-search"><SearchIcon aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên…" aria-label="Tìm hồ sơ" /></div>
      <Select value={status} onValueChange={(value) => setStatus(value as ProfileStatus | 'ALL')}><SelectTrigger aria-label="Lọc trạng thái"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Mọi trạng thái</SelectItem><SelectItem value="DRAFT">Bản nháp</SelectItem><SelectItem value="ACTIVE">Hoạt động</SelectItem><SelectItem value="ARCHIVED">Đã lưu trữ</SelectItem></SelectContent></Select>
      {kind === 'series' && <Select value={channelId} onValueChange={setChannelId}><SelectTrigger aria-label="Lọc Channel cha"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Mọi Channel</SelectItem>{channels.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>}
    </section>
    {active.isPending ? <ListState state="loading" title="Đang tải profiles" description="Đang đồng bộ cấu hình mới nhất từ Control Plane…" />
      : active.isError ? <ListState state="error" title="Không thể tải profiles" description="Control Plane chưa trả về danh sách hồ sơ." action={<Button variant="outline" onClick={() => void active.refetch()}>Thử lại</Button>} />
        : !items.length ? <ListState state="empty" title="Chưa có hồ sơ phù hợp" description="Thay đổi bộ lọc hoặc tạo hồ sơ đầu tiên." action={<Button onClick={openCreate}><PlusIcon />Tạo hồ sơ</Button>} />
          : <ProfileTable kind={kind} channels={channels} series={series} onSelect={(id) => setSelected({ kind, id })} />}
    {active.hasNextPage && <div className="profiles-load-more"><Button variant="outline" disabled={active.isFetchingNextPage} onClick={() => void active.fetchNextPage()}>{active.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}</Button></div>}
    <ProfileSheet selected={selected} snapshot={currentSnapshot} loading={selected?.kind === 'channels' ? channelDetail.isPending : seriesDetail.isPending} onOpenChange={(open) => { if (!open) setSelected(null); }} onEdit={edit} onArchive={() => archive.mutate()} archivePending={archive.isPending} />
    <ChannelProfileDialog open={channelDialog} snapshot={selected?.kind === 'channels' ? channelDetail.data ?? null : null} onOpenChange={setChannelDialog} />
    <SeriesProfileDialog open={seriesDialog} snapshot={selected?.kind === 'series' ? seriesDetail.data ?? null : null} channels={channels} {...(channelId !== 'ALL' ? { initialChannelId: channelId } : {})} onOpenChange={setSeriesDialog} />
  </div>;
}

function ProfileTable({ kind, channels, series, onSelect }: { kind: Kind; channels: ChannelProfile[]; series: SeriesProfile[]; onSelect: (id: string) => void }) {
  const rows = kind === 'channels' ? channels : series;
  const channelNames = new Map(channels.map((item) => [item.id, item.name]));
  return <div className="profiles-table"><Table><TableHeader><TableRow><TableHead>Tên hồ sơ</TableHead>{kind === 'series' && <TableHead>Channel cha</TableHead>}<TableHead>Trạng thái</TableHead><TableHead>Sẵn sàng</TableHead><TableHead>Cập nhật</TableHead></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id} tabIndex={0} onClick={() => onSelect(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(item.id); }} className="cursor-pointer"><TableCell className="font-medium">{item.name}</TableCell>{kind === 'series' && <TableCell>{channelNames.get((item as SeriesProfile).channelProfileId) ?? '—'}</TableCell>}<TableCell><StatusBadge status={item.status} /></TableCell><TableCell><ReadinessBadge readiness={item.readiness} /></TableCell><TableCell>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(item.updatedAt))}</TableCell></TableRow>)}</TableBody></Table></div>;
}

function ProfileSheet({ selected, snapshot, loading, onOpenChange, onEdit, onArchive, archivePending }: { selected: { kind: Kind; id: string } | null; snapshot?: ChannelSnapshot | SeriesSnapshot | undefined; loading: boolean; onOpenChange: (open: boolean) => void; onEdit: () => void; onArchive: () => void; archivePending: boolean }) {
  return <Sheet open={Boolean(selected)} onOpenChange={onOpenChange}><SheetContent className="profile-sheet overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{snapshot?.profile.name ?? 'Chi tiết hồ sơ'}</SheetTitle><SheetDescription>{selected?.kind === 'channels' ? 'Defaults của Channel Profile' : 'Cấu hình hiệu lực và nguồn kế thừa của Series'}</SheetDescription></SheetHeader>{loading ? <div className="p-4"><ListState state="loading" title="Đang tải chi tiết" description="Đang lấy phiên bản mới nhất…" /></div> : snapshot ? <ProfileDetails snapshot={snapshot} /> : <div className="p-4"><ListState state="error" title="Không thể tải chi tiết" description="Đóng bảng chi tiết và thử lại." /></div>}{snapshot && selected && <SheetFooter><Button variant="outline" onClick={onArchive} disabled={archivePending}>{snapshot.profile.status === 'ARCHIVED' ? <RotateCcwIcon /> : <ArchiveIcon />}{snapshot.profile.status === 'ARCHIVED' ? 'Khôi phục' : 'Lưu trữ'}</Button><Button variant="outline" asChild><Link to={`/channel-profiles/${selected.kind === 'channels' ? 'channel' : 'series'}/${selected.id}/review-policy`}><SlidersHorizontalIcon />Điểm duyệt</Link></Button>{snapshot.profile.status !== 'ARCHIVED' && <Button onClick={onEdit}><Settings2Icon />Chỉnh sửa</Button>}</SheetFooter>}</SheetContent></Sheet>;
}

function ProfileDetails({ snapshot }: { snapshot: ChannelSnapshot | SeriesSnapshot }) {
  const profile = snapshot.profile;
  const config = 'effectiveConfig' in profile ? profile.effectiveConfig : profile.pipeline;
  const labels: Array<[keyof typeof config, string]> = [['targetLanguage', 'Ngôn ngữ đích'], ['defaultVoiceProfileId', 'Voice mặc định'], ['voiceMode', 'Voice mode'], ['subtitleLanguage', 'Ngôn ngữ subtitle'], ['subtitleFilenameRule', 'Tên file SRT'], ['subtitleMaxLineLength', 'Độ dài dòng'], ['ttsSpeed', 'Tốc độ TTS'], ['timingPolicy', 'Timing policy'], ['output16x9Enabled', 'Output 16:9'], ['output9x16Enabled', 'Output 9:16']];
  return <div className="profile-details"><div className="profile-detail-summary"><StatusBadge status={profile.status} /><ReadinessBadge readiness={profile.readiness} /><span>Version {profile.version}</span></div><dl>{labels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatValue(config[key])}{'inheritance' in profile && <Badge variant={profile.inheritance[key] === 'SERIES' ? 'default' : 'secondary'}>{profile.inheritance[key] === 'SERIES' ? 'Ghi đè' : 'Kế thừa'}</Badge>}</dd></div>)}</dl>{'mask' in profile && <section><h3>Mask subtitle</h3><p>{profile.mask ? `x ${profile.mask.x} · y ${profile.mask.y} · rộng ${profile.mask.width} · cao ${profile.mask.height}` : 'Không sử dụng mask.'}</p></section>}{profile.readinessIssues.length > 0 && <section><h3>Cần cấu hình</h3><ul>{profile.readinessIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}</div>;
}

function StatusBadge({ status }: { status: ProfileStatus }) { return <Badge variant="outline">{{ DRAFT: 'Bản nháp', ACTIVE: 'Hoạt động', ARCHIVED: 'Đã lưu trữ' }[status]}</Badge>; }
function ReadinessBadge({ readiness }: { readiness: 'READY' | 'NEEDS_CONFIGURATION' }) { return <Badge variant={readiness === 'READY' ? 'default' : 'secondary'}>{readiness === 'READY' ? 'Sẵn sàng' : 'Cần cấu hình'}</Badge>; }
function formatValue(value: unknown) { if (value === null || value === '') return 'Chưa đặt'; if (typeof value === 'boolean') return value ? 'Bật' : 'Tắt'; return String(value); }
