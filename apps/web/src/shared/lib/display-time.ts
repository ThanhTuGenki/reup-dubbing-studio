export const DISPLAY_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function toVietnamDateTimeInput(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function vietnamDateTimeInputToIso(value: string) {
  return new Date(`${value}:00+07:00`).toISOString();
}
