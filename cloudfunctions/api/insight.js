/**
 * 花销分析（docs/PLAN.md 记账规则最后一条）。金额单位为「分」：
 * - 支出口径同 ledger.summarize 的 spending：所有支出，不含结算和收入，不管怎么分。
 * - byCategory：本月和上月按分类对比，本月金额从大到小；上月有、本月没有的排在后面。
 * - big：大额单笔，本月支出按金额从大到小，前 3 笔一定列出，之后只列 ≥ BIG_AMOUNT 的，最多 MAX_BIG 笔。
 * - trend：截至本月的近 TREND_MONTHS 个月，每月支出合计。
 * AI 月度小结：只把上面这份汇总写成文字发给千问（大额单笔带备注或商户名，截到 NOTE_MAX 字），
 * 不发截图、明细和名字。结果存在 insights（每小家每月一份），每小家每天最多生成 DAILY_SUMMARIES 次。
 */
const { ApiError } = require('./errors');
const validate = require('./validate');
const {
  categories,
  settlement: SETTLEMENT,
  aiSummary,
} = require('./contract.json');
const { normalizeCategory } = require('./ledger');
const { todayKey } = require('./dates');

const TREND_MONTHS = 6;
const BIG_AMOUNT = 50000;
const MIN_BIG = 3;
const MAX_BIG = 5;
const NOTE_MAX = 12;
const SUMMARY_MAX = 300;
const DAILY_SUMMARIES = aiSummary.daily;

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

/** 分 → 「1234.5 元」里的数字，整数不带小数。 */
function yuan(fen) {
  return String(Math.round(fen) / 100);
}

const monthText = (month) => `${Number(month.slice(5))}月`;

/** 发给模型的全部内容：只有汇总数字和大额单笔的备注。 */
function summaryPrompt(insight) {
  const lines = [
    '你是一对小夫妻记账本里的小猫助手「喵喵」。下面是他们这个月的支出汇总（金额单位：元），请只根据这些数据写一段月度小结：',
    '- 3 到 5 句，总共不超过 150 字，口吻亲切，称呼「你们」；',
    '- 说清钱主要花在哪、和上个月比哪几类明显变多或变少、有没有一次性的大额支出（去掉它和平时比怎么样）；',
    '- 最后给一条具体、做得到的省钱建议；',
    '- 不要编造数据里没有的数字，不要标题、列表或 Markdown 符号。',
    '',
    `${monthText(insight.month)}支出合计 ${yuan(insight.total)} 元，共 ${insight.count} 笔；上个月（${monthText(insight.prevMonth)}）${yuan(insight.prevTotal)} 元。`,
  ];
  if (insight.income)
    lines.push(`本月收入 ${yuan(insight.income)} 元（不算在支出里）。`);
  lines.push('按分类（本月 / 上个月 / 本月笔数）：');
  for (const row of insight.byCategory)
    lines.push(
      `- ${row.cat}：${yuan(row.amount)} / ${yuan(row.prev)} / ${row.count} 笔`,
    );
  if (insight.big.length) {
    lines.push('本月大额单笔：');
    for (const row of insight.big)
      lines.push(
        `- ${Number(row.date.slice(5, 7))}月${Number(row.date.slice(8))}日 ${row.cat} ${yuan(row.amount)} 元${row.note ? `「${row.note.slice(0, NOTE_MAX)}」` : ''}`,
      );
  }
  lines.push(
    '近 6 个月每月支出：' +
      insight.trend
        .map((row) => `${monthText(row.month)} ${yuan(row.total)}`)
        .join('，'),
  );
  return lines.join('\n');
}

/** 去掉模型偶尔加的 Markdown 符号和多余空行，限制长度。 */
function cleanSummary(text) {
  return String(text)
    .replace(/[*#`>]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, SUMMARY_MAX);
}

/** 账目变了（合计或笔数不同）就提示可以重新生成。 */
const fingerprint = (insight) => `${insight.total}/${insight.count}`;

function publicSummary(doc, insight) {
  return doc
    ? {
        text: doc.text,
        ts: doc.ts,
        stale: doc.fingerprint !== fingerprint(insight),
      }
    : null;
}

/**
 * repository：expenses 的 listRange(householdId, fromMonth, toMonth)，两头的月份都包含。
 * insights：get(householdId, id)、insertWithId、update；households：takeQuota(id, field, day, limit)。
 * writer：{ write(prompt) -> 模型回复文本 }；没有配置模型时为 null。
 */
function createInsightHandler({
  repository,
  insights,
  households,
  requireMembership,
  now,
  writer,
}) {
  async function load(household, month) {
    const records = await repository.listRange(
      household._id,
      shiftMonth(month, 1 - TREND_MONTHS),
      month,
    );
    return analyze(month, records);
  }
  const summaryId = (household, month) => `${household._id}-${month}`;

  return {
    async 'insight.get'(openid, payload) {
      const household = await requireMembership(openid);
      const month = validate.month(payload.month);
      const insight = await load(household, month);
      const saved = insights
        ? await insights.get(household._id, summaryId(household, month))
        : null;
      return { ...insight, summary: publicSummary(saved, insight) };
    },
    async 'insight.write'(openid, payload) {
      const household = await requireMembership(openid);
      const month = validate.month(payload.month);
      if (!writer)
        throw new ApiError(
          'UNAVAILABLE',
          'AI 小结还没开通：需要在云函数 api 里配置 DASHSCOPE_API_KEY。',
        );
      const insight = await load(household, month);
      if (!insight.count)
        throw new ApiError('VALIDATION', '这个月还没有支出，记几笔再来吧。');
      // 先占额度再调模型：失败也算一次，避免反复重试刷用量。
      if (
        !(await households.takeQuota(
          household._id,
          'summaryQuota',
          todayKey(now()),
          DAILY_SUMMARIES,
        ))
      )
        throw new ApiError(
          'LIMIT',
          `今天已经生成了 ${DAILY_SUMMARIES} 次小结，明天再来吧。`,
        );
      const text = cleanSummary(await writer.write(summaryPrompt(insight)));
      if (!text)
        throw new ApiError('UNAVAILABLE', '小结没写出来，请稍后重试。');
      const id = summaryId(household, month);
      const doc = {
        householdId: household._id,
        month,
        text,
        fingerprint: fingerprint(insight),
        ts: now(),
        by: openid,
      };
      // 每月一份：第一次插入，之后覆盖。两人同时生成时后写的为准。
      if (!(await insights.insertWithId(id, doc)))
        await insights.update(household._id, id, doc);
      return publicSummary(doc, insight);
    },
  };
}

module.exports = {
  createInsightHandler,
  analyze,
  shiftMonth,
  summaryPrompt,
  cleanSummary,
  TREND_MONTHS,
};
