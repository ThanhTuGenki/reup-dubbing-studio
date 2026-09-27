import { useQuery } from '@tanstack/react-query';
import type { VoiceProfile } from '@reup-dubbing-studio/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { languageLabel } from '@/shared/lib/languages';
import { fetchVoices } from '../api/voices-api';

/** Voices usable as a default: the ones the library considers activated and ready to speak. */
const USABLE_STATUS = 'READY';
/** Safe stops so a misbehaving API (an ever-growing list, or a cursor/page that never advances) can't loop forever. */
const MAX_USABLE_VOICES = 1_000;
const MAX_USABLE_VOICE_PAGES = 20;
/** Radix SelectItem can't use value=""; this sentinel stands in for "no voice chosen" and is mapped back to '' at the boundary. */
const NO_VOICE_VALUE = '__no-voice__';

async function fetchAllUsableVoices(signal: AbortSignal | undefined): Promise<VoiceProfile[]> {
  const items: VoiceProfile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_USABLE_VOICE_PAGES; page += 1) {
    const result = await fetchVoices({ status: USABLE_STATUS, limit: 100, ...(cursor ? { cursor } : {}) }, signal);
    items.push(...result.items);
    const nextCursor = result.nextCursor ?? undefined;
    if (!nextCursor || nextCursor === cursor || result.items.length === 0 || items.length >= MAX_USABLE_VOICES) break;
    cursor = nextCursor;
  }
  return items;
}

export function VoiceProfileSelect({
  id, value, onChange, disabled, 'aria-invalid': ariaInvalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const voices = useQuery({
    queryKey: ['voices', 'usable-select', 'all'],
    queryFn: ({ signal }) => fetchAllUsableVoices(signal),
  });
  if (voices.isPending) {
    return (
      <Select value="" disabled>
        <SelectTrigger id={id} className="w-full" aria-invalid={ariaInvalid}>
          <SelectValue placeholder="Đang tải giọng…" />
        </SelectTrigger>
        <SelectContent />
      </Select>
    );
  }
  const items = voices.data ?? [];
  const known = new Set(items.map((voice) => voice.id));
  const showUnknown = Boolean(value) && !known.has(value);
  const selected = value === '' ? NO_VOICE_VALUE : value;
  return (
    <Select value={selected} {...(disabled !== undefined ? { disabled } : {})} onValueChange={(next) => onChange(next === NO_VOICE_VALUE ? '' : next)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={ariaInvalid}>
        <SelectValue placeholder="Chưa chọn giọng" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_VOICE_VALUE}>Chưa chọn giọng</SelectItem>
        {items.map((voice) => <SelectItem key={voice.id} value={voice.id}>{`${voice.name} · ${languageLabel(voice.primaryLanguage)}`}</SelectItem>)}
        {showUnknown && <SelectItem value={value}>Giọng không còn dùng được</SelectItem>}
      </SelectContent>
    </Select>
  );
}
