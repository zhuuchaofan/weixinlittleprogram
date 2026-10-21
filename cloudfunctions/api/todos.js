const validate = require('./validate');
const { publicRecord, requireRecord } = require('./records');

const FIELDS = ['text', 'kind', 'who', 'done'];

/** repository: listAll(householdId)、get、insert、update、remove、removeWhere */
function createTodoHandler({ repository, requireMembership, now }) {
  const view = (record, household) => publicRecord(record, household, FIELDS);
  return {
    async 'todo.list'(openid) {
      const household = await requireMembership(openid);
      const records = await repository.listAll(household._id);
      // 未完成在前，各自按创建时间倒序。
      records.sort((a, b) => Number(a.done) - Number(b.done) || b.ts - a.ts);
      return records.map((record) => view(record, household));
    },
    async 'todo.get'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      return view(await requireRecord(repository, household, id), household);
    },
    async 'todo.add'(openid, payload) {
      const household = await requireMembership(openid);
      const record = {
        ...validate.todo({ ...payload, done: false }),
        householdId: household._id,
        ts: now(),
        by: openid,
      };
      const id = await repository.insert(record);
      return view({ ...record, _id: id }, household);
    },
    async 'todo.update'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      const existing = await requireRecord(repository, household, id);
      const fields = validate.todo({ ...existing, ...payload });
      await repository.update(household._id, id, fields);
      return view({ ...existing, ...fields }, household);
    },
    /** 清除某一类清单里所有已完成的条目，返回删除条数。 */
    async 'todo.clearDone'(openid, payload) {
      const household = await requireMembership(openid);
      const kind = validate.todoKind(payload.kind);
      const removed = await repository.removeWhere(household._id, {
        kind,
        done: true,
      });
      return { removed };
    },
    async 'todo.remove'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      await requireRecord(repository, household, id);
      await repository.remove(household._id, id);
      return null;
    },
  };
}

module.exports = { createTodoHandler, FIELDS };
