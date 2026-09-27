import { useQuery } from '@tanstack/react-query';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { languageLabel } from '@/shared/lib/languages';
import { fetchVoices } from '../api/voices-api';

/** Voices usable as a default: the ones the library considers activated and ready to speak. */
const USABLE_STATUS = 'READY';

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
    queryKey: ['voices', 'usable'],
    queryFn: ({ signal }) => fetchVoices({ status: USABLE_STATUS, limit: 100 }, signal),
  });
  if (voices.isPending) {
    return (
      <NativeSelect id={id} value="" disabled aria-invalid={ariaInvalid} onChange={() => undefined}>
        <NativeSelectOption value="">Đang tải giọng…</NativeSelectOption>
      </NativeSelect>
    );
  }
  const items = voices.data?.items ?? [];
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
