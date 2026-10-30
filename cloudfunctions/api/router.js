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
const { createActivityLog, createActivityFeed } = require('./activity');
const { createLeaveHandler } = require('./leave');

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
  ai = null,
  orders = null,
  xpay = null,
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
    requireMembership,
    uniqueCode: household.uniqueCode,
    now,
  });
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
    }),
    ...createAssistHandler({
      repositories: { dishes, dates },
      households,
      requireMembership,
      now,
      ai,
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
      requireMembership,
      now,
    }),
    ...createExportHandler({
      repositories: { expenses, todos, dishes, wishes, dates },
      requireMembership,
      now,
    }),
  };
  async function route(event, openid) {
    const action = event?.action;
    try {
      if (typeof openid !== 'string' || !openid)
        throw new ApiError(
          'UNAUTHENTICATED',
          '无法确认微信身份，请重新进入小程序。',
        );
      const handler =
        typeof action === 'string' && Object.hasOwn(actions, action)
          ? actions[action]
          : null;
      if (!handler) throw new ApiError('NOT_FOUND', '不支持的操作。');
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
  return route;
}

module.exports = { createRouter };
