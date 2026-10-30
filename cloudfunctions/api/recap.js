/**
 * 每月「我们的小报」：一个月里两人一起做了什么，全部从已有数据数出来，不用 AI。金额单位为「分」：
 * - spend：支出口径同花销分析（不含结算和收入）；prevTotal 是上个月的支出，上个月一笔都没记过为 null；
 *   count 是笔数，byRole 是两人各记了几笔；top 是金额最大的 3 类。
 *   weeks 是按每 7 天一段的支出（第 1 到 7 天、8 到 14 天…），biggest 是最大的一笔，peakDay 是花得最多的一天，
 *   perDay 是日均（本月数到今天为止），freeDays 是没花钱的天数。
 * - meals：这个月「就吃这个」的次数，和吃得最多的一个（并列取先吃到的）。
 * - todos：这个月勾完的待办条数，两人各勾了几条。
 * - wishes：这个月标成「去过了」的地方。
 * - saved：这个月「存了一笔」的合计，两人各存了多少。
 * - togetherDay：这个月最后一天（本月到今天为止）是在一起第几天，没设起点或起点还没到为 0。
 * activity 是年度回顾用的「做过的事」，集合没建时都按没有算。
 */
const validate = require('./validate');
const { ApiError } = require('./errors');
const { settlement: SETTLEMENT } = require('./contract.json');
const { normalizeCategory } = require('./ledger');
const { shiftMonth } = require('./insight');
const { todayKey, lastDayOfMonth } = require('./dates');

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_CATS = 3;
const MAX_WISHES = 5;

const isSpending = (record) =>
  record.cat !== SETTLEMENT && record.flow !== 'in';

function createRecapHandler({ repositories, requireMembership, now }) {
  const { expenses, goals, dates, activity } = repositories;
  return {
    async 'recap.get'(openid, payload) {
      const household = await requireMembership(openid);
      const today = todayKey(now());
      const month = payload?.month
        ? validate.month(payload.month)
        : shiftMonth(today.slice(0, 7), -1);
      if (month > today.slice(0, 7))
        throw new ApiError('VALIDATION', '还没到这个月。');
      const roleOf = (who) =>
        household.members.find((member) => member.openid === who)?.role || '';
      const split = (items, role) => {
        const result = { a: 0, b: 0 };
        for (const item of items) {
          const key = role(item);
          if (key === 'a' || key === 'b') result[key] += 1;
        }
        return result;
      };

      const records = await expenses.listMonth(household._id, month);
      const spent = records.filter(isSpending);
      const prevRecords = await expenses.listMonth(
        household._id,
        shiftMonth(month, -1),
      );
      const cats = new Map();
      for (const record of spent) {
        const cat = normalizeCategory(record.cat);
        cats.set(cat, (cats.get(cat) || 0) + record.amount);
      }
      const last = lastDayOfMonth(month);
      // 当月只数到今天；过去的月数满整月。
      const elapsed = Number((last < today ? last : today).slice(8));
      const weeks = [];
      for (let from = 1; from <= Number(last.slice(8)); from += 7)
        weeks.push({ from, amount: 0 });
      const byDay = new Map();
      for (const record of spent) {
        const day = Number(String(record.date).slice(8));
        byDay.set(day, (byDay.get(day) || 0) + record.amount);
        const week = weeks[Math.floor((day - 1) / 7)];
        if (week) week.amount += record.amount;
      }
      const biggest = spent.reduce(
        (best, record) =>
          !best || record.amount > best.amount ? record : best,
        null,
      );
      const peak = [...byDay].sort((x, y) => y[1] - x[1])[0];
      const total = spent.reduce((sum, record) => sum + record.amount, 0);
      const spend = {
        total,
        weeks,
        biggest: biggest
          ? {
              amount: biggest.amount,
              cat: normalizeCategory(biggest.cat),
              note: String(biggest.note || ''),
              date: biggest.date,
            }
          : null,
        peakDay: peak ? { day: peak[0], amount: peak[1] } : null,
        perDay: elapsed ? Math.round(total / elapsed) : 0,
        freeDays: Math.max(
          0,
          elapsed - [...byDay.keys()].filter((day) => day <= elapsed).length,
        ),
        count: spent.length,
        prevTotal: prevRecords.length
          ? prevRecords
              .filter(isSpending)
              .reduce((sum, record) => sum + record.amount, 0)
          : null,
        byRole: split(spent, (record) => roleOf(record.by)),
        top: [...cats]
          .map(([cat, amount]) => ({ cat, amount }))
          .sort((x, y) => y.amount - x.amount)
          .slice(0, TOP_CATS),
      };

      const done = (
        await (activity ? activity.listAll(household._id) : [])
      ).filter((entry) => String(entry.date).startsWith(month));
      const ofType = (type) =>
        done.filter((entry) => entry.type === type).sort((x, y) => x.ts - y.ts);
      const dishes = ofType('dish');
      const eaten = new Map();
      for (const entry of dishes)
        eaten.set(entry.title, (eaten.get(entry.title) || 0) + 1);
      const topDish = [...eaten].sort((x, y) => y[1] - x[1])[0];
      const todos = ofType('todo');

      const deposits = (
        goals ? await goals.listAll(household._id) : []
      ).flatMap((goal) =>
        (goal.log || []).filter((entry) =>
          String(entry.date).startsWith(month),
        ),
      );
      const saved = { total: 0, byRole: { a: 0, b: 0 } };
      for (const entry of deposits) {
        saved.total += entry.amount;
        if (entry.role === 'a' || entry.role === 'b')
          saved.byRole[entry.role] += entry.amount;
      }

      const start = (dates ? await dates.listAll(household._id) : []).find(
        (record) => record.together,
      );
      // 起点那天算第 1 天；起点还在这个月之后就是 0。
      const togetherDay = start
        ? Math.max(
            0,
            Math.round(
              (Date.parse(last < today ? last : today) -
                Date.parse(start.date)) /
                DAY_MS,
            ) + 1,
          )
        : 0;

      return {
        month,
        spend,
        meals: {
          count: dishes.length,
          top: topDish ? { title: topDish[0], count: topDish[1] } : null,
        },
        todos: {
          count: todos.length,
          byRole: split(todos, (entry) => roleOf(entry.by)),
        },
        wishes: ofType('wish')
          .slice(0, MAX_WISHES)
          .map((entry) => entry.title),
        saved,
        togetherDay,
      };
    },
  };
}

module.exports = { createRecapHandler };
