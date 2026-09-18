const { createHash } = require('node:crypto');

class GuestbookError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function validateGuestMessage(payload) {
  if (
    !payload ||
    typeof payload.signature !== 'string' ||
    payload.signature.trim().length > 30
  )
    throw new GuestbookError('VALIDATION', '署名请控制在 30 字以内。');
  if (
    typeof payload.message !== 'string' ||
    !payload.message.trim() ||
    payload.message.trim().length > 120
  )
    throw new GuestbookError('VALIDATION', '请填写 1–120 字的祝福。');
  if (payload.consent !== true)
    throw new GuestbookError('CONSENT', '请先同意隐私说明。');
  return {
    signature: payload.signature.trim(),
    message: payload.message.trim(),
    consent: true,
  };
}
function publicRecord(record) {
  if (!record) return null;
  return {
    id: record._id,
    signature: record.signature,
    message: record.message,
    consent: record.consent,
    updatedAt: record.updatedAt,
  };
}
function createGuestbookHandler({
  repository,
  getOpenId,
  getAdmins,
  canCollect = () => true,
  now = () => new Date().toISOString(),
}) {
  return async (event) => {
    const action = event?.action;
    if (
      ![
        'guestbookGetMine',
        'guestbookSave',
        'guestbookRemoveMine',
        'guestbookDashboard',
      ].includes(action)
    )
      return null;
    try {
      const openid = getOpenId();
      if (typeof openid !== 'string' || !openid)
        throw new GuestbookError(
          'UNAUTHENTICATED',
          '无法确认微信身份，请重新进入小程序。',
        );
      const id = createHash('sha256').update(openid).digest('hex');
      if (action === 'guestbookGetMine')
        return { ok: true, data: publicRecord(await repository.get(id)) };
      if (action === 'guestbookSave') {
        if (!canCollect())
          throw new GuestbookError(
            'COLLECTION_CLOSED',
            '收集已于答谢宴结束后关闭，感谢你的心意。',
          );
        const fields = validateGuestMessage(event.payload);
        const record = { ...fields, openid, updatedAt: now() };
        await repository.put(id, record);
        return { ok: true, data: publicRecord({ ...record, _id: id }) };
      }
      if (action === 'guestbookRemoveMine') {
        await repository.remove(id);
        return { ok: true, data: null };
      }
      if (!getAdmins().includes(openid))
        throw new GuestbookError(
          'FORBIDDEN',
          '仅主人可查看私密祝福。当前微信未获得管理员授权。',
        );
      const cursor = event.payload?.cursor || '';
      if (
        typeof cursor !== 'string' ||
        (cursor && !/^[a-f0-9]{64}$/.test(cursor))
      )
        throw new GuestbookError('VALIDATION', '分页信息无效，请刷新后重试。');
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
    } catch (error) {
      return {
        ok: false,
        code: error instanceof GuestbookError ? error.code : 'INTERNAL',
        message:
          error instanceof GuestbookError
            ? error.message
            : '服务暂时不可用，请稍后重试。',
      };
    }
  };
}
module.exports = { createGuestbookHandler, validateGuestMessage };
