import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES, languageLabel } from '@/shared/lib/languages';

/** Radix SelectItem can't use value=""; this sentinel stands in for the "all languages" option and is mapped back to '' at the boundary. */
const ALL_LANGUAGES_VALUE = '__all-languages__';

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
  const selected = value === '' ? ALL_LANGUAGES_VALUE : value;
  return (
    <Select value={selected} {...(disabled !== undefined ? { disabled } : {})} onValueChange={(next) => onChange(next === ALL_LANGUAGES_VALUE ? '' : next)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={ariaInvalid} aria-label={ariaLabel}>
        <SelectValue placeholder="Chọn ngôn ngữ" />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL_LANGUAGES_VALUE}>{allLabel ?? 'Tất cả ngôn ngữ'}</SelectItem>}
        {optionCodes.map((code) => <SelectItem key={code} value={code}>{languageLabel(code)}</SelectItem>)}
        {showUnknown && <SelectItem value={value}>{languageLabel(value)}</SelectItem>}
      </SelectContent>
    </Select>
  );
}
