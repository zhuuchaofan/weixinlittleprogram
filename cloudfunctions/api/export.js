const { publicRecord } = require('./records');
const expenses = require('./expenses');
const todos = require('./todos');
const { DISH_FIELDS, WISH_FIELDS, DATE_FIELDS } = require('./collections');

const EXPORT_VERSION = 1;

/**
 * 全部数据导出为可重新解析的 JSON 对象；不包含 openid。
 * 每个集合都读完整（与 count() 核对），`counts` 记录各集合条数，便于核对备份。
 */
function createExportHandler({ repositories, requireMembership, now }) {
  const sections = [
    ['expenses', expenses.FIELDS],
    ['todos', todos.FIELDS],
    ['dishes', DISH_FIELDS],
    ['wishes', WISH_FIELDS],
    ['dates', DATE_FIELDS],
  ];
  return {
    async 'data.export'(openid) {
      const household = await requireMembership(openid);
      const rows = await Promise.all(
        sections.map(([name]) =>
          repositories[name].readComplete(household._id),
        ),
      );
      const result = {
        version: EXPORT_VERSION,
        exportedAt: new Date(now()).toISOString(),
        household: {
          city: household.city,
          currency: household.currency,
          members: household.members.map((m) => ({
            role: m.role,
            name: m.name,
          })),
        },
        counts: {},
      };
      sections.forEach(([name, fields], index) => {
        result.counts[name] = rows[index].length;
        result[name] = rows[index]
          .sort((a, b) => a.ts - b.ts)
          .map((record) => publicRecord(record, household, fields));
      });
      return result;
    },
  };
}

module.exports = { createExportHandler, EXPORT_VERSION };
