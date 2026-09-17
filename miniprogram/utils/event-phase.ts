export type BanquetPhase = 'before' | 'today' | 'after';

export interface BanquetStatus {
  phase: BanquetPhase;
  daysUntil: number;
}

function parseDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('宴会日期格式应为 YYYY-MM-DD。');
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// 用 UTC+8 的日历日判断，避免访客手机时区不同造成当天状态错位。
export function getBanquetStatus(
  eventDate: string,
  now: Date = new Date(),
): BanquetStatus {
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = Date.UTC(
    china.getUTCFullYear(),
    china.getUTCMonth(),
    china.getUTCDate(),
  );
  const daysUntil = Math.round((parseDate(eventDate) - today) / 86400000);
  if (daysUntil > 0) return { phase: 'before', daysUntil };
  if (daysUntil === 0) return { phase: 'today', daysUntil: 0 };
  return { phase: 'after', daysUntil: 0 };
}
