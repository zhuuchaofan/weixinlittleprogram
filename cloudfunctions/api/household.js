const { randomInt } = require('node:crypto');
const { ApiError } = require('./errors');
const { vipView } = require('./vip');

// 去掉 0/O、1/I 等容易看错的字符。
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_MEMBERS = 2;
const DEFAULT_CURRENCY = 'CNY';
const { ARCHIVE_ID } = require('./archive-id');
const {
  categories: CATEGORIES,
  maxAmount: MAX_AMOUNT,
} = require('./contract.json');

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

/** 分类预算：{ 分类: 每月上限（分） }；0 或不填表示这一类不设预算。 */
function cleanBudgets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('VALIDATION', '预算格式不对，请重试。');
  const budgets = {};
  for (const [cat, amount] of Object.entries(value)) {
    if (!CATEGORIES.includes(cat))
      throw new ApiError('VALIDATION', `没有「${cat}」这个分类。`);
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT)
      throw new ApiError('VALIDATION', `${cat}的预算不对，最多两位小数。`);
    if (amount) budgets[cat] = amount;
  }
  return budgets;
}

/** 我在微信 / 支付宝里显示的名字，用来在导入账单时认出两人之间的转账；可以不填，最长 20 字。 */
function cleanPayName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length > 20)
    throw new ApiError('VALIDATION', '微信名字最多 20 字。');
  return name;
}

function requireName(value) {
  const name = cleanName(value);
  if (!name) throw new ApiError('VALIDATION', '请填写 1–12 字的称呼。');
  return name;
}

/** 返回给小程序的视图：不包含任何 openid。 */
function publicHousehold(household, openid, at = Date.now()) {
  if (!household) return null;
  const me = household.members.find((member) => member.openid === openid);
  return {
    id: household._id,
    currency: household.currency,
    inviteCode:
      household.members.length < MAX_MEMBERS ? household.inviteCode : '',
    myRole: me ? me.role : '',
    // 只有主人在控制台标记过的小家才有答谢宴归档入口。
    archive: household.archive === ARCHIVE_ID ? ARCHIVE_ID : '',
    // 两人分摊与结算：默认关闭，只记账。
    splitting: household.splitting === true,
    budgets: household.budgets || {},
    // 会员属于整个小家：{ active, until（到期时间戳，没开通过为 0） }。
    vip: vipView(household, at),
    members: household.members.map((member) => ({
      role: member.role,
      name: member.name,
      isMe: member.openid === openid,
      // 只给自己看自己的；对方的只在云端用来认转账。
      ...(member.openid === openid && member.payName
        ? { payName: member.payName }
        : {}),
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
      return publicHousehold(
        await repository.findByMember(openid),
        openid,
        now(),
      );
    },
    async 'household.create'(openid, payload) {
      const name = requireName(payload?.name);
      if (await repository.findByMember(openid))
        throw new ApiError('ALREADY_MEMBER', '你已经在一个小家里了。');
      const doc = {
        inviteCode: await uniqueCode(),
        members: [{ openid, role: 'a', name }],
        memberCount: 1,
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
      if (payload?.name !== undefined) {
        const name = requireName(payload.name);
        fields.members = household.members.map((member) =>
          member.openid === openid ? { ...member, name } : member,
        );
      }
      if (payload?.payName !== undefined) {
        const payName = cleanPayName(payload.payName);
        const base = fields.members || household.members;
        fields.members = base.map((member) =>
          member.openid === openid ? { ...member, payName } : member,
        );
      }
      if (payload?.splitting !== undefined) {
        if (typeof payload.splitting !== 'boolean')
          throw new ApiError('VALIDATION', '请选择是否开启两人分摊。');
        fields.splitting = payload.splitting;
      }
      if (payload?.budgets !== undefined)
        fields.budgets = cleanBudgets(payload.budgets);
      if (!Object.keys(fields).length)
        throw new ApiError('VALIDATION', '没有需要保存的内容。');
      await repository.update(household._id, fields);
      return publicHousehold({ ...household, ...fields }, openid, now());
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
