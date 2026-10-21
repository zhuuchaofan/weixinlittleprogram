const { ApiError } = require('./errors');
const validate = require('./validate');
const {
  SETTLEMENT,
  summarize,
  settlementRecord,
  settlementId,
  normalizeCategory,
} = require('./ledger');
const { todayKey, lastDayOfMonth } = require('./dates');
const { publicRecord, requireRecord } = require('./records');

/** 旧分类名换成新名称（见 ledger.normalizeCategory）。 */
const withCategory = (view) => ({ ...view, cat: normalizeCategory(view.cat) });

const FIELDS = ['amount', 'note', 'cat', 'date', 'payer', 'split'];

function byDateDesc(a, b) {
  return b.date.localeCompare(a.date) || b.ts - a.ts;
}

/** repository: listMonth(householdId, month)、listAll(householdId)、get、insert、insertWithId(id, doc) -> 是否插入、update、remove */
function createExpenseHandler({ repository, requireMembership, now }) {
  const view = (record, household) =>
    withCategory(publicRecord(record, household, FIELDS));

  async function monthView(household, month) {
    const records = (await repository.listMonth(household._id, month)).sort(
      byDateDesc,
    );
    return {
      month,
      records: records.map((record) => view(record, household)),
      summary: summarize(records),
    };
  }

  return {
    async 'expense.list'(openid, payload) {
      const household = await requireMembership(openid);
      return monthView(household, validate.month(payload.month));
    },
    async 'expense.get'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      return view(await requireRecord(repository, household, id), household);
    },
    async 'expense.add'(openid, payload) {
      const household = await requireMembership(openid);
      const record = {
        ...validate.expense(payload),
        householdId: household._id,
        ts: now(),
        by: openid,
      };
      const id = await repository.insert(record);
      return view({ ...record, _id: id }, household);
    },
    async 'expense.update'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      const existing = await requireRecord(repository, household, id);
      if (existing.cat === SETTLEMENT)
        throw new ApiError(
          'VALIDATION',
          '结算记录不能修改，可以删除后重新结算。',
        );
      const fields = {
        ...validate.expense(payload),
        // 记下最后一次是谁、什么时候改的：两人都能改，但改动留得下痕迹。
        editedBy: openid,
        editedAt: now(),
      };
      await repository.update(household._id, id, fields);
      return view({ ...existing, ...fields }, household);
    },
    async 'expense.remove'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      await requireRecord(repository, household, id);
      await repository.remove(household._id, id);
      return null;
    },
    async 'expense.settle'(openid, payload) {
      const household = await requireMembership(openid);
      const month = validate.month(payload.month);
      const records = await repository.listMonth(household._id, month);
      const today = todayKey(now());
      // 结算记录必须落在该月内，才能把该月的 net 归零。
      const date = today.startsWith(month) ? today : lastDayOfMonth(month);
      const settlement = settlementRecord(records, date);
      if (!settlement)
        throw new ApiError('ALREADY_SETTLED', '本月已经结清了。');
      // 对方已基于同一份账目结算时插入失败，不会生成第二条结算记录。
      const inserted = await repository.insertWithId(
        settlementId(household._id, month, records),
        { ...settlement, householdId: household._id, ts: now(), by: openid },
      );
      if (!inserted) throw new ApiError('ALREADY_SETTLED', '本月已经结清了。');
      return monthView(household, month);
    },
  };
}

module.exports = { createExpenseHandler, FIELDS, withCategory };
