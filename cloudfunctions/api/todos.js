const validate = require('./validate');
const { publicRecord, requireRecord } = require('./records');
const { todayKey, nextOccurrence } = require('./dates');

// doneOn：勾完那天（YYYY-MM-DD），没勾或取消勾选为空；年度回顾按它数。
// repeat：重复周期（空、daily、weekly、monthly）；勾完时生成下一条，dueOn 是下一条要做的那天，没到之前清单里先折起来。
// spawnedId 只在云端用：取消勾选时把刚生成的下一条删掉。
const FIELDS = ['text', 'kind', 'who', 'done', 'doneOn', 'repeat', 'dueOn'];

/**
 * repository: listAll(householdId)、get、insert、update、remove、removeWhere。
 * activity：createActivityLog() 的返回值，勾完一条记一笔（「清除已完成」后也还在）；没有时不记。
 */
function createTodoHandler({
  repository,
  activity = null,
  requireMembership,
  now,
}) {
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
        doneOn: '',
        dueOn: '',
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
      // dueOn 只由「勾完生成下一条」写入，不接受传入。
      const checked = validate.todo({
        ...existing,
        ...payload,
        dueOn: existing.dueOn || '',
      });
      const justDone = checked.done && !existing.done;
      const fields = {
        ...checked,
        doneOn: !checked.done
          ? ''
          : justDone
            ? todayKey(now())
            : existing.doneOn || '',
      };
      if (justDone && checked.repeat)
        fields.spawnedId = await repository.insert({
          text: checked.text,
          kind: checked.kind,
          who: checked.who,
          done: false,
          doneOn: '',
          repeat: checked.repeat,
          dueOn: nextOccurrence(fields.doneOn, checked.repeat),
          householdId: household._id,
          ts: now(),
          by: existing.by,
        });
      if (existing.done && !checked.done && existing.spawnedId) {
        // 取消勾选：刚生成的下一条还没动过就删掉，免得重复。
        const next = await repository.get(household._id, existing.spawnedId);
        if (next && !next.done)
          await repository.remove(household._id, existing.spawnedId);
        fields.spawnedId = '';
      }
      await repository.update(household._id, id, fields);
      if (activity && justDone)
        await activity.add(household, openid, {
          type: 'todo',
          refId: id,
          title: fields.text,
          kind: fields.kind,
          date: fields.doneOn,
        });
      if (activity && existing.done && !checked.done)
        await activity.remove(household, {
          type: 'todo',
          refId: id,
          date: existing.doneOn,
        });
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
