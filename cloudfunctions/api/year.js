/**
 * 年度情侣账单回顾（会员功能）：一年里两人一起花了多少、花在哪、吃了什么、去过哪、做完几件事，全部从已有数据数出来。
 * 金额单位为「分」，支出口径同花销分析（不含结算和收入）。
 * - 不是会员时只返回封面（一共花了多少、记了几笔、在一起第几天），locked 为 true，其余字段为 null。
 * - 年度寄语（year.write）是 AI 写的一段话，只给会员，存在 insights 的 `<小家>-year-<年>`。
 */
const { ApiError } = require('./errors');
const { settlement: SETTLEMENT } = require('./contract.json');
const { normalizeCategory } = require('./ledger');
const { todayKey } = require('./dates');
const { isVip } = require('./vip');
const { takeQuota } = require('./quota');
const { cleanSummary } = require('./insight');
const { yearNote } = require('./prompts');

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_CATS = 5;
const TOP_DISHES = 3;
const MAX_PLACES = 12;

const isSpending = (record) =>
  record.cat !== SETTLEMENT && record.flow !== 'in';
const yuan = (fen) => Math.round(fen / 100);

/** 「2026」：只认四位年份，不能是还没到的年份；不传就是今年。 */
function yearOf(payload, today) {
  if (payload?.year === undefined) return today.slice(0, 4);
  const year = String(payload.year);
  if (!/^\d{4}$/.test(year) || year > today.slice(0, 4))
    throw new ApiError('VALIDATION', '这一年还没到哦。');
  return year;
}

/** 这一年有几天算数：今年数到今天，往年数满一年。 */
function daysOf(year, today) {
  const last = `${year}-12-31` < today ? `${year}-12-31` : today;
  return {
    last,
    days:
      Math.round((Date.parse(last) - Date.parse(`${year}-01-01`)) / DAY_MS) + 1,
  };
}

/** 发给模型的事实：只有数字、分类名、吃得最多的菜名和去过的地方名，没有名字和明细。 */
function noteLines(review) {
  const { spend } = review;
  const lines = [
    `${review.year} 年一起花了 ${yuan(spend.total)} 元，记了 ${spend.count} 笔，有 ${spend.freeDays} 天没花钱。`,
  ];
  if (spend.top.length)
    lines.push(
      '花得最多的类别：' +
        spend.top.map((row) => `${row.cat} ${yuan(row.amount)} 元`).join('，'),
    );
  if (spend.peakMonth)
    lines.push(
      `花得最多的是 ${Number(spend.peakMonth.month.slice(5))} 月，${yuan(spend.peakMonth.amount)} 元。`,
    );
  if (review.meals.count)
    lines.push(
      `一起吃了 ${review.meals.count} 顿「就吃这个」，吃得最多的是` +
        review.meals.top
          .map((row) => `「${row.title}」${row.count} 次`)
          .join('、') +
        '。',
    );
  if (review.todos.count)
    lines.push(`一起做完了 ${review.todos.count} 件待办。`);
  if (review.places.count)
    lines.push(
      `去过 ${review.places.count} 个地方：` +
        review.places.titles.map((title) => `「${title}」`).join('、') +
        '。',
    );
  if (review.saved) lines.push(`一起攒了 ${yuan(review.saved)} 元。`);
  if (review.togetherDay)
    lines.push(`到这一年最后一天是在一起第 ${review.togetherDay} 天。`);
  return lines;
}

/** 数字变了才提示可以重新写。 */
const fingerprint = (review) =>
  [
    review.spend.total,
    review.spend.count,
    review.meals.count,
    review.todos.count,
    review.places.count,
    review.saved,
  ].join('/');

function publicNote(doc, review) {
  return doc
    ? {
        text: doc.text,
        ts: doc.ts,
        stale: doc.fingerprint !== fingerprint(review),
      }
    : null;
}

/**
 * repositories：expenses.listRange、activity.listAll、wishes.listAll、goals.listAll、dates.listAll（后几个可以没有）。
 * insights：get、insertWithId、update；ai：createAi() 的返回值，没有配置模型时为 null。
 */
function createYearHandler({
  repositories,
  households,
  insights = null,
  ai = null,
  requireMembership,
  now,
}) {
  const { expenses, activity, wishes, goals, dates } = repositories;
  const noteId = (household, year) => `${household._id}-year-${year}`;

  async function build(household, year) {
    const today = todayKey(now());
    const { last, days } = daysOf(year, today);
    const spent = (
      await expenses.listRange(household._id, `${year}-01`, `${year}-12`)
    ).filter(
      (record) => isSpending(record) && String(record.date).startsWith(year),
    );
    const total = spent.reduce((sum, record) => sum + record.amount, 0);

    const start = (dates ? await dates.listAll(household._id) : []).find(
      (record) => record.together,
    );
    const togetherDay = start
      ? Math.max(
          0,
          Math.round((Date.parse(last) - Date.parse(start.date)) / DAY_MS) + 1,
        )
      : 0;
    const cover = { year, spend: { total, count: spent.length }, togetherDay };
    if (!isVip(household, now())) return { ...cover, locked: true };

    const cats = new Map();
    const months = Array.from({ length: 12 }, (_, index) => ({
      month: `${year}-${String(index + 1).padStart(2, '0')}`,
      amount: 0,
    }));
    const byDay = new Set();
    let biggest = null;
    for (const record of spent) {
      const cat = normalizeCategory(record.cat);
      cats.set(cat, (cats.get(cat) || 0) + record.amount);
      months[Number(String(record.date).slice(5, 7)) - 1].amount +=
        record.amount;
      byDay.add(record.date);
      if (!biggest || record.amount > biggest.amount) biggest = record;
    }
    const peak = months.reduce(
      (best, row) => (row.amount > (best?.amount || 0) ? row : best),
      null,
    );

    const done = (activity ? await activity.listAll(household._id) : []).filter(
      (entry) => String(entry.date).startsWith(year),
    );
    const eaten = new Map();
    for (const entry of done.filter((item) => item.type === 'dish'))
      eaten.set(entry.title, (eaten.get(entry.title) || 0) + 1);
    const visited = (wishes ? await wishes.listAll(household._id) : [])
      .filter((wish) => wish.done && String(wish.doneOn || '').startsWith(year))
      .sort((a, b) => String(a.doneOn).localeCompare(String(b.doneOn)));
    const saved = (goals ? await goals.listAll(household._id) : [])
      .flatMap((goal) => goal.log || [])
      .filter((entry) => String(entry.date).startsWith(year))
      .reduce((sum, entry) => sum + entry.amount, 0);

    return {
      ...cover,
      locked: false,
      spend: {
        ...cover.spend,
        perDay: days ? Math.round(total / days) : 0,
        freeDays: Math.max(0, days - byDay.size),
        months,
        peakMonth: peak ? { month: peak.month, amount: peak.amount } : null,
        top: [...cats]
          .map(([cat, amount]) => ({ cat, amount }))
          .sort((x, y) => y.amount - x.amount)
          .slice(0, TOP_CATS),
        biggest: biggest
          ? {
              amount: biggest.amount,
              cat: normalizeCategory(biggest.cat),
              note: String(biggest.note || biggest.src?.merchant || ''),
              date: biggest.date,
            }
          : null,
      },
      meals: {
        count: [...eaten.values()].reduce((sum, count) => sum + count, 0),
        top: [...eaten]
          .sort((x, y) => y[1] - x[1])
          .slice(0, TOP_DISHES)
          .map(([title, count]) => ({ title, count })),
      },
      todos: { count: done.filter((item) => item.type === 'todo').length },
      places: {
        count: visited.length,
        titles: visited.slice(0, MAX_PLACES).map((wish) => wish.title),
      },
      saved,
    };
  }

  return {
    async 'year.get'(openid, payload) {
      const household = await requireMembership(openid);
      const year = yearOf(payload, todayKey(now()));
      const review = await build(household, year);
      if (review.locked) return { ...review, note: null };
      const saved = insights
        ? await insights.get(household._id, noteId(household, year))
        : null;
      return { ...review, note: publicNote(saved, review) };
    },
    /** 年度寄语：只给会员，每年一份，两人同时写后写的为准。 */
    async 'year.write'(openid, payload) {
      const household = await requireMembership(openid);
      const year = yearOf(payload, todayKey(now()));
      if (!ai || !insights)
        throw new ApiError(
          'UNAVAILABLE',
          '年度寄语还没开通：需要在云函数 api 里配置 DASHSCOPE_API_KEY。',
        );
      if (!isVip(household, now()))
        throw new ApiError(
          'LIMIT',
          '年度回顾和年度寄语是会员功能，开通后两个人都能看。',
        );
      const review = await build(household, year);
      if (!review.spend.count)
        throw new ApiError('VALIDATION', '这一年还没有记账，记几笔再来吧。');
      await ai.ensure('yearNote');
      await takeQuota(households, household, 'yearNote', now());
      const text = cleanSummary(
        await ai.write(
          'yearNote',
          yearNote({ year, lines: noteLines(review) }),
        ),
      );
      if (!text)
        throw new ApiError(
          'UNAVAILABLE',
          '喵喵这次没想出来，过一会儿再试试吧。',
        );
      const id = noteId(household, year);
      const doc = {
        householdId: household._id,
        kind: 'year',
        year,
        text,
        fingerprint: fingerprint(review),
        ts: now(),
        by: openid,
      };
      if (!(await insights.insertWithId(id, doc)))
        await insights.update(household._id, id, doc);
      return publicNote(doc, review);
    },
  };
}

module.exports = { createYearHandler, noteLines };
