const validate = require('./validate');
const { createCrudHandler } = require('./crud');
const { countdown, together } = require('./anniversary');
const { todayKey } = require('./dates');

const DISH_FIELDS = ['name', 'kind', 'tag', 'ateOn'];

/** 没有 kind 的旧记录当作菜品。 */
const withDishKind = (view) => ({ ...view, kind: view.kind || 'dish' });
const WISH_FIELDS = ['title', 'why', 'plan', 'done', 'doneOn'];
const DATE_FIELDS = ['title', 'date', 'yearly', 'together'];

/**
 * 吃啥（dishes）、想去（wishes）、纪念日（dates）。
 * activity：createActivityLog() 的返回值，记下每次「就吃这个」和「去过了」；没有时不记。
 */
function createCollectionHandlers({
  dishes,
  wishes,
  dates,
  activity = null,
  requireMembership,
  now,
}) {
  const shared = { requireMembership, now };
  /** 「在一起的起点」全家只留一个：新设的把别的取消。 */
  const keepOneTogether = async (household, keepId) => {
    for (const record of await dates.listAll(household._id))
      if (record.together && record._id !== keepId)
        await dates.update(household._id, record._id, { together: false });
  };
  const dateCrud = createCrudHandler({
    ...shared,
    prefix: 'date',
    repository: dates,
    check: validate.anniversary,
    fields: DATE_FIELDS,
    present: (view, clock) => {
      const today = todayKey(clock());
      const result = {
        ...view,
        together: view.together === true,
        ...countdown(view.date, view.yearly, today),
      };
      if (!result.together) return result;
      const { day, milestone } = together(view.date, today);
      return { ...result, togetherDay: day, milestone };
    },
    // 即将到来的在前，已经过去的（不重复）放最后。
    sort: (a, b) => Number(a.passed) - Number(b.passed) || a.days - b.days,
    async onUpdate(household, openid, id, before, after) {
      if (after.together) await keepOneTogether(household, id);
    },
  });
  const dateHandlers = {
    ...dateCrud,
    async 'date.add'(openid, payload) {
      const added = await dateCrud['date.add'](openid, payload);
      if (added.together)
        await keepOneTogether(await requireMembership(openid), added.id);
      return added;
    },
  };
  return {
    ...createCrudHandler({
      ...shared,
      prefix: 'dish',
      repository: dishes,
      check: validate.dish,
      fields: DISH_FIELDS,
      present: withDishKind,
      sort: (a, b) => a.name.localeCompare(b.name, 'zh'),
      async onUpdate(household, openid, id, before, after) {
        if (activity && after.ateOn && after.ateOn !== before.ateOn)
          await activity.add(household, openid, {
            type: 'dish',
            refId: id,
            title: after.name,
            date: after.ateOn,
          });
      },
    }),
    ...createCrudHandler({
      ...shared,
      prefix: 'wish',
      repository: wishes,
      check: validate.wish,
      fields: WISH_FIELDS,
      async onUpdate(household, openid, id, before, after) {
        if (!activity || Boolean(before.done) === after.done) return;
        if (after.done)
          await activity.add(household, openid, {
            type: 'wish',
            refId: id,
            title: after.title,
            date: after.doneOn || todayKey(now()),
          });
        else
          await activity.remove(household, {
            type: 'wish',
            refId: id,
            date: before.doneOn,
          });
      },
    }),
    ...dateHandlers,
  };
}

module.exports = {
  createCollectionHandlers,
  DISH_FIELDS,
  withDishKind,
  WISH_FIELDS,
  DATE_FIELDS,
};
