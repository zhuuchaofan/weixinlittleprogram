// 日期统一按中国时区（UTC+8）。
const OFFSET_MS = 8 * 60 * 60 * 1000;

function todayKey(now = Date.now()) {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}

function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

module.exports = { todayKey, lastDayOfMonth };
