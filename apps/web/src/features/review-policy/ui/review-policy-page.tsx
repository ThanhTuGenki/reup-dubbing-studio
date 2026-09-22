import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewGateMode, ReviewPolicy } from '@reup-dubbing-studio/api-client';
import { ArrowLeftIcon, RotateCcwIcon, SaveIcon, ShieldCheckIcon, WorkflowIcon, ZapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { channelDetailQuery, seriesDetailQuery } from '@/features/profiles/api/profiles-query';
import { ListState } from '@/shared/ui/list-state';
import { paths } from '@/app/router/paths';
import { ReviewPolicyApiError, saveReviewPolicy, type ReviewPolicyOwner, type ReviewPolicySnapshot } from '../api/review-policy-api';
import { reviewPolicyQuery } from '../api/review-policy-query';
import {
  buildPolicyPatch, draftFromPolicy, effectiveDraft, gateFields, policyDirty,
  type ReviewPolicyDraft,
} from '../model/review-policy-form';

const EMPTY_ID = '00000000-0000-7000-8000-000000000000';
const modeLabels: Record<ReviewGateMode, string> = {
  MANUAL_REQUIRED: 'Cần duyệt thủ công',
  NOT_REQUIRED: 'Không cần duyệt',
};

export function ReviewPolicyPage() {
  const { ownerType, profileId = '' } = useParams();
  const owner = ownerType === 'channel' || ownerType === 'series' ? ownerType : null;
  const query = useQuery({
    ...reviewPolicyQuery(owner ?? 'channel', owner ? profileId : EMPTY_ID),
    enabled: Boolean(owner && profileId),
  });
  if (!owner || !profileId) return <div className="page"><PolicyHeading /><ListState state="error" title="Đường dẫn chính sách không hợp lệ" description="Mở chính sách từ một Channel hoặc Series Profile." /></div>;
  if (query.isPending) return <div className="page"><PolicyHeading /><ListState state="loading" title="Đang tải chính sách" description="Đang lấy policy và version mới nhất từ Control Plane…" /></div>;
  if (query.isError || !query.data) return <div className="page"><PolicyHeading /><ListState state="error" title="Không thể tải chính sách" description={safeMessage(query.error, 'Control Plane chưa trả về Review Policy.')} action={<Button variant="outline" onClick={() => void query.refetch()}>Thử lại</Button>} /></div>;
  return <ReviewPolicyForm owner={owner} profileId={profileId} snapshot={query.data} refetch={() => query.refetch()} />;
}

function PolicyHeading({ name }: { name?: string }) {
  return <header className="review-policy-heading"><div><p className="eyebrow">Cấu hình nội dung</p><h1>Tự động hóa &amp; điểm duyệt</h1><p className="lede">{name ? `Chính sách cho ${name}.` : 'Quyết định bước nào cần người vận hành duyệt trước khi workflow đi tiếp.'}</p></div></header>;
}

function ReviewPolicyForm({ owner, profileId, snapshot, refetch }: {
  owner: ReviewPolicyOwner;
  profileId: string;
  snapshot: ReviewPolicySnapshot;
  refetch: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channelProfile = useQuery({ ...channelDetailQuery(profileId), enabled: owner === 'channel' });
  const seriesProfile = useQuery({ ...seriesDetailQuery(profileId), enabled: owner === 'series' });
  const profile = owner === 'channel' ? channelProfile.data?.profile : seriesProfile.data?.profile;
  const archived = profile?.status === 'ARCHIVED';
  const voiceMode = profile ? ('pipeline' in profile ? profile.pipeline.voiceMode : profile.effectiveConfig.voiceMode) : null;
  const [draft, setDraft] = useState<ReviewPolicyDraft>(() => draftFromPolicy(snapshot.policy));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const keyRef = useRef(crypto.randomUUID());
  const dirty = policyDirty(snapshot.policy, draft);
  const effective = effectiveDraft(snapshot.policy, draft);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => saveReviewPolicy({
      owner, profileId, etag: snapshot.etag, idempotencyKey: keyRef.current,
      patch: buildPolicyPatch(owner, snapshot.policy, draft),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(reviewPolicyQuery(owner, profileId).queryKey, next);
      setDraft(draftFromPolicy(next.policy));
      keyRef.current = crypto.randomUUID();
      toast.success('Đã áp dụng chính sách cho workflow mới.');
    },
    onError: async (error) => {
      keyRef.current = crypto.randomUUID();
      if (error instanceof ReviewPolicyApiError && error.code === 'VERSION_CONFLICT') {
        await refetch();
        toast.error('Policy đã thay đổi ở nơi khác. Bản nháp của bạn vẫn được giữ; hãy kiểm tra policy hiệu lực rồi lưu lại.');
      } else toast.error(safeMessage(error, 'Không thể lưu chính sách duyệt.'));
    },
  });

  const update = <K extends keyof ReviewPolicyDraft>(key: K, value: ReviewPolicyDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const goBack = () => dirty ? setLeaveOpen(true) : navigate(paths.channelProfiles);

  return <div className="page review-policy-page">
    <div className="review-policy-topline"><PolicyHeading {...(profile?.name ? { name: profile.name } : {})} /><Button type="button" variant="outline" onClick={goBack}><ArrowLeftIcon aria-hidden="true" />Quay lại Hồ sơ</Button></div>
    <ProfileReadiness profile={profile} policy={snapshot.policy} />
    {owner === 'series' && <Alert className="review-policy-inheritance"><WorkflowIcon aria-hidden="true" /><AlertTitle>Series kế thừa theo từng trường</AlertTitle><AlertDescription>Chọn “Kế thừa từ Channel” để reset riêng trường đó về policy của Channel cha. ETag hiện tại gồm cả version policy cha.</AlertDescription></Alert>}
    <div className="review-policy-layout">
      <div className="review-policy-editor">
        <Card><CardHeader><CardTitle>Approval gates</CardTitle><CardDescription>Decision cũ không còn hợp lệ khi subject version thay đổi. Gate không thay thế readiness, license hoặc kiểm tra kỹ thuật.</CardDescription></CardHeader><CardContent className="review-policy-gates">{gateFields.map((field) => <GateField key={field.key} owner={owner} field={field} value={draft[field.key]} disabled={archived || save.isPending} onChange={(value) => update(field.key, value)} />)}</CardContent></Card>
        <Card><CardHeader><div className="review-policy-card-title"><ZapIcon aria-hidden="true" /><div><CardTitle>Tự yêu cầu render</CardTitle><CardDescription>Chỉ tạo render request khi mọi pre-render gate hiệu lực đã pass, không có decision blocking và chưa có render job active.</CardDescription></div></div></CardHeader><CardContent><PolicySelect kind="boolean" owner={owner} ariaLabel="Chế độ tự yêu cầu render" value={draft.autoRequestRender} trueLabel="Bật tự yêu cầu render" falseLabel="Không tự yêu cầu render" disabled={archived || save.isPending} onChange={(value) => update('autoRequestRender', value as boolean | null)} /><p className="review-policy-impact">Render vẫn cần audio sẵn sàng, video version còn khớp và các invariant kỹ thuật. `RENDER` là gate hậu kiểm output, không phải điều kiện tạo job.</p></CardContent></Card>
      </div>
      <EffectivePolicy policy={snapshot.policy} draft={draft} effective={effective} />
    </div>
    {effective.castGate === 'NOT_REQUIRED' && voiceMode === 'MULTI_AUTO' && <Alert variant="destructive"><AlertTitle>Cast MULTI_AUTO không có điểm duyệt</AlertTitle><AlertDescription>Workflow vẫn kiểm tra voice readiness và license, nhưng sẽ không chờ người vận hành duyệt cast sheet. Chỉ lưu khi đây là chủ đích vận hành.</AlertDescription></Alert>}
    {save.isError && !(save.error instanceof ReviewPolicyApiError && save.error.code === 'VERSION_CONFLICT') && <Alert variant="destructive"><AlertTitle>Không thể áp dụng chính sách</AlertTitle><AlertDescription>{safeMessage(save.error, 'Vui lòng thử lại.')}{save.error instanceof ReviewPolicyApiError && save.error.requestId ? ` Mã hỗ trợ: ${save.error.requestId}` : ''}</AlertDescription></Alert>}
    <div className="review-policy-actions"><span aria-live="polite">{archived ? 'Hồ sơ đã lưu trữ — chỉ xem' : dirty ? 'Có thay đổi chưa áp dụng' : 'Policy đang đồng bộ với Control Plane'}</span><div><Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => setDraft(draftFromPolicy(snapshot.policy))}><RotateCcwIcon aria-hidden="true" />Hủy thay đổi</Button><Button type="button" disabled={!dirty || archived || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}{save.isPending ? 'Đang áp dụng…' : 'Áp dụng chính sách'}</Button></div></div>
    <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Còn thay đổi chưa áp dụng</AlertDialogTitle><AlertDialogDescription>Quay lại Hồ sơ bây giờ sẽ bỏ bản nháp policy trên màn hình này.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Ở lại chỉnh tiếp</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => navigate(paths.channelProfiles)}>Bỏ thay đổi &amp; quay lại</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function ProfileReadiness({ profile, policy }: { profile: { name: string; status: string; readiness: string; readinessIssues: string[] } | undefined; policy: ReviewPolicy }) {
  return <Card className="review-policy-readiness"><CardContent><div><Badge variant={profile?.readiness === 'READY' ? 'default' : 'secondary'}>{profile?.status === 'ARCHIVED' ? 'Đã lưu trữ' : profile?.readiness === 'READY' ? 'Sẵn sàng' : 'Cần cấu hình'}</Badge><div><strong>{profile?.name ?? 'Đang tải thông tin hồ sơ…'}</strong><p>{profile?.readiness === 'READY' ? 'Không có lỗi cấu hình profile. Policy dưới đây áp dụng cho các job mới.' : 'Readiness và license vẫn có thể chặn workflow dù gate được đặt “Không cần duyệt”.'}</p></div></div><code>v{policy.version}{policy.parentPolicyVersion ? ` · parent v${policy.parentPolicyVersion}` : ''}</code></CardContent></Card>;
}

function GateField({ owner, field, value, disabled, onChange }: {
  owner: ReviewPolicyOwner;
  field: typeof gateFields[number];
  value: ReviewGateMode | null;
  disabled: boolean;
  onChange: (value: ReviewGateMode | null) => void;
}) {
  return <section className="review-policy-gate"><div><h3>{field.label}</h3><p>{field.description}</p></div><PolicySelect kind="gate" owner={owner} ariaLabel={`Điểm duyệt ${field.label}`} value={value} trueLabel={modeLabels.MANUAL_REQUIRED} falseLabel={modeLabels.NOT_REQUIRED} disabled={disabled} onChange={(next) => onChange(next as ReviewGateMode | null)} /><p className="review-policy-impact">{field.bypassWarning}</p></section>;
}

function PolicySelect({ kind, owner, ariaLabel, value, trueLabel, falseLabel, disabled, onChange }: {
  kind: 'gate' | 'boolean';
  owner: ReviewPolicyOwner;
  ariaLabel: string;
  value: ReviewGateMode | boolean | null;
  trueLabel: string;
  falseLabel: string;
  disabled: boolean;
  onChange: (value: ReviewGateMode | boolean | null) => void;
}) {
  const encoded = value === null ? 'INHERIT' : typeof value === 'boolean' ? String(value) : value;
  const decode = (next: string) => next === 'INHERIT' ? null : next === 'true' ? true : next === 'false' ? false : next as ReviewGateMode;
  return <Select value={encoded} disabled={disabled} onValueChange={(next) => onChange(decode(next))}><SelectTrigger aria-label={ariaLabel}><SelectValue /></SelectTrigger><SelectContent>{owner === 'series' && <SelectItem value="INHERIT">Kế thừa từ Channel</SelectItem>}<SelectItem value={kind === 'boolean' ? 'true' : 'MANUAL_REQUIRED'}>{trueLabel}</SelectItem><SelectItem value={kind === 'boolean' ? 'false' : 'NOT_REQUIRED'}>{falseLabel}</SelectItem></SelectContent></Select>;
}

function EffectivePolicy({ policy, draft, effective }: { policy: ReviewPolicy; draft: ReviewPolicyDraft; effective: ReturnType<typeof effectiveDraft> }) {
  return <aside className="review-policy-effective"><Card><CardHeader><div className="review-policy-card-title"><ShieldCheckIcon aria-hidden="true" /><div><CardTitle>Chính sách hiệu lực</CardTitle><CardDescription>Projection sẽ được snapshot bất biến vào job mới.</CardDescription></div></div></CardHeader><CardContent><dl>{gateFields.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd><span>{modeLabels[effective[key]]}</span><Badge variant={draft[key] === null ? 'secondary' : 'outline'}>{draft[key] === null ? 'Channel' : policy.ownerType === 'SERIES' ? 'Series' : 'Channel'}</Badge></dd></div>)}<div><dt>Tự yêu cầu render</dt><dd><span>{effective.autoRequestRender ? 'Bật' : 'Tắt'}</span><Badge variant={draft.autoRequestRender === null ? 'secondary' : 'outline'}>{draft.autoRequestRender === null ? 'Channel' : policy.ownerType === 'SERIES' ? 'Series' : 'Channel'}</Badge></dd></div></dl><Alert><AlertTitle>Chỉ tác động workflow mới</AlertTitle><AlertDescription>Job đang chạy giữ nguyên policy snapshot đã chụp lúc tạo.</AlertDescription></Alert></CardContent></Card></aside>;
}

function safeMessage(error: unknown, fallback: string) { return error instanceof ReviewPolicyApiError ? error.message : fallback; }
