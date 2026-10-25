const { randomInt } = require('node:crypto');
const { ApiError } = require('./errors');

// 去掉 0/O、1/I 等容易看错的字符。
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_MEMBERS = 2;
const DEFAULT_CITY = '东京';
const DEFAULT_CURRENCY = 'CNY';
const { ARCHIVE_ID } = require('./archive-id');

function makeInviteCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name.length >= 1 && name.length <= 12 ? name : '';
}

function requireName(value) {
  const name = cleanName(value);
  if (!name) throw new ApiError('VALIDATION', '请填写 1–12 字的称呼。');
  return name;
}

function cleanCity(value) {
  if (typeof value !== 'string') return '';
  const city = value.trim();
  return city.length >= 1 && city.length <= 20 ? city : '';
}

/** 返回给小程序的视图：不包含任何 openid。 */
function publicHousehold(household, openid) {
  if (!household) return null;
  const me = household.members.find((member) => member.openid === openid);
  return {
    id: household._id,
    city: household.city,
    currency: household.currency,
    inviteCode:
      household.members.length < MAX_MEMBERS ? household.inviteCode : '',
    myRole: me ? me.role : '',
    // 只有主人在控制台标记过的小家才有答谢宴归档入口。
    archive: household.archive === ARCHIVE_ID ? ARCHIVE_ID : '',
    // 两人分摊与结算：默认关闭，只记账。
    splitting: household.splitting === true,
    members: household.members.map((member) => ({
      role: member.role,
      name: member.name,
      isMe: member.openid === openid,
    })),
  };
}

/**
 * households 仓储接口：
 * findByMember(openid)、findByCode(code)、insert(doc) -> id、
 * addMember(id, code, member) -> boolean（原子地从 1 人变 2 人）、
 * update(id, fields)
 */
function createHouseholdHandler({
  repository,
  now = () => Date.now(),
  makeCode = makeInviteCode,
}) {
  async function requireMembership(openid) {
    const household = await repository.findByMember(openid);
    if (!household)
      throw new ApiError('NO_HOUSEHOLD', '还没有加入小家，请先创建或加入。');
    return household;
  }

  async function uniqueCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      if (!(await repository.findByCode(code))) return code;
    }
    throw new ApiError('UNAVAILABLE', '邀请码生成失败，请重试。');
  }

  const actions = {
    async 'household.get'(openid) {
      return publicHousehold(await repository.findByMember(openid), openid);
    },
    async 'household.create'(openid, payload) {
      const name = requireName(payload?.name);
      if (await repository.findByMember(openid))
        throw new ApiError('ALREADY_MEMBER', '你已经在一个小家里了。');
      const doc = {
        inviteCode: await uniqueCode(),
        members: [{ openid, role: 'a', name }],
        memberCount: 1,
        city: DEFAULT_CITY,
        currency: DEFAULT_CURRENCY,
        ts: now(),
        by: openid,
      };
      const id = await repository.insert(doc);
      return publicHousehold({ ...doc, _id: id }, openid);
    },
    async 'household.join'(openid, payload) {
      const name = requireName(payload?.name);
      const code =
        typeof payload?.code === 'string'
          ? payload.code.trim().toUpperCase()
          : '';
      if (!CODE_PATTERN.test(code))
        throw new ApiError('VALIDATION', '请输入 6 位邀请码。');
      if (await repository.findByMember(openid))
        throw new ApiError('ALREADY_MEMBER', '你已经在一个小家里了。');
      const household = await repository.findByCode(code);
      if (!household || household.members.length >= MAX_MEMBERS)
        throw new ApiError('INVALID_CODE', '邀请码无效或已被使用。');
      const member = { openid, role: 'b', name };
      const joined = await repository.addMember(household._id, code, member);
      if (!joined) throw new ApiError('INVALID_CODE', '邀请码无效或已被使用。');
      return publicHousehold(
        { ...household, members: [...household.members, member] },
        openid,
      );
    },
    async 'household.update'(openid, payload) {
      const household = await requireMembership(openid);
      const fields = {};
      if (payload?.city !== undefined) {
        const city = cleanCity(payload.city);
        if (!city) throw new ApiError('VALIDATION', '城市请填写 1–20 字。');
        fields.city = city;
      }
      if (payload?.name !== undefined) {
        const name = requireName(payload.name);
        fields.members = household.members.map((member) =>
          member.openid === openid ? { ...member, name } : member,
        );
      }
      if (payload?.splitting !== undefined) {
        if (typeof payload.splitting !== 'boolean')
          throw new ApiError('VALIDATION', '请选择是否开启两人分摊。');
        fields.splitting = payload.splitting;
      }
      if (!Object.keys(fields).length)
        throw new ApiError('VALIDATION', '没有需要保存的内容。');
      await repository.update(household._id, fields);
      return publicHousehold({ ...household, ...fields }, openid);
    },
  };

  return { actions, requireMembership };
}

module.exports = {
  createHouseholdHandler,
  publicHousehold,
  makeInviteCode,
  CODE_PATTERN,
};
