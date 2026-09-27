export const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' }, { code: 'zh', label: 'Tiếng Trung' }, { code: 'en', label: 'Tiếng Anh' },
  { code: 'ja', label: 'Tiếng Nhật' }, { code: 'ko', label: 'Tiếng Hàn' }, { code: 'th', label: 'Tiếng Thái' },
] as const;

/** Spoken languages the pipeline dubs into Vietnamese. */
export const SOURCE_LANGUAGE_CODES = ['zh', 'en', 'ja', 'ko', 'th'] as const;

export function languageLabel(code: string | null | undefined): string {
  if (!code) return 'Chưa đặt';
  const known = LANGUAGES.find((language) => language.code === code);
  return known ? known.label : `Khác (${code})`;
}
