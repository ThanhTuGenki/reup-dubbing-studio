import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BotIcon, Clock3Icon, DatabaseIcon, PlugZapIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ListState } from '../../../shared/ui/list-state';
import { RuntimeConfigError } from '../../../shared/config/runtime-config';
import {
  saveSettings, SettingsApiError, testContentAgent, testStorage, type SettingsSnapshot,
} from '../api/settings-api';
import { settingsQuery, settingsQueryKey } from '../api/settings-query';
import {
  buildPatch, draftFromSettings, isDirty, validateForSave,
  type FormErrors, type SettingsDraft,
} from '../model/settings-form';

export function SettingsPage() {
  const query = useQuery(settingsQuery());
  if (query.isPending) return <div className="page"><PageHeading /><ListState state="loading" title="Đang tải cài đặt" description="Đang lấy cấu hình mới nhất từ Control Plane…" /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><PageHeading /><ListState state="error" title="Không thể tải cài đặt" description={safeMessage(query.error, 'Không thể tải cài đặt hệ thống.')} action={<Button type="button" variant="outline" onClick={() => void query.refetch()}>Thử lại</Button>} /></div>;
  }
  return <SettingsForm key={query.data.etag} snapshot={query.data} />;
}

function PageHeading() {
  return <header className="settings-heading"><div><p className="eyebrow">Hệ thống</p><h1>Cài đặt hệ thống</h1><p className="lede">Quản lý Content Agent, Cloudflare R2 và thời gian lưu giữ dữ liệu của workspace.</p></div></header>;
}

function SettingsForm({ snapshot }: { snapshot: SettingsSnapshot }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => draftFromSettings(snapshot.settings));
  const [errors, setErrors] = useState<FormErrors>({});
  const dirty = isDirty(snapshot.settings, draft);
  const update = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const saveMutation = useMutation({
    mutationFn: (patch: ReturnType<typeof buildPatch>) => saveSettings({
      etag: snapshot.etag, idempotencyKey: crypto.randomUUID(), patch,
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(settingsQueryKey, next);
      toast.success('Đã lưu cài đặt hệ thống.');
    },
    onError: async (error) => {
      if (error instanceof SettingsApiError && error.code === 'VERSION_CONFLICT') {
        await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
        toast.error('Cài đặt đã thay đổi ở nơi khác. Dữ liệu mới nhất đã được tải lại; hãy áp dụng lại thay đổi.');
      } else toast.error(safeMessage(error, 'Không thể lưu cài đặt.'));
    },
  });
  const contentTest = useMutation({
    mutationFn: () => testContentAgent({
      provider: draft.provider,
      model: draft.model,
      credential: draft.contentSecret
        ? { source: 'PROVIDED', value: draft.contentSecret }
        : { source: 'STORED' },
    }),
    onSuccess: (result) => toast.success(`Content Agent đã kết nối (${result.latencyMs} ms).`),
    onError: (error) => toast.error(safeMessage(error, 'Không thể kết nối Content Agent.')),
  });
  const storageTest = useMutation({
    mutationFn: () => testStorage({
      accountId: draft.accountId,
      bucket: draft.bucket,
      credential: draft.accessKeyId && draft.secretAccessKey
        ? { source: 'PROVIDED', value: { accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey } }
        : { source: 'STORED' },
    }),
    onSuccess: (result) => toast.success(`Cloudflare R2 đã kết nối (${result.latencyMs} ms).`),
    onError: (error) => toast.error(safeMessage(error, 'Không thể kết nối Cloudflare R2.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateForSave(snapshot.settings, draft);
    if (Object.keys(validation).length) { setErrors(validation); return; }
    const patch = buildPatch(snapshot.settings, draft);
    if (!Object.keys(patch).length) return;
    saveMutation.mutate(patch);
  };

  const testAgent = () => {
    const validation = validateForSave(snapshot.settings, draft);
    const next: FormErrors = {};
    if (!/^[A-Za-z0-9._:/-]{1,128}$/u.test(draft.model)) next.model = 'Nhập model hợp lệ trước khi kiểm tra.';
    if (!draft.contentSecret && (!snapshot.settings.contentAgent.credential.configured || draft.clearContentSecret)) next.contentSecret = 'Nhập API key để kiểm tra.';
    if (next.model || next.contentSecret) { setErrors({ ...validation, ...next }); return; }
    contentTest.mutate();
  };
  const testR2 = () => {
    const validation = validateForSave(snapshot.settings, draft);
    const next: FormErrors = {};
    if (!draft.accessKeyId && (!snapshot.settings.storage.credential.configured || draft.clearStorageSecret)) next.accessKeyId = 'Nhập credential R2 để kiểm tra.';
    if (validation.accountId || validation.bucket || validation.accessKeyId || validation.secretAccessKey || next.accessKeyId) {
      setErrors({ ...validation, ...next }); return;
    }
    storageTest.mutate();
  };

  return (
    <form className="page settings-page" onSubmit={submit} noValidate>
      <PageHeading />
      <div className="settings-grid">
        <Card>
          <CardHeader><div className="settings-card-title"><BotIcon aria-hidden="true" /><div><CardTitle>Content Agent</CardTitle><CardDescription>Provider và model dùng để phân tích, biên tập nội dung.</CardDescription></div></div></CardHeader>
          <CardContent><FieldGroup>
            <Field><FieldLabel htmlFor="content-provider">Provider</FieldLabel><Select value={draft.provider} onValueChange={(value) => update('provider', value as SettingsDraft['provider'])}><SelectTrigger id="content-provider" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ANTHROPIC">Anthropic</SelectItem><SelectItem value="OPENAI">OpenAI</SelectItem></SelectContent></Select></Field>
            <Field data-invalid={Boolean(errors.model)}><FieldLabel htmlFor="content-model">Model</FieldLabel><Input id="content-model" value={draft.model} aria-invalid={Boolean(errors.model)} onChange={(event) => update('model', event.target.value)} placeholder="claude-sonnet-5" /><FieldError>{errors.model}</FieldError></Field>
            <Field data-invalid={Boolean(errors.contentSecret)}><FieldLabel htmlFor="content-secret">API key</FieldLabel><Input id="content-secret" type="password" autoComplete="new-password" value={draft.contentSecret} aria-invalid={Boolean(errors.contentSecret)} onChange={(event) => { update('contentSecret', event.target.value); update('clearContentSecret', false); }} placeholder={secretPlaceholder(snapshot.settings.contentAgent.credential)} /><FieldDescription>Để trống để giữ khóa hiện tại. Giá trị mới chỉ được gửi khi lưu hoặc kiểm tra.</FieldDescription><FieldError>{errors.contentSecret}</FieldError></Field>
            <CredentialActions configured={snapshot.settings.contentAgent.credential.configured} cleared={draft.clearContentSecret} label="API key Content Agent" onClear={() => { update('contentSecret', ''); update('clearContentSecret', true); }} onUndo={() => update('clearContentSecret', false)} />
            <Button type="button" variant="outline" onClick={testAgent} disabled={contentTest.isPending}><PlugZapIcon aria-hidden="true" />{contentTest.isPending ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}</Button>
          </FieldGroup></CardContent>
        </Card>

        <Card>
          <CardHeader><div className="settings-card-title"><DatabaseIcon aria-hidden="true" /><div><CardTitle>Cloudflare R2</CardTitle><CardDescription>Kho object production cho video và asset nghiệp vụ.</CardDescription></div></div></CardHeader>
          <CardContent><FieldGroup>
            <Field data-invalid={Boolean(errors.accountId)}><FieldLabel htmlFor="storage-account">Account ID</FieldLabel><Input id="storage-account" value={draft.accountId} aria-invalid={Boolean(errors.accountId)} onChange={(event) => update('accountId', event.target.value.trim())} /><FieldError>{errors.accountId}</FieldError></Field>
            <Field data-invalid={Boolean(errors.bucket)}><FieldLabel htmlFor="storage-bucket">Bucket</FieldLabel><Input id="storage-bucket" value={draft.bucket} aria-invalid={Boolean(errors.bucket)} onChange={(event) => update('bucket', event.target.value.trim())} /><FieldError>{errors.bucket}</FieldError></Field>
            <div className="settings-two-columns"><Field data-invalid={Boolean(errors.accessKeyId)}><FieldLabel htmlFor="storage-access-key">Access Key ID</FieldLabel><Input id="storage-access-key" type="password" autoComplete="new-password" value={draft.accessKeyId} aria-invalid={Boolean(errors.accessKeyId)} onChange={(event) => { update('accessKeyId', event.target.value); update('clearStorageSecret', false); }} placeholder={secretPlaceholder(snapshot.settings.storage.credential)} /><FieldError>{errors.accessKeyId}</FieldError></Field><Field data-invalid={Boolean(errors.secretAccessKey)}><FieldLabel htmlFor="storage-secret-key">Secret Access Key</FieldLabel><Input id="storage-secret-key" type="password" autoComplete="new-password" value={draft.secretAccessKey} aria-invalid={Boolean(errors.secretAccessKey)} onChange={(event) => { update('secretAccessKey', event.target.value); update('clearStorageSecret', false); }} placeholder={snapshot.settings.storage.credential.configured ? 'Đã lưu · ••••••••' : 'Chưa cấu hình'} /><FieldError>{errors.secretAccessKey}</FieldError></Field></div>
            <CredentialActions configured={snapshot.settings.storage.credential.configured} cleared={draft.clearStorageSecret} label="credential Cloudflare R2" onClear={() => { update('accessKeyId', ''); update('secretAccessKey', ''); update('clearStorageSecret', true); }} onUndo={() => update('clearStorageSecret', false)} />
            <Button type="button" variant="outline" onClick={testR2} disabled={storageTest.isPending}><PlugZapIcon aria-hidden="true" />{storageTest.isPending ? 'Đang kiểm tra…' : 'Kiểm tra bucket'}</Button>
          </FieldGroup></CardContent>
        </Card>

        <Card className="settings-retention-card">
          <CardHeader><div className="settings-card-title"><Clock3Icon aria-hidden="true" /><div><CardTitle>Chính sách lưu giữ</CardTitle><CardDescription>Số ngày dữ liệu đủ điều kiện được dọn dẹp.</CardDescription></div></div></CardHeader>
          <CardContent><div className="settings-retention-grid">
            <DayField id="raw-video-days" label="Video gốc" field="rawVideoDays" max={365} draft={draft} errors={errors} update={update} />
            <DayField id="intermediate-days" label="File trung gian" field="intermediateDays" max={90} draft={draft} errors={errors} update={update} />
            <DayField id="task-log-days" label="Task log" field="taskLogDays" max={365} draft={draft} errors={errors} update={update} />
            <DayField id="final-output-days" label="Output cuối" field="finalOutputDays" max={3650} draft={draft} errors={errors} update={update} />
          </div></CardContent>
        </Card>
      </div>
      {saveMutation.isError && <Alert variant="destructive"><AlertTitle>Không thể lưu cài đặt</AlertTitle><AlertDescription>{safeMessage(saveMutation.error, 'Vui lòng thử lại.')}{saveMutation.error instanceof SettingsApiError && saveMutation.error.requestId ? ` Mã hỗ trợ: ${saveMutation.error.requestId}` : ''}</AlertDescription></Alert>}
      <div className="settings-action-bar"><span aria-live="polite">{dirty ? 'Có thay đổi chưa lưu' : 'Mọi thay đổi đã được lưu'}</span><div><Button type="button" variant="outline" disabled={!dirty || saveMutation.isPending} onClick={() => { setDraft(draftFromSettings(snapshot.settings)); setErrors({}); }}><RotateCcwIcon aria-hidden="true" />Hủy thay đổi</Button><Button type="submit" disabled={!dirty || saveMutation.isPending}>{saveMutation.isPending ? <Spinner aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}{saveMutation.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}</Button></div></div>
    </form>
  );
}

function CredentialActions({ configured, cleared, label, onClear, onUndo }: { configured: boolean; cleared: boolean; label: string; onClear: () => void; onUndo: () => void }) {
  if (!configured) return null;
  if (cleared) return <Alert><AlertTitle>Sẽ xóa khi lưu</AlertTitle><AlertDescription><Button type="button" variant="link" className="h-auto p-0" onClick={onUndo}>Hoàn tác xóa {label}</Button></AlertDescription></Alert>;
  return <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" className="justify-self-start text-destructive"><Trash2Icon aria-hidden="true" />Xóa khóa đã lưu</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa {label}?</AlertDialogTitle><AlertDialogDescription>Integration sẽ ngừng hoạt động sau khi bạn lưu thay đổi này.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Giữ lại</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onClear}>Xác nhận xóa</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function DayField({ id, label, field, max, draft, errors, update }: { id: string; label: string; field: 'rawVideoDays' | 'intermediateDays' | 'taskLogDays' | 'finalOutputDays'; max: number; draft: SettingsDraft; errors: FormErrors; update: <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void }) {
  return <Field data-invalid={Boolean(errors[field])}><FieldLabel htmlFor={id}>{label}</FieldLabel><div className="settings-day-input"><Input id={id} inputMode="numeric" value={draft[field]} aria-invalid={Boolean(errors[field])} onChange={(event) => update(field, event.target.value)} /><span>ngày</span></div><FieldDescription>Từ 1 đến {max} ngày.</FieldDescription><FieldError>{errors[field]}</FieldError></Field>;
}

function secretPlaceholder(credential: SettingsSnapshot['settings']['contentAgent']['credential']) {
  return credential.configured ? `Đã lưu · ••••${credential.hint ?? ''}` : 'Chưa cấu hình';
}

function safeMessage(error: unknown, fallback: string) {
  return error instanceof SettingsApiError || error instanceof RuntimeConfigError ? error.message : fallback;
}
