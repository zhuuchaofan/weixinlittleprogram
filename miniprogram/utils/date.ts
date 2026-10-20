// 统一按中国时区（UTC+8）展示，避免手机时区不同造成日期错位。
const OFFSET_MS = 8 * 60 * 60 * 1000;

export function formatDateTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const date = new Date(time + OFFSET_MS);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
