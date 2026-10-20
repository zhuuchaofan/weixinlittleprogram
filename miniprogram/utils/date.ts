// 统一按中国时区（UTC+8），避免手机时区不同造成日期错位。
const OFFSET_MS = 8 * 60 * 60 * 1000;

export function formatDateTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const date = new Date(time + OFFSET_MS);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** 毫秒时间戳 → 2026年10月20日 22:30（UTC+8）。 */
export function formatTimestamp(ts: number): string {
  return formatDateTime(new Date(ts).toISOString());
}

/** 今天，YYYY-MM-DD。 */
export function todayKey(now: number = Date.now()): string {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}

/** 月份前后移动，YYYY-MM。 */
export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return `${year}年${value}月`;
}

/** 10-05 → 10月5日 */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}
