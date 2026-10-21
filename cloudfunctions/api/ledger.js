/**
 * 记账规则（docs/PLAN.md 第 5 节）。金额单位为「分」（人民币）：
 * - 共同支出统计排除 cat === '结算' 与 split === 'self'。
 * - credit：split === 'other' 时为 amount；split === 'ratio' 时为 round(amount × (100 − ratio) / 100)，
 *   ratio 是付款人承担的百分比（整数 0–100）；否则为 amount / 2。
 * - net：payer 为 a 加 credit，为 b 减 credit；split === 'self' 不计入。
 * - net > 0：b 应付给 a；net < 0：a 应付给 b；|net| < 1 分视为已结清，结算金额四舍五入到分。
 * - 分类统计（byCategory）与共同支出口径相同，按金额从大到小。
 * - 月份由 date 前 7 位（YYYY-MM）决定。
 */
const crypto = require('node:crypto');

const {
  settlement: SETTLEMENT,
  categories,
  categoryAliases,
} = require('./contract.json');

/** 改名前存下的分类（如「食费」）按新名称处理；数据库里的旧记录不用迁移。 */
function normalizeCategory(cat) {
  return Object.hasOwn(categoryAliases, cat) ? categoryAliases[cat] : cat;
}

function monthOf(record) {
  return String(record.date).slice(0, 7);
}

function credit(record) {
  if (record.split === 'other') return record.amount;
  if (record.split === 'ratio')
    return Math.round((record.amount * (100 - record.ratio)) / 100);
  return record.amount / 2;
}

function netOf(records) {
  let net = 0;
  for (const record of records) {
    if (record.split === 'self') continue;
    net += record.payer === 'a' ? credit(record) : -credit(record);
  }
  return net;
}

function summarize(records) {
  const shared = records.filter(
    (record) => record.cat !== SETTLEMENT && record.split !== 'self',
  );
  const paid = { a: 0, b: 0 };
  const byCat = new Map();
  for (const record of shared) {
    paid[record.payer] += record.amount;
    const cat = normalizeCategory(record.cat);
    byCat.set(cat, (byCat.get(cat) || 0) + record.amount);
  }
  // 金额相同时按契约里的分类顺序，结果稳定。
  const byCategory = [...byCat]
    .map(([cat, amount]) => ({ cat, amount }))
    .sort(
      (x, y) =>
        y.amount - x.amount ||
        categories.indexOf(x.cat) - categories.indexOf(y.cat),
    );
  const net = netOf(records);
  const settled = Math.abs(net) < 1;
  return {
    sharedTotal: paid.a + paid.b,
    paid,
    byCategory,
    net,
    settled,
    suggestion: settled
      ? null
      : {
          from: net > 0 ? 'b' : 'a',
          to: net > 0 ? 'a' : 'b',
          amount: Math.round(Math.abs(net)),
        },
  };
}

/** 生成「记为已结算」的那条记录（不含 householdId、ts、by）。 */
function settlementRecord(records, date) {
  const summary = summarize(records);
  if (!summary.suggestion) return null;
  return {
    amount: summary.suggestion.amount,
    payer: summary.suggestion.from,
    split: 'other',
    cat: SETTLEMENT,
    note: SETTLEMENT,
    date,
  };
}

/**
 * 结算记录的确定性 _id：同一小家、同一月、同一份账目只会算出同一个 _id，
 * 两人同时结算时第二次插入会主键冲突。撤销结算后账目回到原样，可用同一 _id 重新结算。
 */
function settlementId(householdId, month, records) {
  const ids = records.map((record) => record._id).sort();
  const hash = crypto
    .createHash('sha256')
    .update([householdId, ...ids].join('\n'))
    .digest('hex')
    .slice(0, 24);
  return `settle_${month}_${hash}`;
}

module.exports = {
  SETTLEMENT,
  settlementId,
  normalizeCategory,
  monthOf,
  credit,
  netOf,
  summarize,
  settlementRecord,
};
