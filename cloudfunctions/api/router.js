const { ApiError, failure } = require('./errors');
const { createHouseholdHandler } = require('./household');
const { createArchiveHandler } = require('./archive');
const { createExpenseHandler } = require('./expenses');
const { createBillHandler } = require('./bills');
const { createTodoHandler } = require('./todos');
const { createExportHandler } = require('./export');
const { createInsightHandler } = require('./insight');
const { createGoalHandler } = require('./goals');
const { createCollectionHandlers } = require('./collections');
const { createVipHandler } = require('./vip');
const { createAssistHandler } = require('./assist');
const { createYearHandler } = require('./year');
const { createActivityLog, createActivityFeed } = require('./activity');
const {
  createRecapHandler,
  createRecapBuilder,
  lifeLines,
  lifeFingerprint,
} = require('./recap');
const { createLeaveHandler } = require('./leave');
const { createWeekly } = require('./weekly');

/** 所有 action 的唯一入口。身份只来自云函数上下文中的 openid。 */
function createRouter({
  households,
  archive,
  expenses,
  todos,
  dishes,
  wishes,
  dates,
  insights = null,
  goals = null,
  activity = null,
  storage = null,
  ai = null,
  orders = null,
  xpay = null,
  subscriptions = null,
  sender = null,
  now = () => Date.now(),
  log = (line) => console.error(line),
}) {
  const household = createHouseholdHandler({ repository: households, now });
  const requireMembership = household.requireMembership;
  const activityLog = activity
    ? createActivityLog({ repository: activity, now })
    : null;
  const vip = createVipHandler({
    households,
    orders,
    xpay,
    requireMembership,
    now,
  });
  const leave = createLeaveHandler({
    households,
    records: {
      expenses,
      todos,
      dishes,
      wishes,
      dates,
      goals,
      insights,
      activity,
    },
    storage,
    requireMembership,
    uniqueCode: household.uniqueCode,
    now,
  });
  const recapRepositories = { expenses, goals, dates, activity };
  const buildRecap = createRecapBuilder({
    repositories: recapRepositories,
    now,
  });
  // 喵喵小结一个月一段：账目加上小报里「这个月一起做的事」。
  const life = async (record, month) => {
    const recap = await buildRecap(record, month);
    return { lines: lifeLines(recap), fingerprint: lifeFingerprint(recap) };
  };
  const weekly = subscriptions
    ? createWeekly({
        subscriptions,
        households,
        expenses,
        sender,
        requireMembership,
        now,
        log,
      })
    : null;
  const actions = {
    ...household.actions,
    // 退出到一半时（新小家没建成）先补建，再读。
    async 'household.get'(openid, payload) {
      await leave.resume(openid);
      return household.actions['household.get'](openid, payload);
    },
    ...leave.actions,
    ...vip.actions,
    ...createArchiveHandler({ repository: archive, requireMembership }),
    ...createExpenseHandler({ repository: expenses, requireMembership, now }),
    ...createBillHandler({
      repository: expenses,
      households,
      requireMembership,
      now,
      ai,
    }),
    ...createInsightHandler({
      repository: expenses,
      insights,
      households,
      requireMembership,
      now,
      ai,
      life,
    }),
    ...createAssistHandler({
      households,
      requireMembership,
      now,
      ai,
    }),
    ...createYearHandler({
      repositories: { expenses, activity, wishes, goals, dates },
      households,
      insights,
      ai,
      requireMembership,
      now,
    }),
    ...createRecapHandler({
      repositories: recapRepositories,
      insights,
      requireMembership,
      now,
    }),
    ...createGoalHandler({
      repository: goals,
      expenses,
      requireMembership,
      now,
    }),
    ...createActivityFeed({ repository: activity, requireMembership, now }),
    ...createTodoHandler({
      repository: todos,
      activity: activityLog,
      requireMembership,
      now,
    }),
    ...createCollectionHandlers({
      dishes,
      wishes,
      dates,
      activity: activityLog,
      expenses,
      storage,
      requireMembership,
      now,
    }),
    ...createExportHandler({
      repositories: { expenses, todos, dishes, wishes, dates },
      requireMembership,
      now,
    }),
    ...(weekly ? weekly.actions : {}),
  };
  if (weekly) {
    // 小报页顺带告诉小程序每周小结还能收几次，不用多一次调用。
    const recapGet = actions['recap.get'];
    actions['recap.get'] = async (openid, payload) => ({
      ...(await recapGet(openid, payload)),
      weekly: await weekly.actions['weekly.get'](openid),
    });
    // 注销时把订阅次数也删掉（只有次数和日期，但带着 openid）。
    const deleteAccount = actions['account.delete'];
    actions['account.delete'] = async (openid, payload) => {
      const result = await deleteAccount(openid, payload);
      if (result?.deleted) await subscriptions.remove(openid);
      return result;
    };
  }
  /**
   * 主页一次要读的东西合成一个请求（原来是 6 个，每个都是一次云函数调用）。
   * 本月账目、清单、纪念日是主页的主体，读不到就整个报错；攒钱、TA 最近、足迹读不到时给 null，主页其余部分照常显示。
   * 同一个人的小家只读一次。足迹用轻量版（不算当天花了多少，主页用不上）。
   */
  actions['home.get'] = (openid, payload) =>
    household.scoped(async () => {
      const [month, todos, dates, goals, recent, footprints] =
        await Promise.allSettled([
          actions['expense.list'](openid, { month: payload.month }),
          actions['todo.list'](openid, {}),
          actions['date.list'](openid, {}),
          actions['goal.list'](openid, {}),
          actions['activity.recent'](openid, {}),
          actions['footprint.list'](openid, { light: true }),
        ]);
      for (const required of [month, todos, dates])
        if (required.status === 'rejected') throw required.reason;
      const optional = (result) =>
        result.status === 'fulfilled' ? result.value : null;
      return {
        month: month.value,
        todos: todos.value,
        dates: dates.value,
        goals: optional(goals),
        recent: optional(recent),
        footprints: optional(footprints),
      };
    });
  async function route(event, openid) {
    const action = event?.action;
    try {
      if (typeof openid !== 'string' || !openid)
        throw new ApiError(
          'UNAUTHENTICATED',
          '没认出你是谁，退出小程序再进来一次就好。',
        );
      const handler =
        typeof action === 'string' && Object.hasOwn(actions, action)
          ? actions[action]
          : null;
      if (!handler)
        throw new ApiError(
          'NOT_FOUND',
          '这个功能要等云端更新后才能用，过一会儿再来试试吧。',
        );
      return { ok: true, data: await handler(openid, event?.payload || {}) };
    } catch (error) {
      // 意料之外的错误打一行日志（云开发控制台能看到）：只有 action 和错误说明，不含请求内容和 openid。
      if (!(error instanceof ApiError))
        log(
          JSON.stringify({
            event: 'api',
            action: typeof action === 'string' ? action.slice(0, 40) : '',
            error: String(error?.message || error).slice(0, 120),
          }),
        );
      return failure(error);
    }
  }
  /** 微信虚拟支付的发货推送：不用 openid，发货前向微信查单。 */
  route.deliver = vip.deliver;
  /** 微信虚拟支付的退款推送：查单确认后收回会员天数。 */
  route.refund = vip.refund;
  /** 每周一的定时触发器：发上周小结。 */
  route.weekly = async () => {
    if (!weekly) return { ok: false };
    try {
      return { ok: true, data: await weekly.run() };
    } catch (error) {
      log(
        JSON.stringify({
          event: 'weekly',
          error: String(error?.message || error).slice(0, 120),
        }),
      );
      return { ok: false };
    }
  };
  return route;
}

module.exports = { createRouter };
