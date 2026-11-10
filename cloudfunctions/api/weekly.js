/**
 * 每周一的「上周记账小结」订阅消息（一次性订阅）。
 *
 * - 小程序里点「订阅」，微信弹窗点了「允许」后调 weekly.subscribe，云端给这个人的次数加 1；
 *   一次性订阅是「允许一次发一条」，次数用完就不再发，想继续收要再点一次。weekly.cancel 把次数清零。
 * - 每周一早上定时触发器调 api（event.Type === 'Timer'），run() 给次数 > 0 的人发上周（周一到周日）的汇总：
 *   只发给上周小家里有记账的人；发之前先用条件更新「领走」一次次数并记下这周，重复触发也不会重发；
 *   微信说没授权（43101）就把次数清零，其他失败把次数还回去、这周不再试。
 * - subscriptions 集合一人一条，_id 是 openid：{ weekly: 剩几次, week: 最近处理过的那周的周一, updatedAt }。
 *   只存次数和日期，不存消息内容；注销时删掉。
 *
 * 金额单位为「分」。模板字段（公众平台「记账周报通知」）：
 * thing1 账本名称、time2 起止时间、amount3 上周支出、character_string8 上周结余、thing5 备注。
 */
const { settlement: SETTLEMENT } = require('./contract.json');
const { normalizeCategory } = require('./ledger');
const { todayKey, addDays } = require('./dates');

const TEMPLATE_ID = 'vsDp7r72wFcsDI3dn3ChPDN_u-6Yy3QJuMLd2jGvZOI';
const TRIGGER_NAME = 'weeklyReport';
const PAGE = 'pages/home/index';
// 一个人最多攒这么多次（微信那边也是点一次攒一次）。
const MAX_TIMES = 10;
// 一次触发最多处理多久（云函数超时 60 秒）；没处理完的等下一次触发（见 config.json）。
const RUN_BUDGET_MS = 45 * 1000;
const BATCH = 50;
const THING_MAX = 20;
// 微信说这个人没有授权（或者已经用完）。
const NO_AUTH = new Set([43101]);
// 这个 openid 不是本小程序的、或者已经不能发了：直接清零。
const GONE = new Set([40003, 43107]);

/** 上周一（YYYY-MM-DD，中国时间）。 */
function lastWeekStart(now) {
  const today = todayKey(now);
  const [y, m, d] = today.split('-').map(Number);
  // 0 = 周一 … 6 = 周日
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(today, -weekday - 7);
}

/** 元：整数不带小数，否则两位小数。 */
function yuanText(fen) {
  const sign = fen < 0 ? '-' : '';
  const value = Math.abs(Math.round(fen));
  const cents = value % 100;
  return `${sign}${Math.floor(value / 100)}${cents ? '.' + String(cents).padStart(2, '0') : ''}`;
}

/** thing 类字段：最多 20 个字，去掉表情（模板消息不收）。 */
function thing(text) {
  const clean = String(text)
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...clean].slice(0, THING_MAX).join('');
}

function bookName(household) {
  const names = household.members
    .map((member) => thing(member.name || ''))
    .filter(Boolean);
  const name =
    names.length === 2
      ? `${names[0]}和${names[1]}的小账本`
      : names.length === 1
        ? `${names[0]}的小账本`
        : '';
  return name && [...name].length <= THING_MAX ? name : '我们的小账本';
}

/** 上周的汇总；上周一笔都没记（结算不算）返回 null。records 包括前一周的，用来比较。 */
function weekReport(household, records, start) {
  const end = addDays(start, 6);
  const prevStart = addDays(start, -7);
  const counted = records.filter((record) => record.cat !== SETTLEMENT);
  const week = counted.filter(
    (record) => record.date >= start && record.date <= end,
  );
  if (!week.length) return null;
  const spent = week.filter((record) => record.flow !== 'in');
  const spend = spent.reduce((sum, record) => sum + record.amount, 0);
  const income = week
    .filter((record) => record.flow === 'in')
    .reduce((sum, record) => sum + record.amount, 0);
  const prevSpend = counted
    .filter(
      (record) =>
        record.date >= prevStart && record.date < start && record.flow !== 'in',
    )
    .reduce((sum, record) => sum + record.amount, 0);
  const cats = new Map();
  for (const record of spent) {
    const cat = normalizeCategory(record.cat);
    cats.set(cat, (cats.get(cat) || 0) + record.amount);
  }
  const top = [...cats].sort((x, y) => y[1] - x[1])[0];
  let note;
  if (!spent.length) note = `记了${week.length}笔，没有支出`;
  else if (prevSpend > spend)
    note = `比前一周少花了${yuanText(prevSpend - spend)}元，真棒`;
  else note = `记了${week.length}笔，${top[0]}花得最多`;
  return {
    start,
    end,
    spend,
    income,
    count: week.length,
    data: {
      thing1: { value: bookName(household) },
      time2: { value: `${start}~${end}` },
      amount3: { value: `¥${yuanText(spend)}` },
      character_string8: { value: yuanText(income - spend) },
      thing5: { value: thing(note) },
    },
  };
}

function createWeekly({
  subscriptions,
  households,
  expenses,
  sender = null,
  requireMembership,
  now = () => Date.now(),
  log = (line) => console.error(line),
}) {
  const status = async (openid) => {
    const doc = await subscriptions.get(openid);
    return { times: Math.max(0, Number(doc?.weekly) || 0) };
  };

  const actions = {
    /** { times }：还能收几次。 */
    'weekly.get': (openid) => status(openid),
    /** 微信弹窗点了「允许」之后调用：次数加 1（最多 MAX_TIMES）。 */
    async 'weekly.subscribe'(openid) {
      await requireMembership(openid);
      await subscriptions.add(openid, MAX_TIMES, now());
      return status(openid);
    },
    /** 不想收了：次数清零（微信那边的授权留着也不会再发）。 */
    async 'weekly.cancel'(openid) {
      await subscriptions.clear(openid, now());
      return { times: 0 };
    },
  };

  /**
   * 定时触发：给该发的人发上周小结。返回 { week, sent, skipped, failed, more }，
   * more 为 true 表示这次没处理完（下一次触发接着做）。
   */
  async function run() {
    const started = now();
    const week = lastWeekStart(started);
    const result = { week, sent: 0, skipped: 0, failed: 0, more: false };
    if (!sender) {
      log(JSON.stringify({ event: 'weekly', error: 'WX_APPID 未配置' }));
      return result;
    }
    // 两人都订了时，同一个小家只算一次。
    const reports = new Map();
    const reportOf = async (household) => {
      if (!reports.has(household._id))
        reports.set(
          household._id,
          weekReport(
            household,
            await expenses.listSince(household._id, addDays(week, -7)),
            week,
          ),
        );
      return reports.get(household._id);
    };
    let after = '';
    for (;;) {
      const due = await subscriptions.listDue(week, after, BATCH);
      for (const doc of due) {
        if (now() - started > RUN_BUDGET_MS) {
          result.more = true;
          return result;
        }
        after = doc._id;
        const openid = doc._id;
        const household = await households.findByMember(openid);
        const report = household ? await reportOf(household) : null;
        if (!report) {
          // 没有小家或上周没记账：这周跳过，次数留着。
          await subscriptions.markWeek(openid, week);
          result.skipped += 1;
          continue;
        }
        if (!(await subscriptions.claim(openid, week))) continue;
        let errcode;
        try {
          errcode = await sender.send({
            openid,
            templateId: TEMPLATE_ID,
            page: PAGE,
            data: report.data,
          });
        } catch (error) {
          errcode = String(error?.message || error).slice(0, 60);
        }
        if (errcode === 0) {
          result.sent += 1;
          continue;
        }
        result.failed += 1;
        if (NO_AUTH.has(errcode) || GONE.has(errcode))
          await subscriptions.clear(openid, now());
        else await subscriptions.giveBack(openid);
        // 日志不含 openid 和内容。
        log(JSON.stringify({ event: 'weekly', week, error: errcode }));
      }
      if (due.length < BATCH) return result;
    }
  }

  return { actions, run };
}

/** 定时触发器的 event：只认我们自己的触发器名字，并且这次调用不是用户发起的（没有 openid）。 */
function isWeeklyTrigger(event, openid) {
  return (
    !openid && event?.Type === 'Timer' && event?.TriggerName === TRIGGER_NAME
  );
}

module.exports = {
  createWeekly,
  isWeeklyTrigger,
  weekReport,
  lastWeekStart,
  yuanText,
  thing,
  bookName,
  TEMPLATE_ID,
  TRIGGER_NAME,
  MAX_TIMES,
};
