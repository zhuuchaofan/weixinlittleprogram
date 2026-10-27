/**
 * 花销分析（docs/PLAN.md 记账规则最后一条）。金额单位为「分」：
 * - 支出口径同 ledger.summarize 的 spending：所有支出，不含结算和收入，不管怎么分。
 * - byCategory：本月和上月按分类对比，本月金额从大到小；上月有、本月没有的排在后面。
 *   prev 固定是上个月（预算页用），ref 是对比月（见 compare）。
 * - compare：拿哪个月比。上个月有账（哪怕只是收入）就比上个月；上个月一笔都没有但更早有账
 *   （像是忘了记），比最近一个有账的月份；近 TREND_MONTHS 个月里从没记过（刚开始用）为 null。
 *   对比月正好是开始记账的那个月、且不是从 1 号记起时，那个月只记了一部分：days < fullDays。
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
  vip: VIP,
} = require('./contract.json');
const { normalizeCategory } = require('./ledger');
const { todayKey } = require('./dates');
const { dailyLimits, upgradeHint } = require('./vip');

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

const daysIn = (month) =>
  new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  ).getUTCDate();

function compareMonth(month, records, ofMonth) {
  let key = '';
  for (let delta = -1; delta > -TREND_MONTHS && !key; delta--)
    if (ofMonth(shiftMonth(month, delta)).length)
      key = shiftMonth(month, delta);
  if (!key) return null;
  const first = records
    .map((record) => String(record.date))
    .reduce((x, y) => (x < y ? x : y));
  const fullDays = daysIn(key);
  return {
    month: key,
    total: sum(ofMonth(key).filter(isSpending)),
    days:
      first.slice(0, 7) === key
        ? fullDays - Number(first.slice(8, 10)) + 1
        : fullDays,
    fullDays,
  };
}

function analyze(month, records) {
  const ofMonth = (key) =>
    records.filter((record) => String(record.date).slice(0, 7) === key);
  const prev = shiftMonth(month, -1);
  const current = ofMonth(month);
  const spent = current.filter(isSpending);
  const prevSpent = ofMonth(prev).filter(isSpending);
  const compare = compareMonth(month, records, ofMonth);

  const now = byCat(spent);
  const before = byCat(prevSpent);
  const refs = compare
    ? byCat(ofMonth(compare.month).filter(isSpending))
    : new Map();
  const rank = (cat) => categories.indexOf(cat);
  const byCategory = [
    ...new Set([...now.keys(), ...before.keys(), ...refs.keys()]),
  ]
    .map((cat) => ({
      cat,
      amount: now.get(cat)?.amount || 0,
      count: now.get(cat)?.count || 0,
      prev: before.get(cat)?.amount || 0,
      ref: refs.get(cat)?.amount || 0,
    }))
    .sort(
      (x, y) =>
        y.amount - x.amount || y.ref - x.ref || rank(x.cat) - rank(y.cat),
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
    compare,
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

/** 提示词里「拿哪个月比」的说明和要求，三种情况见 analyze 的 compare。 */
function compareLines(insight) {
  const { compare } = insight;
  const prevText = `上个月（${monthText(insight.prevMonth)}）`;
  if (!compare)
    return {
      rule: '- 说清钱主要花在哪、有没有一次性的大额支出（去掉它之后大概多少）；这是他们开始记账的第一个月，没有可比的月份，不要说哪类变多、变少或新增；',
      fact: '这是开始记账的第一个月，没有更早的账可比。',
    };
  const base = monthText(compare.month);
  const partial = compare.days < compare.fullDays;
  const fact =
    (compare.month === insight.prevMonth
      ? `${prevText}${yuan(compare.total)} 元`
      : `${prevText}没有记账（多半是忘了记，不是没花钱），拿最近有账的 ${base} 比：${base} ${yuan(compare.total)} 元`) +
    (partial
      ? `，但${base}是从 ${compare.fullDays - compare.days + 1} 日才开始记的，只记了 ${compare.days} 天。`
      : '。');
  const missing =
    compare.month === insight.prevMonth
      ? ''
      : `要提一句${monthText(insight.prevMonth)}没记账；`;
  const rule = partial
    ? `- 说清钱主要花在哪、有没有一次性的大额支出（去掉它之后大概多少）；${missing}可以和${base}比哪几类花得多，但${base}只记了 ${compare.days} 天，要说明这一点，不要说「多了几倍」「新增」这类结论；`
    : `- 说清钱主要花在哪、和${base}比哪几类明显变多或变少、有没有一次性的大额支出（去掉它和平时比怎么样）；${missing}`;
  return { rule, fact };
}

/**
 * 发给模型的全部内容：只有汇总数字和大额单笔的备注。
 * 和哪个月比、能不能下结论见 compareLines；走势只列记过账的月份。
 */
function summaryPrompt(insight) {
  const { compare } = insight;
  const { rule, fact } = compareLines(insight);
  const lines = [
    '你是一对小夫妻记账本里的小猫助手「喵喵」。下面是他们这个月的支出汇总（金额单位：元），请只根据这些数据写一段月度小结：',
    '- 3 到 5 句，总共不超过 150 字，口吻亲切，称呼「你们」；',
    rule,
    '- 最后给一条具体、做得到的省钱建议；',
    '- 不要编造数据里没有的数字，不要标题、列表或 Markdown 符号。',
    '',
    `${monthText(insight.month)}支出合计 ${yuan(insight.total)} 元，共 ${insight.count} 笔；${fact}`,
  ];
  if (insight.income)
    lines.push(`本月收入 ${yuan(insight.income)} 元（不算在支出里）。`);
  const base = compare ? monthText(compare.month) : '';
  lines.push(
    compare
      ? `按分类（本月 / ${base} / 本月笔数）：`
      : '按分类（本月 / 笔数）：',
  );
  for (const row of insight.byCategory)
    lines.push(
      compare
        ? `- ${row.cat}：${yuan(row.amount)} / ${yuan(row.ref)} / ${row.count} 笔`
        : `- ${row.cat}：${yuan(row.amount)} / ${row.count} 笔`,
    );
  if (insight.big.length) {
    lines.push('本月大额单笔：');
    for (const row of insight.big)
      lines.push(
        `- ${Number(row.date.slice(5, 7))}月${Number(row.date.slice(8))}日 ${row.cat} ${yuan(row.amount)} 元${row.note ? `「${row.note.slice(0, NOTE_MAX)}」` : ''}`,
      );
  }
  const months = insight.trend.filter((row) => row.total > 0);
  if (months.length > 1)
    lines.push(
      '记过账的月份每月支出：' +
        months
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
      // 先占额度再调模型：失败也算一次，避免反复重试刷用量。会员的每日次数更多。
      const limit = dailyLimits(household, now(), {
        summaries: DAILY_SUMMARIES,
      }).summaries;
      if (
        !(await households.takeQuota(
          household._id,
          'summaryQuota',
          todayKey(now()),
          limit,
        ))
      )
        throw new ApiError(
          'LIMIT',
          `今天已经生成了 ${limit} 次小结，明天再来吧。` +
            upgradeHint(
              household,
              now(),
              `开通会员每天可以生成 ${VIP.dailySummaries} 次。`,
            ),
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
