import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SaveIcon, UploadIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { addVoice, saveVoice, uploadVoiceSample, VoicesApiError, type VoiceSnapshot } from '../api/voices-api';
import { voiceKeys } from '../api/voices-query';
import { buildVoiceCreate, buildVoiceUpdate, emptyVoiceDraft, validateVoiceDraft, voiceDraft, type VoiceDraft, type VoiceFormErrors } from '../model/voice-form';

export function VoiceDialog({ open, snapshot, onOpenChange }: { open: boolean; snapshot: VoiceSnapshot | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient(); const [draft, setDraft] = useState<VoiceDraft>(() => snapshot ? voiceDraft(snapshot.profile) : emptyVoiceDraft()); const [errors, setErrors] = useState<VoiceFormErrors>({});
  const [file, setFile] = useState<File | null>(null); const [transcript, setTranscript] = useState(''); const [sampleLanguage, setSampleLanguage] = useState('vi'); const [duration, setDuration] = useState('');
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : undefined, [file]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);
  useEffect(() => { if (open) { const next = snapshot ? voiceDraft(snapshot.profile) : emptyVoiceDraft(); setDraft(next); setErrors({}); setFile(null); setTranscript(''); setSampleLanguage(next.primaryLanguage); setDuration(''); } }, [open, snapshot]);
  const mutation = useMutation({
    mutationFn: async () => {
      const saved = snapshot ? await saveVoice(snapshot.profile.id, snapshot.etag, buildVoiceUpdate(draft)) : await addVoice(buildVoiceCreate(draft));
      if (file) await uploadVoiceSample({ voiceId: saved.profile.id, etag: saved.etag, file, language: sampleLanguage, transcript: transcript.trim(), durationMs: Math.round(Number(duration) * 1000) });
      return saved;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: voiceKeys.all }); toast.success(snapshot ? 'Đã lưu Voice Profile.' : 'Đã tạo Voice Profile.'); onOpenChange(false); },
    onError: async (error) => { if (error instanceof VoicesApiError && error.code === 'VOICE_VERSION_CONFLICT') await queryClient.invalidateQueries({ queryKey: voiceKeys.all }); toast.error(error instanceof VoicesApiError ? error.message : 'Không thể lưu Voice Profile.'); },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); const next = validateVoiceDraft(draft); if (file && (!transcript.trim() || Number(duration) < 3 || Number(duration) > 10)) next.description = 'Sample cần transcript và thời lượng từ 3–10 giây.'; setErrors(next); if (!Object.keys(next).length) mutation.mutate(); };
  const update = <K extends keyof VoiceDraft>(key: K, value: VoiceDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="voice-dialog sm:max-w-3xl"><form onSubmit={submit} noValidate><DialogHeader><DialogTitle>{snapshot ? 'Sửa Voice Profile' : 'Tạo Voice Profile'}</DialogTitle><DialogDescription>Metadata, quyền sử dụng và sample tham chiếu dùng cho voice cloning.</DialogDescription></DialogHeader><div className="voice-dialog-body"><FieldGroup><div className="voice-form-grid">
    <Text id="voice-name" label="Tên giọng" value={draft.name} error={errors.name} onChange={(value) => update('name', value)} /><Text id="voice-language" label="Ngôn ngữ chính" value={draft.primaryLanguage} error={errors.primaryLanguage} onChange={(value) => { update('primaryLanguage', value); if (!file) setSampleLanguage(value); }} />
    <Field className="voice-form-full"><FieldLabel htmlFor="voice-description">Mô tả</FieldLabel><Textarea id="voice-description" value={draft.description} onChange={(event) => update('description', event.target.value)} /><FieldError>{errors.description}</FieldError></Field>
    <Text id="voice-tags" label="Tags" value={draft.tags} onChange={(value) => update('tags', value)} description="Phân cách bằng dấu phẩy." />
    <Field><FieldLabel>Loại license</FieldLabel><Select value={draft.licenseKind} onValueChange={(value) => update('licenseKind', value as VoiceDraft['licenseKind'])}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="OWNED_RECORDING">Bản ghi sở hữu</SelectItem><SelectItem value="AUTHORIZED_COMMERCIAL">Ủy quyền thương mại</SelectItem><SelectItem value="CC_BY">CC BY</SelectItem><SelectItem value="CC_BY_NC">CC BY-NC</SelectItem><SelectItem value="CUSTOM">License tùy chỉnh</SelectItem><SelectItem value="UNKNOWN">Chưa rõ</SelectItem></SelectContent></Select></Field>
    <Text id="voice-license-reference" label="Bằng chứng license" value={draft.licenseReference} error={errors.licenseReference} onChange={(value) => update('licenseReference', value)} /><Text id="voice-source-reference" label="Nguồn bản ghi" value={draft.sourceReference} onChange={(value) => update('sourceReference', value)} />
    <Field className="voice-form-full" data-invalid={Boolean(errors.commercialUseAllowed)}><label className="voice-check"><Checkbox checked={draft.commercialUseAllowed} onCheckedChange={(value) => update('commercialUseAllowed', value === true)} /><span>Xác nhận được phép sử dụng thương mại</span></label><FieldError>{errors.commercialUseAllowed}</FieldError></Field>
  </div><section className="voice-sample-form"><div><h3>Reference sample</h3><p>WAV, FLAC, MP3 hoặc WebM; 3–10 giây, tối đa 15 MiB.</p></div><div className="voice-form-grid"><Field className="voice-form-full"><FieldLabel htmlFor="voice-sample-file"><UploadIcon />File audio</FieldLabel><Input id="voice-sample-file" type="file" accept="audio/wav,audio/x-wav,audio/flac,audio/mpeg,audio/webm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>{file && <><Text id="voice-sample-language" label="Ngôn ngữ sample" value={sampleLanguage} onChange={setSampleLanguage} /><Text id="voice-sample-duration" label="Thời lượng (giây)" value={duration} onChange={setDuration} /><Field className="voice-form-full"><FieldLabel htmlFor="voice-sample-transcript">Transcript</FieldLabel><Textarea id="voice-sample-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} /></Field>{localPreview && <audio className="voice-audio" controls src={localPreview}>Trình duyệt không hỗ trợ audio.</audio>}</>}</div></section></FieldGroup></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <Spinner /> : <SaveIcon />}{mutation.isPending ? 'Đang lưu…' : 'Lưu Voice'}</Button></DialogFooter></form></DialogContent></Dialog>;
}
function Text({ id, label, value, error, description, onChange }: { id: string; label: string; value: string; error?: string | undefined; description?: string | undefined; onChange: (value: string) => void }) { return <Field data-invalid={Boolean(error)}><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />{description && <FieldDescription>{description}</FieldDescription>}<FieldError>{error}</FieldError></Field>; }
