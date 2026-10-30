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

/** 「在一起第 N 天」的里程碑（第 365 天起的周年由纪念日自己的倒数负责）。 */
const MILESTONES = [100, 200, 300, 500, 520, 1000, 1314, 2000, 3000, 5000];

/**
 * 在一起的第几天：起点那天算第 1 天。起点还没到时 day 为 0、没有里程碑。
 * milestone：下一个（含今天）里程碑——第几天、是哪天、还有几天；5000 天之后每 1000 天一个。
 */
function together(date, today) {
  const [y, m, d] = parts(date);
  const [ty, tm, td] = parts(today);
  const start = utc(y, m, d);
  const day = Math.round((utc(ty, tm, td) - start) / DAY_MS) + 1;
  if (day < 1) return { day: 0, milestone: null };
  const target =
    MILESTONES.find((n) => n >= day) || Math.ceil(day / 1000) * 1000;
  return {
    day,
    milestone: {
      day: target,
      date: key(start + (target - 1) * DAY_MS),
      days: target - day,
    },
  };
}

module.exports = { countdown, together, MILESTONES };
