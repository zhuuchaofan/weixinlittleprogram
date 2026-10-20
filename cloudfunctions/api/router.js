const { ApiError, failure } = require('./errors');
const { createHouseholdHandler } = require('./household');
const { createArchiveHandler } = require('./archive');

/** 所有 action 的唯一入口。身份只来自云函数上下文中的 openid。 */
function createRouter({ households, archive, now }) {
  const household = createHouseholdHandler({ repository: households, now });
  const actions = {
    ...household.actions,
    ...createArchiveHandler({
      repository: archive,
      requireMembership: household.requireMembership,
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
