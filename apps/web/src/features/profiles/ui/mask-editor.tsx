import { useEffect, useState } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { SeriesDraft } from '../model/profile-form';

export function MaskEditor({
  draft, error, previewUrl, onChange, onFile,
}: {
  draft: SeriesDraft; error?: string | undefined; previewUrl?: string | undefined;
  onChange: (patch: Partial<SeriesDraft>) => void;
  onFile: (file: File | null, previewUrl?: string) => void;
}) {
  const [localUrl, setLocalUrl] = useState<string>();
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const image = localUrl ?? previewUrl;
  const rectangle = {
    left: `${Number(draft.maskX || 0) * 100}%`, top: `${Number(draft.maskY || 0) * 100}%`,
    width: `${Number(draft.maskWidth || 0) * 100}%`, height: `${Number(draft.maskHeight || 0) * 100}%`,
  };
  const choose = (file: File | undefined) => {
    if (localUrl) URL.revokeObjectURL(localUrl);
    if (!file) { setLocalUrl(undefined); onFile(null); return; }
    const url = URL.createObjectURL(file); setLocalUrl(url); onFile(file, url);
  };
  return (
    <section className="profile-mask-section" aria-labelledby="mask-heading">
      <div className="profile-inline-heading"><div><h3 id="mask-heading">Mask xóa subtitle</h3><p>Rectangle normalized nên không phụ thuộc độ phân giải video.</p></div><Switch checked={draft.maskEnabled} onCheckedChange={(checked) => onChange({ maskEnabled: checked })} aria-label="Bật mask subtitle" /></div>
      {draft.maskEnabled && <>
        <Field><FieldLabel htmlFor="mask-reference">Reference frame</FieldLabel><Input id="mask-reference" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => choose(event.target.files?.[0])} /><FieldDescription>PNG, JPEG hoặc WebP; tối đa 20 MiB. File được upload trực tiếp lên R2 sau khi lưu.</FieldDescription></Field>
        <div className="mask-stage" aria-label="Xem trước vùng mask">
          {image ? <img src={image} alt="Reference frame cho mask subtitle" /> : <div className="mask-stage-empty">Chọn reference frame để xem mask trên khung hình</div>}
          <div className="mask-rectangle" style={rectangle}><span>Vùng xóa subtitle</span></div>
        </div>
        <div className="mask-fields">
          <MaskNumber id="mask-x" label="X" value={draft.maskX} onChange={(maskX) => onChange({ maskX })} />
          <MaskNumber id="mask-y" label="Y" value={draft.maskY} onChange={(maskY) => onChange({ maskY })} />
          <MaskNumber id="mask-width" label="Rộng" value={draft.maskWidth} onChange={(maskWidth) => onChange({ maskWidth })} />
          <MaskNumber id="mask-height" label="Cao" value={draft.maskHeight} onChange={(maskHeight) => onChange({ maskHeight })} />
        </div>
        <div className="mask-sliders" aria-label="Điều chỉnh trực quan mask">
          <Range label="Vị trí ngang" value={draft.maskX} max={Math.max(0, 1 - Number(draft.maskWidth || 0))} onChange={(maskX) => onChange({ maskX })} />
          <Range label="Vị trí dọc" value={draft.maskY} max={Math.max(0, 1 - Number(draft.maskHeight || 0))} onChange={(maskY) => onChange({ maskY })} />
          <Range label="Chiều rộng" value={draft.maskWidth} max={Math.max(0.01, 1 - Number(draft.maskX || 0))} onChange={(maskWidth) => onChange({ maskWidth })} />
          <Range label="Chiều cao" value={draft.maskHeight} max={Math.max(0.01, 1 - Number(draft.maskY || 0))} onChange={(maskHeight) => onChange({ maskHeight })} />
        </div>
        {error && <FieldError>{error}</FieldError>}
      </>}
    </section>
  );
}

function MaskNumber({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type="number" min="0" max="1" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}
function Range({ label, value, max, onChange }: { label: string; value: string; max: number; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input type="range" min="0" max={max} step="0.01" value={Math.min(Number(value || 0), max)} onChange={(event) => onChange(event.target.value)} /></label>;
}
