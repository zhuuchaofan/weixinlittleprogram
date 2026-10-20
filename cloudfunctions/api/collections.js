const validate = require('./validate');
const { createCrudHandler } = require('./crud');
const { countdown } = require('./anniversary');
const { todayKey } = require('./dates');

const DISH_FIELDS = ['name', 'tag'];
const WISH_FIELDS = ['title', 'why', 'plan'];
const DATE_FIELDS = ['title', 'date', 'yearly'];

/** 吃啥（dishes）、周末（wishes）、纪念日（dates）。 */
function createCollectionHandlers({
  dishes,
  wishes,
  dates,
  requireMembership,
  now,
}) {
  const shared = { requireMembership, now };
  return {
    ...createCrudHandler({
      ...shared,
      prefix: 'dish',
      repository: dishes,
      check: validate.dish,
      fields: DISH_FIELDS,
      sort: (a, b) => a.name.localeCompare(b.name, 'zh'),
    }),
    ...createCrudHandler({
      ...shared,
      prefix: 'wish',
      repository: wishes,
      check: validate.wish,
      fields: WISH_FIELDS,
    }),
    ...createCrudHandler({
      ...shared,
      prefix: 'date',
      repository: dates,
      check: validate.anniversary,
      fields: DATE_FIELDS,
      present: (view, clock) => ({
        ...view,
        ...countdown(view.date, view.yearly, todayKey(clock())),
      }),
      // 即将到来的在前，已经过去的（不重复）放最后。
      sort: (a, b) => Number(a.passed) - Number(b.passed) || a.days - b.days,
    }),
  };
}

module.exports = {
  createCollectionHandlers,
  DISH_FIELDS,
  WISH_FIELDS,
  DATE_FIELDS,
};
