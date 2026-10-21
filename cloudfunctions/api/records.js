const { ApiError } = require('./errors');

/**
 * 对外只返回业务字段，`by` / `editedBy` 换成角色，不暴露 openid；
 * 被修改过的记录带 editedAt 与 editedByRole。
 */
function publicRecord(record, household, fields) {
  const author = household.members.find(
    (member) => member.openid === record.by,
  );
  const result = {
    id: record._id,
    ts: record.ts,
    byRole: author ? author.role : '',
  };
  const editor = record.editedBy
    ? household.members.find((member) => member.openid === record.editedBy)
    : null;
  if (editor) {
    result.editedAt = record.editedAt;
    result.editedByRole = editor.role;
  }
  for (const field of fields) result[field] = record[field];
  return result;
}

async function requireRecord(repository, household, recordId) {
  const record = await repository.get(household._id, recordId);
  if (!record)
    throw new ApiError('NOT_FOUND', '记录不存在或已被删除，请刷新。');
  return record;
}

module.exports = { publicRecord, requireRecord };
