// 日期统一按中国时区（UTC+8）。
const OFFSET_MS = 8 * 60 * 60 * 1000;

function todayKey(now = Date.now()) {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}

function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** 日期加几天，YYYY-MM-DD。 */
function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 重复任务的下一次：每天 +1 天，每周 +7 天，每月到下个月同一天（没有这一天就取月底）。 */
function nextOccurrence(date, repeat) {
  if (repeat === 'daily') return addDays(date, 1);
  if (repeat === 'weekly') return addDays(date, 7);
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

module.exports = { todayKey, lastDayOfMonth, addDays, nextOccurrence };
