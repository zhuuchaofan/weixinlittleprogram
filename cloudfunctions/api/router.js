const { ApiError, failure } = require('./errors');
const { createHouseholdHandler } = require('./household');
const { createArchiveHandler } = require('./archive');
const { createExpenseHandler } = require('./expenses');
const { createBillHandler } = require('./bills');
const { createTodoHandler } = require('./todos');
const { createExportHandler } = require('./export');
const { createInsightHandler } = require('./insight');
const { createCollectionHandlers } = require('./collections');

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
  vision = null,
  now = () => Date.now(),
}) {
  const household = createHouseholdHandler({ repository: households, now });
  const requireMembership = household.requireMembership;
  const actions = {
    ...household.actions,
    ...createArchiveHandler({ repository: archive, requireMembership }),
    ...createExpenseHandler({ repository: expenses, requireMembership, now }),
    ...createBillHandler({
      repository: expenses,
      households,
      requireMembership,
      now,
      vision,
    }),
    ...createInsightHandler({
      repository: expenses,
      insights,
      households,
      requireMembership,
      now,
      writer: vision,
    }),
    ...createTodoHandler({ repository: todos, requireMembership, now }),
    ...createCollectionHandlers({
      dishes,
      wishes,
      dates,
      requireMembership,
      now,
    }),
    ...createExportHandler({
      repositories: { expenses, todos, dishes, wishes, dates },
      requireMembership,
      now,
    }),
  };
  return async function route(event, openid) {
    try {
      if (typeof openid !== 'string' || !openid)
        throw new ApiError(
          'UNAUTHENTICATED',
          '无法确认微信身份，请重新进入小程序。',
        );
      const action = event?.action;
      const handler =
        typeof action === 'string' && Object.hasOwn(actions, action)
          ? actions[action]
          : null;
      if (!handler) throw new ApiError('NOT_FOUND', '不支持的操作。');
      return { ok: true, data: await handler(openid, event?.payload || {}) };
    } catch (error) {
      return failure(error);
    }
  };
}

module.exports = { createRouter };
