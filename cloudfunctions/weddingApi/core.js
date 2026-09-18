const { createHash } = require('node:crypto');
class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function validate(payload) {
  if (
    !payload ||
    typeof payload.guestName !== 'string' ||
    !payload.guestName.trim() ||
    payload.guestName.trim().length > 30
  )
    throw new ApiError('VALIDATION', '请填写 1–30 字的称呼。');
  if (typeof payload.attending !== 'boolean')
    throw new ApiError('VALIDATION', '请选择是否到场。');
  if (
    !Number.isInteger(payload.partySize) ||
    (payload.attending
      ? payload.partySize < 1 || payload.partySize > 10
      : payload.partySize !== 0)
  )
    throw new ApiError(
      'VALIDATION',
      '到场总人数需为 1–10 人（含本人），未到场需为 0 人。',
    );
  if (typeof payload.note !== 'string' || payload.note.length > 200)
    throw new ApiError('VALIDATION', '备注最多 200 字。');
  if (payload.consent !== true)
    throw new ApiError('CONSENT', '请先同意隐私说明。');
  return {
    guestName: payload.guestName.trim(),
    attending: payload.attending,
    partySize: payload.partySize,
    note: payload.note.trim(),
    consent: true,
  };
}
function publicRecord(record) {
  if (!record) return null;
  return {
    id: record._id,
    guestName: record.guestName,
    attending: record.attending,
    partySize: record.partySize,
    note: record.note,
    consent: record.consent,
    updatedAt: record.updatedAt,
  };
}
function createHandler({
  repository,
  getOpenId,
  getAdmins,
  canCollect = () => true,
  now = () => new Date().toISOString(),
}) {
  return async (event) => {
    try {
      const openid = getOpenId();
      if (typeof openid !== 'string' || !openid)
        throw new ApiError(
          'UNAUTHENTICATED',
          '无法确认微信身份，请重新进入小程序。',
        );
      // ID 由服务端身份决定。并发 set 同一文档仍只有一条记录。
      const id = createHash('sha256').update(openid).digest('hex');
      const { action, payload } = event || {};
      if (action === 'getMine')
        return { ok: true, data: publicRecord(await repository.get(id)) };
      if (action === 'save') {
        if (!canCollect())
          throw new ApiError(
            'COLLECTION_CLOSED',
            '收集已于答谢宴结束后关闭，感谢你的心意。',
          );
        const fields = validate(payload);
        const record = { ...fields, openid, updatedAt: now() };
        await repository.put(id, record);
        return { ok: true, data: publicRecord({ ...record, _id: id }) };
      }
      if (action === 'removeMine') {
        await repository.remove(id);
        return { ok: true, data: null };
      }
      if (action === 'dashboard') {
        // 不相信前端角色、OpenID、隐藏入口或 mock 开关。空白名单一律拒绝。
        if (!getAdmins().includes(openid))
          throw new ApiError(
            'FORBIDDEN',
            '仅主人可查看登记。当前微信未获得管理员授权。',
          );
        const cursor = payload?.cursor || '';
        if (
          typeof cursor !== 'string' ||
          (cursor && !/^[a-f0-9]{64}$/.test(cursor))
        )
          throw new ApiError('VALIDATION', '分页信息无效，请刷新后重试。');
        const [rows, summary] = await Promise.all([
          repository.list(cursor),
          repository.summary(),
        ]);
        return {
          ok: true,
          data: {
            records: rows.map(publicRecord),
            summary,
            nextCursor: rows.length === 50 ? rows[rows.length - 1]._id : '',
          },
        };
      }
      throw new ApiError('NOT_FOUND', '不支持的操作。');
    } catch (error) {
      // 不记录姓名、备注、OpenID 或请求体。
      return {
        ok: false,
        code: error instanceof ApiError ? error.code : 'INTERNAL',
        message:
          error instanceof ApiError
            ? error.message
            : '服务暂时不可用，请稍后重试。',
      };
    }
  };
}
module.exports = { validate, createHandler };
