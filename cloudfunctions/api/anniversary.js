const DAY_MS = 24 * 60 * 60 * 1000;

function parts(date) {
  return date.split('-').map(Number);
}

function utc(y, m, d) {
  return Date.UTC(y, m - 1, d);
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 某年的纪念日：2 月 29 日在平年记为 2 月 28 日。 */
function occurrence(year, month, day) {
  return utc(
    year,
    month,
    month === 2 && day === 29 && !isLeap(year) ? 28 : day,
  );
}

function key(time) {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * 以 today（YYYY-MM-DD，UTC+8 的日历日）计算：
 * - 每年重复：下一次（含今天）的日期、剩余天数、第几周年。
 * - 不重复：未到为倒数天数；已过则 passed = true，days 为已经过去的天数。
 */
function countdown(date, yearly, today) {
  const [y, m, d] = parts(date);
  const [ty, tm, td] = parts(today);
  const todayTime = utc(ty, tm, td);
  if (!yearly) {
    const diff = Math.round((utc(y, m, d) - todayTime) / DAY_MS);
    return { nextDate: date, days: Math.abs(diff), passed: diff < 0, years: 0 };
  }
  let year = Math.max(ty, y);
  let next = occurrence(year, m, d);
  if (next < todayTime) next = occurrence(++year, m, d);
  return {
    nextDate: key(next),
    days: Math.round((next - todayTime) / DAY_MS),
    passed: false,
    years: year - y,
  };
}

module.exports = { countdown };
