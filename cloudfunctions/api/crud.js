const validate = require('./validate');
const { publicRecord, requireRecord } = require('./records');

/**
 * 一类业务记录的增删改查：`${prefix}.list/add/update/remove`。
 * 更新时把已有字段与传入字段合并后整体校验，只改部分字段也安全。
 */
function createCrudHandler({
  prefix,
  repository,
  requireMembership,
  now,
  check,
  fields,
  present = (view) => view,
  sort = (a, b) => b.ts - a.ts,
}) {
  const view = (record, household) =>
    present(publicRecord(record, household, fields), now);
  return {
    async [`${prefix}.list`](openid) {
      const household = await requireMembership(openid);
      const records = await repository.listAll(household._id);
      return records.map((record) => view(record, household)).sort(sort);
    },
    async [`${prefix}.add`](openid, payload) {
      const household = await requireMembership(openid);
      const record = {
        ...check(payload),
        householdId: household._id,
        ts: now(),
        by: openid,
      };
      const id = await repository.insert(record);
      return view({ ...record, _id: id }, household);
    },
    async [`${prefix}.update`](openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      const existing = await requireRecord(repository, household, id);
      const changes = check({ ...existing, ...payload });
      await repository.update(household._id, id, changes);
      return view({ ...existing, ...changes }, household);
    },
    async [`${prefix}.remove`](openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      await requireRecord(repository, household, id);
      await repository.remove(household._id, id);
      return null;
    },
  };
}

module.exports = { createCrudHandler };
