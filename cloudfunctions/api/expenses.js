const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const {
  SETTLEMENT,
  summarize,
  settlementRecord,
  settlementId,
  normalizeCategory,
} = require('./ledger');
const { todayKey, lastDayOfMonth } = require('./dates');
const { publicRecord, requireRecord } = require('./records');

/** 旧分类名换成新名称（见 ledger.normalizeCategory）；没有 flow 的旧记录是支出。 */
const withCategory = (view) => ({
  ...view,
  cat: normalizeCategory(view.cat),
  flow: view.flow || 'out',
});

// src：截图导入的账目才有，记下来自哪个 App 和原始商户名（见 bills.js）。
const FIELDS = [
  'amount',
  'note',
  'cat',
  'date',
  'payer',
  'split',
  'ratio',
  'flow',
  'src',
];

/** 一句话记账一次最多存几笔。 */
const MAX_SOME = 10;

/** 计入预算的支出：不含结算和收入，口径同 summary.spending。 */
const isSpending = (record) =>
  record.cat !== SETTLEMENT && (record.flow || 'out') !== 'in';

/**
 * 记一笔或改一笔之后，这一类本月的预算用了多少：{ cat, limit, used, before }。
 * before 是这次保存之前的用量，小程序据此判断是否刚跨过 80% / 100%。没设预算或不是支出时为 null，返回里不带 budget。
 */
async function budgetOf(repository, household, record, previous = null) {
  const cat = normalizeCategory(record.cat);
  const limit = household.budgets?.[cat];
  if (!limit || !isSpending(record)) return null;
  const month = record.date.slice(0, 7);
  const used = (await repository.listMonth(household._id, month))
    .filter((item) => isSpending(item) && normalizeCategory(item.cat) === cat)
    .reduce((total, item) => total + item.amount, 0);
  const counted = (item) =>
    item &&
    isSpending(item) &&
    normalizeCategory(item.cat) === cat &&
    item.date.slice(0, 7) === month
      ? item.amount
      : 0;
  return {
    cat,
    limit,
    used,
    before: used - counted(record) + counted(previous),
  };
}

/** 设了预算的分类才在返回里带 budget。 */
const withBudget = (result, budget) =>
  budget ? { ...result, budget } : result;

function byDateDesc(a, b) {
  return b.date.localeCompare(a.date) || b.ts - a.ts;
}

/** repository: listMonth(householdId, month)、listAll(householdId)、get、insert、insertWithId(id, doc) -> 是否插入、update、remove */
function createExpenseHandler({ repository, requireMembership, now }) {
  // reactions：对方对这笔账的回应（主页「TA 最近」里点的），{ a?: 'great', b?: … }，有才返回。
  const view = (record, household) => {
    const result = withCategory(publicRecord(record, household, FIELDS));
    if (record.reactions && Object.keys(record.reactions).length)
      result.reactions = record.reactions;
    return result;
  };

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
      return withBudget(
        view({ ...record, _id: id }, household),
        await budgetOf(repository, household, record),
      );
    },
    /**
     * 一句话记账确认后一起保存（最多 MAX_SOME 笔）：都记在自己名下；开着两人分摊时支出按一人一半，
     * 和手动记一笔的默认一样，收入只算自己的。
     */
    async 'expense.addSome'(openid, payload) {
      const household = await requireMembership(openid);
      const items = payload?.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_SOME)
        throw new ApiError('VALIDATION', `一次最多记 ${MAX_SOME} 笔。`);
      const payer = household.members.find(
        (member) => member.openid === openid,
      ).role;
      const records = items.map((item) => {
        const flow = item?.flow === 'in' ? 'in' : 'out';
        return {
          ...validate.expense({
            amount: item?.amount,
            note: item?.note ?? '',
            cat: item?.cat,
            date: item?.date,
            flow,
            payer,
            split:
              household.splitting === true && flow === 'out' ? 'half' : 'self',
          }),
          householdId: household._id,
          ts: now(),
          by: openid,
        };
      });
      for (const record of records) await repository.insert(record);
      return { added: records.length };
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
      const updated = { ...existing, ...fields };
      return withBudget(
        view(updated, household),
        await budgetOf(repository, household, updated, existing),
      );
    },
    /** 回应对方记的一笔账（辛苦啦 / 好棒喵 / 贴贴）；reaction 传空串收回。不算修改，不留「改过」的痕迹。 */
    async 'expense.react'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      const reaction = payload.reaction === '' ? '' : payload.reaction;
      if (reaction !== '' && !CONTRACT.reactions.includes(reaction))
        throw new ApiError('VALIDATION', '先选一个回应吧。');
      const record = await requireRecord(repository, household, id);
      if (record.by === openid)
        throw new ApiError('VALIDATION', '只能回应对方记的账。');
      const role = household.members.find(
        (member) => member.openid === openid,
      )?.role;
      const reactions = { ...(record.reactions || {}) };
      if (reaction) reactions[role] = reaction;
      else delete reactions[role];
      await repository.update(household._id, id, { reactions });
      return view({ ...record, reactions }, household);
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
