/**
 * 花销分析（docs/PLAN.md 记账规则最后一条）。金额单位为「分」：
 * - 支出口径同 ledger.summarize 的 spending：所有支出，不含结算和收入，不管怎么分。
 * - byCategory：本月和上月按分类对比，本月金额从大到小；上月有、本月没有的排在后面。
 * - big：大额单笔，本月支出按金额从大到小，前 3 笔一定列出，之后只列 ≥ BIG_AMOUNT 的，最多 MAX_BIG 笔。
 * - trend：截至本月的近 TREND_MONTHS 个月，每月支出合计。
 */
const validate = require('./validate');
const { categories, settlement: SETTLEMENT } = require('./contract.json');
const { normalizeCategory } = require('./ledger');

const TREND_MONTHS = 6;
const BIG_AMOUNT = 50000;
const MIN_BIG = 3;
const MAX_BIG = 5;

function shiftMonth(month, delta) {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value - 1 + delta, 1))
    .toISOString()
    .slice(0, 7);
}

const isSpending = (record) =>
  record.cat !== SETTLEMENT && record.flow !== 'in';

/** 每类的金额和笔数。 */
function byCat(records) {
  const result = new Map();
  for (const record of records) {
    const cat = normalizeCategory(record.cat);
    const row = result.get(cat) || { amount: 0, count: 0 };
    row.amount += record.amount;
    row.count += 1;
    result.set(cat, row);
  }
  return result;
}

const sum = (records) => records.reduce((total, r) => total + r.amount, 0);

/** 备注优先，没有备注时用截图里的商户名。 */
const labelOf = (record) => record.note || record.src?.merchant || '';

function analyze(month, records) {
  const ofMonth = (key) =>
    records.filter((record) => String(record.date).slice(0, 7) === key);
  const prev = shiftMonth(month, -1);
  const current = ofMonth(month);
  const spent = current.filter(isSpending);
  const prevSpent = ofMonth(prev).filter(isSpending);

  const now = byCat(spent);
  const before = byCat(prevSpent);
  const rank = (cat) => categories.indexOf(cat);
  const byCategory = [...new Set([...now.keys(), ...before.keys()])]
    .map((cat) => ({
      cat,
      amount: now.get(cat)?.amount || 0,
      count: now.get(cat)?.count || 0,
      prev: before.get(cat)?.amount || 0,
    }))
    .sort(
      (x, y) =>
        y.amount - x.amount || y.prev - x.prev || rank(x.cat) - rank(y.cat),
    );

  const big = [...spent]
    .sort((x, y) => y.amount - x.amount || x.date.localeCompare(y.date))
    .filter((record, index) => index < MIN_BIG || record.amount >= BIG_AMOUNT)
    .slice(0, MAX_BIG)
    .map((record) => ({
      id: record._id,
      date: record.date,
      cat: normalizeCategory(record.cat),
      note: labelOf(record),
      amount: record.amount,
    }));

  const trend = [];
  for (let delta = 1 - TREND_MONTHS; delta <= 0; delta++) {
    const key = shiftMonth(month, delta);
    trend.push({ month: key, total: sum(ofMonth(key).filter(isSpending)) });
  }

  return {
    month,
    prevMonth: prev,
    total: sum(spent),
    prevTotal: sum(prevSpent),
    count: spent.length,
    income: sum(current.filter((record) => record.flow === 'in')),
    byCategory,
    big,
    trend,
  };
}

/** repository: listRange(householdId, fromMonth, toMonth)，两头的月份都包含。 */
function createInsightHandler({ repository, requireMembership }) {
  return {
    async 'insight.get'(openid, payload) {
      const household = await requireMembership(openid);
      const month = validate.month(payload.month);
      const records = await repository.listRange(
        household._id,
        shiftMonth(month, 1 - TREND_MONTHS),
        month,
      );
      return analyze(month, records);
    },
  };
}

module.exports = { createInsightHandler, analyze, shiftMonth, TREND_MONTHS };
