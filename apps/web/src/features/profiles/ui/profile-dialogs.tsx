import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChannelProfile } from '@reup-dubbing-studio/api-client';
import { SaveIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  addChannelProfile, addSeriesProfile, fetchMaskPreview, ProfilesApiError,
  saveChannelProfile, saveSeriesProfile, uploadMaskReference,
  type ChannelSnapshot, type SeriesSnapshot,
} from '../api/profiles-api';
import { profileKeys } from '../api/profiles-query';
import {
  buildChannelCreate, buildChannelUpdate, buildSeriesCreate, buildSeriesUpdate,
  channelDraft, emptyChannelDraft, emptySeriesDraft, seriesDraft,
  validateChannelDraft, validateSeriesDraft,
  type ChannelDraft, type ProfileFormErrors, type SeriesDraft, type SeriesField,
} from '../model/profile-form';
import { MaskEditor } from './mask-editor';

export function ChannelProfileDialog({ open, snapshot, onOpenChange }: {
  open: boolean; snapshot: ChannelSnapshot | null; onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ChannelDraft>(() => snapshot ? channelDraft(snapshot.profile) : emptyChannelDraft());
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  useEffect(() => { if (open) { setDraft(snapshot ? channelDraft(snapshot.profile) : emptyChannelDraft()); setErrors({}); } }, [open, snapshot]);
  const mutation = useMutation({
    mutationFn: () => snapshot
      ? saveChannelProfile(snapshot.profile.id, snapshot.etag, buildChannelUpdate(draft, snapshot.profile))
      : addChannelProfile(buildChannelCreate(draft)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.success(snapshot ? 'Đã lưu Channel Profile.' : 'Đã tạo Channel Profile.'); onOpenChange(false);
    },
    onError: async (error) => {
      if (error instanceof ProfilesApiError && error.code === 'PROFILE_VERSION_CONFLICT') await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.error(message(error, 'Không thể lưu Channel Profile.'));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault(); const next = validateChannelDraft(draft); setErrors(next);
    if (!Object.keys(next).length) mutation.mutate();
  };
  const update = <K extends keyof ChannelDraft>(key: K, value: ChannelDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="profile-dialog sm:max-w-3xl"><form onSubmit={submit} noValidate><DialogHeader><DialogTitle>{snapshot ? 'Sửa Channel Profile' : 'Tạo Channel Profile'}</DialogTitle><DialogDescription>Defaults dùng trực tiếp cho video lẻ và làm nền cho mọi Series thuộc kênh.</DialogDescription></DialogHeader><div className="profile-dialog-body"><FieldGroup>
    <div className="profile-form-grid"><TextField id="channel-name" label="Tên hồ sơ" value={draft.name} error={errors.name} onChange={(value) => update('name', value)} /><SelectField label="Trạng thái" value={draft.status} onChange={(value) => update('status', value as ChannelDraft['status'])} disabled={!snapshot}><SelectItem value="DRAFT">Bản nháp</SelectItem><SelectItem value="ACTIVE">Hoạt động</SelectItem></SelectField></div>
    <Accordion type="multiple" defaultValue={['pipeline', 'content']}>
      <AccordionItem value="pipeline"><AccordionTrigger>Cấu hình pipeline và subtitle</AccordionTrigger><AccordionContent className="profile-form-grid">
        <TextField id="channel-target-language" label="Ngôn ngữ đích" value={draft.targetLanguage} error={errors.targetLanguage} onChange={(value) => update('targetLanguage', value)} />
        <TextField id="channel-subtitle-language" label="Ngôn ngữ subtitle" value={draft.subtitleLanguage} error={errors.subtitleLanguage} onChange={(value) => update('subtitleLanguage', value)} />
        <TextField id="channel-filename-rule" label="Quy tắc tên SRT" value={draft.subtitleFilenameRule} error={errors.subtitleFilenameRule} onChange={(value) => update('subtitleFilenameRule', value)} />
        <TextField id="channel-line-length" label="Ký tự tối đa mỗi dòng" inputMode="numeric" value={draft.subtitleMaxLineLength} error={errors.subtitleMaxLineLength} onChange={(value) => update('subtitleMaxLineLength', value)} />
        <TextField id="channel-voice-id" label="Default Voice Profile ID" value={draft.defaultVoiceProfileId} error={errors.defaultVoiceProfileId} onChange={(value) => update('defaultVoiceProfileId', value)} description="Có thể để trống cho tới khi Thư viện giọng được cấu hình." />
        <SelectField label="Voice mode" value={draft.voiceMode} onChange={(value) => update('voiceMode', value as ChannelDraft['voiceMode'])}><SelectItem value="SINGLE">Một giọng</SelectItem><SelectItem value="DUAL">Hai giọng</SelectItem><SelectItem value="MULTI_AUTO">Tự động nhiều giọng</SelectItem></SelectField>
        <TextField id="channel-tts-speed" label="Tốc độ TTS" inputMode="decimal" value={draft.ttsSpeed} error={errors.ttsSpeed} onChange={(value) => update('ttsSpeed', value)} />
        <SelectField label="Timing policy" value={draft.timingPolicy} onChange={(value) => update('timingPolicy', value as ChannelDraft['timingPolicy'])}><SelectItem value="PRESERVE_SEGMENT">Giữ segment</SelectItem><SelectItem value="FIT_SEGMENT">Fit segment</SelectItem><SelectItem value="ALLOW_DRIFT">Cho phép lệch</SelectItem></SelectField>
        <Field className="profile-form-full"><div className="profile-inline-heading"><div><FieldLabel htmlFor="channel-remove-hard-sub">Xóa hard-sub</FieldLabel><FieldDescription>Mặc định tắt cho MVP. Chỉ bật khi video cần xóa subtitle dính trên hình.</FieldDescription></div><Switch id="channel-remove-hard-sub" checked={draft.removeHardSubEnabled} onCheckedChange={(checked) => update('removeHardSubEnabled', checked)} /></div></Field>
        <div className="profile-output-options"><Check label="Output 16:9" checked={draft.output16x9Enabled} onChange={(value) => update('output16x9Enabled', value)} /><Check label="Output 9:16" checked={draft.output9x16Enabled} onChange={(value) => update('output9x16Enabled', value)} />{errors.outputs && <FieldError>{errors.outputs}</FieldError>}</div>
      </AccordionContent></AccordionItem>
      <AccordionItem value="content"><AccordionTrigger>Content Agent và destination</AccordionTrigger><AccordionContent className="profile-form-grid">
        <Field className="profile-form-full"><FieldLabel htmlFor="channel-cta">CTA template</FieldLabel><Textarea id="channel-cta" value={draft.ctaTemplate} onChange={(event) => update('ctaTemplate', event.target.value)} /></Field>
        <TextField id="channel-keywords" label="Từ khóa cơ sở" value={draft.baseKeywords} onChange={(value) => update('baseKeywords', value)} description="Phân cách bằng dấu phẩy." />
        <div />
        <TextField id="youtube-name" label="YouTube channel" value={draft.youtubeName} onChange={(value) => update('youtubeName', value)} />
        <TextField id="youtube-id" label="YouTube external ID" value={draft.youtubeExternalId} onChange={(value) => update('youtubeExternalId', value)} />
        <TextField id="facebook-name" label="Facebook Page" value={draft.facebookName} onChange={(value) => update('facebookName', value)} />
        <TextField id="facebook-id" label="Facebook external ID" value={draft.facebookExternalId} onChange={(value) => update('facebookExternalId', value)} />
      </AccordionContent></AccordionItem>
    </Accordion>
  </FieldGroup></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <Spinner /> : <SaveIcon />}{mutation.isPending ? 'Đang lưu…' : 'Lưu hồ sơ'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function SeriesProfileDialog({ open, snapshot, channels, initialChannelId, onOpenChange }: {
  open: boolean; snapshot: SeriesSnapshot | null; channels: ChannelProfile[]; initialChannelId?: string; onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SeriesDraft>(() => snapshot ? seriesDraft(snapshot.profile) : emptySeriesDraft(initialChannelId));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setDraft(snapshot ? seriesDraft(snapshot.profile) : emptySeriesDraft(initialChannelId)); setErrors({}); setFile(null); setPreviewUrl(undefined);
    const link = snapshot?.profile.assets.find((item) => item.role === 'MASK_REFERENCE_FRAME');
    if (snapshot && link) void fetchMaskPreview(snapshot.profile.id, link.linkId).then((grant) => setPreviewUrl(grant.url)).catch(() => undefined);
  }, [initialChannelId, open, snapshot]);
  const channelRemoveHardSubEnabled = channels.find((item) => item.id === draft.channelProfileId)?.pipeline.removeHardSubEnabled ?? false;
  const effectiveRemoveHardSubEnabled = draft.overridden.has('removeHardSubEnabled')
    ? draft.removeHardSubEnabled
    : channelRemoveHardSubEnabled;
  const mutation = useMutation({
    mutationFn: async () => {
      const saved = snapshot
        ? await saveSeriesProfile(snapshot.profile.id, snapshot.etag, buildSeriesUpdate(draft))
        : await addSeriesProfile(buildSeriesCreate(draft));
      if (file) {
        const dimensions = await imageDimensions(file);
        await uploadMaskReference({ profileId: saved.profile.id, etag: saved.etag, file, ...dimensions });
      }
      return saved;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.success(snapshot ? 'Đã lưu Series Profile.' : 'Đã tạo Series Profile.'); onOpenChange(false);
    },
    onError: async (error) => {
      if (error instanceof ProfilesApiError && error.code === 'PROFILE_VERSION_CONFLICT') await queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast.error(message(error, 'Không thể lưu Series Profile.'));
    },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); const next = validateSeriesDraft({ ...draft, removeHardSubEnabled: effectiveRemoveHardSubEnabled }); setErrors(next); if (!Object.keys(next).length) mutation.mutate(); };
  const update = (patch: Partial<SeriesDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const toggleOverride = (field: SeriesField, checked: boolean) => setDraft((current) => {
    const overridden = new Set(current.overridden); if (checked) overridden.add(field); else overridden.delete(field);
    return field === 'removeHardSubEnabled' && checked
      ? { ...current, overridden, removeHardSubEnabled: channelRemoveHardSubEnabled }
      : { ...current, overridden };
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="profile-dialog sm:max-w-4xl"><form onSubmit={submit} noValidate><DialogHeader><DialogTitle>{snapshot ? 'Sửa Series Profile' : 'Tạo Series Profile'}</DialogTitle><DialogDescription>Chỉ bật ghi đè cho giá trị thật sự khác Channel cha; phần còn lại luôn theo cấu hình mới nhất của Channel.</DialogDescription></DialogHeader><div className="profile-dialog-body"><FieldGroup>
    <div className="profile-form-grid"><TextField id="series-name" label="Tên series" value={draft.name} error={errors.name} onChange={(name) => update({ name })} /><SelectField label="Channel cha" value={draft.channelProfileId} onChange={(channelProfileId) => update({ channelProfileId })} disabled={Boolean(snapshot)} error={errors.channelProfileId}>{channels.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectField><SelectField label="Trạng thái" value={draft.status} onChange={(status) => update({ status: status as SeriesDraft['status'] })} disabled={!snapshot}><SelectItem value="DRAFT">Bản nháp</SelectItem><SelectItem value="ACTIVE">Hoạt động</SelectItem></SelectField></div>
    <Accordion type="multiple" defaultValue={['overrides', 'mask']}>
      <AccordionItem value="overrides"><AccordionTrigger>Cấu hình kế thừa và ghi đè</AccordionTrigger><AccordionContent className="series-override-grid">
        <OverrideField label="Ngôn ngữ đích" field="targetLanguage" draft={draft} onToggle={toggleOverride}><Input value={draft.targetLanguage} disabled={!draft.overridden.has('targetLanguage')} onChange={(event) => update({ targetLanguage: event.target.value })} /></OverrideField>
        <OverrideField label="Default Voice ID" field="defaultVoiceProfileId" draft={draft} onToggle={toggleOverride} error={errors.defaultVoiceProfileId}><Input value={draft.defaultVoiceProfileId} disabled={!draft.overridden.has('defaultVoiceProfileId')} onChange={(event) => update({ defaultVoiceProfileId: event.target.value })} /></OverrideField>
        <OverrideField label="Voice mode" field="voiceMode" draft={draft} onToggle={toggleOverride}><Select value={draft.voiceMode} disabled={!draft.overridden.has('voiceMode')} onValueChange={(voiceMode) => update({ voiceMode: voiceMode as SeriesDraft['voiceMode'] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SINGLE">Một giọng</SelectItem><SelectItem value="DUAL">Hai giọng</SelectItem><SelectItem value="MULTI_AUTO">Tự động nhiều giọng</SelectItem></SelectContent></Select></OverrideField>
        <OverrideField label="Ngôn ngữ subtitle" field="subtitleLanguage" draft={draft} onToggle={toggleOverride} error={errors.subtitleLanguage}><Input value={draft.subtitleLanguage} disabled={!draft.overridden.has('subtitleLanguage')} onChange={(event) => update({ subtitleLanguage: event.target.value })} /></OverrideField>
        <OverrideField label="Quy tắc tên SRT" field="subtitleFilenameRule" draft={draft} onToggle={toggleOverride} error={errors.subtitleFilenameRule}><Input value={draft.subtitleFilenameRule} disabled={!draft.overridden.has('subtitleFilenameRule')} onChange={(event) => update({ subtitleFilenameRule: event.target.value })} /></OverrideField>
        <OverrideField label="Ký tự tối đa mỗi dòng" field="subtitleMaxLineLength" draft={draft} onToggle={toggleOverride} error={errors.subtitleMaxLineLength}><Input inputMode="numeric" value={draft.subtitleMaxLineLength} disabled={!draft.overridden.has('subtitleMaxLineLength')} onChange={(event) => update({ subtitleMaxLineLength: event.target.value })} /></OverrideField>
        <OverrideField label="Tốc độ TTS" field="ttsSpeed" draft={draft} onToggle={toggleOverride} error={errors.ttsSpeed}><Input value={draft.ttsSpeed} disabled={!draft.overridden.has('ttsSpeed')} onChange={(event) => update({ ttsSpeed: event.target.value })} /></OverrideField>
        <OverrideField label="Timing policy" field="timingPolicy" draft={draft} onToggle={toggleOverride}><Select value={draft.timingPolicy} disabled={!draft.overridden.has('timingPolicy')} onValueChange={(timingPolicy) => update({ timingPolicy: timingPolicy as SeriesDraft['timingPolicy'] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PRESERVE_SEGMENT">Giữ segment</SelectItem><SelectItem value="FIT_SEGMENT">Fit segment</SelectItem><SelectItem value="ALLOW_DRIFT">Cho phép lệch</SelectItem></SelectContent></Select></OverrideField>
        <OverrideField label="Xóa hard-sub" field="removeHardSubEnabled" draft={draft} onToggle={toggleOverride}><Switch aria-label="Xóa hard-sub cho Series" checked={effectiveRemoveHardSubEnabled} disabled={!draft.overridden.has('removeHardSubEnabled')} onCheckedChange={(checked) => update({ removeHardSubEnabled: checked })} /></OverrideField>
        <OverrideField label="Output 16:9" field="output16x9Enabled" draft={draft} onToggle={toggleOverride}><Checkbox checked={draft.output16x9Enabled} disabled={!draft.overridden.has('output16x9Enabled')} onCheckedChange={(value) => update({ output16x9Enabled: value === true })} /></OverrideField>
        <OverrideField label="Output 9:16" field="output9x16Enabled" draft={draft} onToggle={toggleOverride}><Checkbox checked={draft.output9x16Enabled} disabled={!draft.overridden.has('output9x16Enabled')} onCheckedChange={(value) => update({ output9x16Enabled: value === true })} /></OverrideField>
        {errors.outputs && <FieldError className="profile-form-full">{errors.outputs}</FieldError>}
      </AccordionContent></AccordionItem>
      <AccordionItem value="mask"><AccordionTrigger>Reference frame và mask editor</AccordionTrigger><AccordionContent><MaskEditor draft={draft} removeHardSubEnabled={effectiveRemoveHardSubEnabled} error={errors.mask} previewUrl={previewUrl} onChange={update} onFile={(nextFile, url) => { setFile(nextFile); if (url) setPreviewUrl(url); }} /></AccordionContent></AccordionItem>
    </Accordion>
  </FieldGroup></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <Spinner /> : <SaveIcon />}{mutation.isPending ? 'Đang lưu và upload…' : 'Lưu series'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function TextField({ id, label, value, error, description, inputMode, onChange }: { id: string; label: string; value: string; error?: string | undefined; description?: string | undefined; inputMode?: 'numeric' | 'decimal' | undefined; onChange: (value: string) => void }) {
  return <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} value={value} {...(inputMode ? { inputMode } : {})} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />{description && <FieldDescription>{description}</FieldDescription>}<FieldError>{error}</FieldError></Field>;
}
function SelectField({ label, value, disabled, error, onChange, children }: { label: string; value: string; disabled?: boolean | undefined; error?: string | undefined; onChange: (value: string) => void; children: ReactNode }) {
  return <Field data-invalid={Boolean(error)}><FieldLabel>{label}</FieldLabel><Select value={value} {...(disabled !== undefined ? { disabled } : {})} onValueChange={onChange}><SelectTrigger className="w-full" aria-invalid={Boolean(error)}><SelectValue placeholder="Chọn…" /></SelectTrigger><SelectContent>{children}</SelectContent></Select><FieldError>{error}</FieldError></Field>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="profile-check"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} /><span>{label}</span></label>;
}
function OverrideField({ label, field, draft, error, onToggle, children }: { label: string; field: SeriesField; draft: SeriesDraft; error?: string | undefined; onToggle: (field: SeriesField, checked: boolean) => void; children: ReactNode }) {
  const active = draft.overridden.has(field);
  return <Field data-invalid={Boolean(error)} className="override-field"><div className="override-field-heading"><FieldLabel>{label}</FieldLabel><label><span>{active ? 'Ghi đè' : 'Kế thừa'}</span><Switch checked={active} onCheckedChange={(checked) => onToggle(field, checked)} /></label></div>{children}<FieldError>{error}</FieldError></Field>;
}
function message(error: unknown, fallback: string) { return error instanceof ProfilesApiError ? error.message : fallback; }
async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}
