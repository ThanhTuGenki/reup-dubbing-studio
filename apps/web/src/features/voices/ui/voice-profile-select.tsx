import { useQuery } from '@tanstack/react-query';
import type { VoiceProfile } from '@reup-dubbing-studio/api-client';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { languageLabel } from '@/shared/lib/languages';
import { fetchVoices } from '../api/voices-api';

/** Voices usable as a default: the ones the library considers activated and ready to speak. */
const USABLE_STATUS = 'READY';
/** Safe stops so a misbehaving API (an ever-growing list, or a cursor/page that never advances) can't loop forever. */
const MAX_USABLE_VOICES = 1_000;
const MAX_USABLE_VOICE_PAGES = 20;

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
      <NativeSelect id={id} value="" disabled aria-invalid={ariaInvalid} onChange={() => undefined}>
        <NativeSelectOption value="">Đang tải giọng…</NativeSelectOption>
      </NativeSelect>
    );
  }
  const items = voices.data ?? [];
  const known = new Set(items.map((voice) => voice.id));
  const showUnknown = Boolean(value) && !known.has(value);
  return (
    <NativeSelect id={id} value={value} disabled={disabled} aria-invalid={ariaInvalid} onChange={(event) => onChange(event.target.value)}>
      <NativeSelectOption value="">Chưa chọn giọng</NativeSelectOption>
      {items.map((voice) => <NativeSelectOption key={voice.id} value={voice.id}>{`${voice.name} · ${languageLabel(voice.primaryLanguage)}`}</NativeSelectOption>)}
      {showUnknown && <NativeSelectOption value={value}>Giọng không còn dùng được</NativeSelectOption>}
    </NativeSelect>
  );
}
