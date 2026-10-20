const { publicRecord } = require('./records');
const expenses = require('./expenses');
const todos = require('./todos');

const EXPORT_VERSION = 1;

/** 全部数据导出为可重新解析的 JSON 对象；不包含 openid。 */
function createExportHandler({
  expenseRepository,
  todoRepository,
  requireMembership,
  now,
}) {
  return {
    async 'data.export'(openid) {
      const household = await requireMembership(openid);
      const [expenseRows, todoRows] = await Promise.all([
        expenseRepository.listAll(household._id),
        todoRepository.listAll(household._id),
      ]);
      const sortTs = (a, b) => a.ts - b.ts;
      return {
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
        expenses: expenseRows
          .sort(sortTs)
          .map((r) => publicRecord(r, household, expenses.FIELDS)),
        todos: todoRows
          .sort(sortTs)
          .map((r) => publicRecord(r, household, todos.FIELDS)),
      };
    },
  };
}

module.exports = { createExportHandler, EXPORT_VERSION };
