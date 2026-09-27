import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { LANGUAGES, languageLabel } from '@/shared/lib/languages';

export function LanguageSelect({
  id, value, onChange, codes, allowAll, allLabel, disabled, 'aria-invalid': ariaInvalid, 'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  codes?: readonly string[];
  allowAll?: boolean;
  allLabel?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
}) {
  const optionCodes = codes ?? LANGUAGES.map((language) => language.code);
  const showUnknown = Boolean(value) && !optionCodes.includes(value);
  return (
    <NativeSelect id={id} value={value} disabled={disabled} aria-invalid={ariaInvalid} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
      {allowAll && <NativeSelectOption value="">{allLabel ?? 'Tất cả ngôn ngữ'}</NativeSelectOption>}
      {optionCodes.map((code) => <NativeSelectOption key={code} value={code}>{languageLabel(code)}</NativeSelectOption>)}
      {showUnknown && <NativeSelectOption value={value}>{languageLabel(value)}</NativeSelectOption>}
    </NativeSelect>
  );
}
