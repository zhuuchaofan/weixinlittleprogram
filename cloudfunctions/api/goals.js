/**
 * 攒钱目标（docs/PLAN.md 记账规则最后一条）。金额单位为「分」：
 * - 进度靠手动「存了一笔」（goal.deposit）：saved 累加，log 记下每一笔（日期、金额、谁存的）。存入不是支出，不进记账统计。
 * - 每月要存：月初还差的钱 ÷ 从本月到截止月（含）的月数，向上取整到分；已过截止月时就是还差的全部；攒够了为 0。
 * - savedBy：两人各通过「存了一笔」存了多少；doneOn：哪天攒够的（直接改正已存金额攒够的为空）。
 * - thisMonth：本月存入的合计；behind：本月还差多少才够「每月要存」。
 * - goal.tips：前 3 个整月里可省的分类（不含 FIXED 的固定开销）月均支出，取最多的 3 类，算省 10% / 20% 每月能多存多少。
 */
const validate = require('./validate');
const { createCrudHandler } = require('./crud');
const { requireRecord } = require('./records');
const { todayKey } = require('./dates');
const { shiftMonth } = require('./insight');
const { settlement: SETTLEMENT } = require('./contract.json');
const { normalizeCategory } = require('./ledger');

const FIELDS = ['title', 'target', 'deadline', 'saved', 'log'];
const FIXED = ['房租', '水电网'];
const TIP_MONTHS = 3;
const LOG_SHOWN = 10;

/** 从 from 到 to（YYYY-MM）一共几个月，含两头；to 在 from 之前时为 0。 */
function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

/** 两人各通过「存了一笔」存了多少（不含新建时填的和后来改正的部分）。 */
function savedBy(log) {
  const total = { a: 0, b: 0 };
  for (const entry of log)
    if (entry.role === 'a' || entry.role === 'b')
      total[entry.role] += entry.amount;
  return total;
}

/** 哪天攒够的：从「已存 − 存入记录」这个起点往后累加；直接改正已存金额攒够的没有这一天。 */
function reachedOn(target, saved, log) {
  let running = Math.max(0, saved - log.reduce((sum, e) => sum + e.amount, 0));
  if (running >= target) return '';
  for (const entry of log) {
    running += entry.amount;
    if (running >= target) return entry.date;
  }
  return '';
}

function progress(view, clock) {
  const month = todayKey(clock()).slice(0, 7);
  const saved = view.saved || 0;
  const log = view.log || [];
  const thisMonth = log
    .filter((entry) => entry.date.startsWith(month))
    .reduce((total, entry) => total + entry.amount, 0);
  const remaining = Math.max(0, view.target - saved);
  const monthsLeft = monthsBetween(month, view.deadline);
  // 按月初还差的算，本月存了之后「每月要存」不变，只是本月还差的变少。
  const atMonthStart = Math.max(0, view.target - (saved - thisMonth));
  const perMonth = !remaining
    ? 0
    : monthsLeft
      ? Math.ceil(atMonthStart / monthsLeft)
      : remaining;
  const done = saved >= view.target;
  return {
    ...view,
    saved,
    savedBy: savedBy(log),
    doneOn: done ? reachedOn(view.target, saved, log) : '',
    // 最近的在前，只返回最近几笔。
    log: log.slice(-LOG_SHOWN).reverse(),
    done,
    percent: Math.min(100, Math.floor((saved * 100) / view.target)),
    remaining,
    monthsLeft,
    perMonth,
    thisMonth,
    behind: Math.min(remaining, Math.max(0, perMonth - thisMonth)),
  };
}

/** 前 TIP_MONTHS 个整月、可省分类的月均支出，最多 3 类。 */
function savingTips(month, records) {
  const from = shiftMonth(month, -TIP_MONTHS);
  const totals = new Map();
  for (const record of records) {
    const key = String(record.date).slice(0, 7);
    if (key < from || key >= month) continue;
    if (record.cat === SETTLEMENT || record.flow === 'in') continue;
    const cat = normalizeCategory(record.cat);
    if (FIXED.includes(cat)) continue;
    totals.set(cat, (totals.get(cat) || 0) + record.amount);
  }
  return [...totals]
    .map(([cat, total]) => {
      const average = Math.round(total / TIP_MONTHS);
      return {
        cat,
        average,
        save10: Math.round(average / 10),
        save20: Math.round(average / 5),
      };
    })
    .sort((x, y) => y.average - x.average)
    .slice(0, 3);
}

/**
 * repository：goals 集合，另有 deposit(householdId, id, entry) 原子地 saved += amount 并追加 log。
 * expenses：listRange(householdId, fromMonth, toMonth)。
 */
function createGoalHandler({ repository, expenses, requireMembership, now }) {
  const crud = createCrudHandler({
    prefix: 'goal',
    repository,
    requireMembership,
    now,
    check: validate.goal,
    fields: FIELDS,
    present: progress,
    // 没攒完的在前，截止早的在前。
    sort: (a, b) =>
      Number(a.done) - Number(b.done) || a.deadline.localeCompare(b.deadline),
  });
  return {
    ...crud,
    async 'goal.deposit'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      const amount = validate.amount(
        payload.amount,
        '写一下存了多少吧，写到分就好。',
      );
      await requireRecord(repository, household, id);
      const role =
        household.members.find((member) => member.openid === openid)?.role ||
        '';
      await repository.deposit(household._id, id, {
        amount,
        date: todayKey(now()),
        role,
        ts: now(),
      });
      return crud['goal.get'](openid, { id });
    },
    async 'goal.tips'(openid) {
      const household = await requireMembership(openid);
      const month = todayKey(now()).slice(0, 7);
      const records = await expenses.listRange(
        household._id,
        shiftMonth(month, -TIP_MONTHS),
        shiftMonth(month, -1),
      );
      return savingTips(month, records);
    },
  };
}

module.exports = { createGoalHandler, monthsBetween, savingTips, progress };
