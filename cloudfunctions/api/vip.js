const { randomBytes } = require('node:crypto');
const { ApiError } = require('./errors');
const { vip: VIP, ai: QUOTAS } = require('./contract.json');
const {
  DELIVER_EVENT,
  REFUND_EVENT,
  parseDeliver,
  parseRefund,
} = require('./xpay');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRANT_ATTEMPTS = 5;
// 小家文档里只留最近几个已到账的订单号，用来让重复推送不会重复加天数。
const KEEP_ORDERS = 10;
// 微信查单的订单状态：2 已支付待发货、3 发货中、4 已发货，才算付过钱。
const PAID_STATUSES = [2, 3, 4];
// 5 已退款、8 用户退款完成：查单没给剩余金额时，按全额退款算。
const REFUNDED_STATUSES = [5, 8];

/**
 * 限时免费：到 freeUntil 这一天（北京时间）的最后一刻，所有小家都按会员算。
 * 日期来自 contract.json 的 vip.freeUntil；云函数环境变量 VIP_FREE_UNTIL 可以覆盖
 * （填 YYYY-MM-DD 改日期，填 off 立刻结束），不用发版。返回时间戳，没有限免为 0。
 */
function freeUntilOf(env = process.env) {
  const value = String(env.VIP_FREE_UNTIL ?? VIP.freeUntil ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
  return Date.parse(`${value}T23:59:59.999+08:00`) || 0;
}

/** 会员属于整个小家：一人开通，两人都享受；限免期间所有人都算。 */
function isVip(household, at) {
  return Number(household?.vip?.until) > at || freeUntilOf() > at;
}

/**
 * 返回给小程序的会员状态：active / until 只说真正开通的会员（退出、注销按它算天数），
 * free 是限免截止时间戳（限免中才有，否则 0），member 是现在能不能用会员功能。
 */
function vipView(household, at) {
  const until = Number(household?.vip?.until) || 0;
  const free = freeUntilOf() > at ? freeUntilOf() : 0;
  return { active: until > at, until, free, member: until > at || free > 0 };
}

/** 微信查单结果里这笔一共退了多少钱（分），不超过订单价。 */
function refundedFee(remote, price) {
  const left = Number(remote.left_fee);
  const fee = Number.isFinite(left)
    ? price - left
    : REFUNDED_STATUSES.includes(remote.status)
      ? price
      : 0;
  return Math.min(Math.max(fee, 0), price);
}

function newOutTradeNo(at) {
  // 微信要求 8–32 位，这里 1 + 9 + 12 = 22 位。
  return `V${at.toString(36)}${randomBytes(6).toString('hex')}`;
}

/**
 * households：findById(id)、setVip(id, expectedUntil, vip) -> boolean（条件更新，until 没变才写入）。
 * orders：insert(doc)、get(outTradeNo)、markDelivered(outTradeNo)、markRefunded(outTradeNo, fee)。
 * xpay：createXpay() 的返回值；没有配置时为 null。
 */
function createVipHandler({
  households,
  orders,
  xpay,
  requireMembership,
  now,
}) {
  /** 在原有到期日（已过期则从现在）之后加上天数；同一个订单号只加一次。 */
  async function grant(householdId, order) {
    for (let attempt = 0; attempt < GRANT_ATTEMPTS; attempt++) {
      const household = await households.findById(householdId);
      if (!household)
        throw new ApiError('NOT_FOUND', '没找到这个小家，可能已经不在了。');
      const last = household.vip?.last || [];
      if (last.includes(order.outTradeNo)) return;
      const current = Number(household.vip?.until) || 0;
      const at = now();
      const until = Math.max(current, at) + order.days * DAY_MS;
      const vip = {
        ...household.vip,
        until,
        last: [...last, order.outTradeNo].slice(-KEEP_ORDERS),
      };
      if (await households.setVip(householdId, household.vip?.until, vip))
        return;
    }
    throw new ApiError('UNAVAILABLE', '会员开通冲突，请稍后重试。');
  }

  /**
   * 按退款比例从到期日里扣掉天数（全额退款扣满这一单的天数）。
   * 小家文档里记着每笔订单已经扣到的退款金额，重复推送、部分退款都只扣差额。
   */
  async function revoke(householdId, order, refunded) {
    for (let attempt = 0; attempt < GRANT_ATTEMPTS; attempt++) {
      const household = await households.findById(householdId);
      if (!household)
        throw new ApiError('NOT_FOUND', '没找到这个小家，可能已经不在了。');
      const done = household.vip?.refunded || {};
      const before = Number(done[order.outTradeNo]) || 0;
      if (refunded <= before) return;
      const take = Math.round(
        (order.days * DAY_MS * (refunded - before)) / order.price,
      );
      const current = Number(household.vip?.until) || 0;
      const vip = {
        ...household.vip,
        until: current - take,
        refunded: Object.fromEntries(
          Object.entries({ ...done, [order.outTradeNo]: refunded }).slice(
            -KEEP_ORDERS,
          ),
        ),
      };
      if (await households.setVip(householdId, household.vip?.until, vip))
        return;
    }
    throw new ApiError('UNAVAILABLE', '会员扣减冲突，请稍后重试。');
  }

  /**
   * 退款后收回会员：向微信查单算出一共退了多少，只有已经开通过的订单才扣天数。
   * 推送本身不可信，退款金额一律以查单为准。
   */
  async function reclaim(order) {
    const remote = await xpay.queryOrder(order);
    if (!remote) return;
    const refunded = refundedFee(remote, order.price);
    if (refunded <= (Number(order.refunded) || 0)) return;
    if (order.status === 'delivered')
      await revoke(order.householdId, order, refunded);
    await orders.markRefunded(order.outTradeNo, refunded);
  }

  /**
   * 向微信查单，已支付、金额对得上就给小家加天数并标记已发货。
   * 发货推送和小程序付款后的主动查单都走这里；返回这笔是否已经到账。
   * 查单失败会抛出，由调用方决定重试。
   */
  async function settle(order) {
    if (order.status === 'delivered') return true;
    const paid = await xpay.queryOrder(order);
    if (
      !paid ||
      !PAID_STATUSES.includes(paid.status) ||
      paid.order_fee !== order.price
    )
      return false;
    await grant(order.householdId, order);
    await orders.markDelivered(order.outTradeNo);
    return true;
  }

  return {
    actions: {
      async 'vip.get'(openid) {
        const household = await requireMembership(openid);
        return {
          ...vipView(household, now()),
          available: xpay !== null,
          plans: VIP.plans,
          // 每项 AI 功能的免费 / 会员次数，会员页照着列。
          quotas: Object.entries(QUOTAS).map(([id, quota]) => ({
            id,
            ...quota,
          })),
          // 1.6.0 的会员页读这两个，留着兼容。
          dailyImages: QUOTAS.billImage.vip,
          dailySummaries: QUOTAS.summary.vip,
        };
      },
      async 'vip.order'(openid, payload) {
        const household = await requireMembership(openid);
        if (!xpay)
          throw new ApiError(
            'UNAVAILABLE',
            '会员购买还没开通：需要在云函数 api 里配置虚拟支付。',
          );
        const plan = VIP.plans.find((item) => item.id === payload?.plan);
        if (!plan) throw new ApiError('VALIDATION', '没有这个会员套餐。');
        const code = typeof payload?.code === 'string' ? payload.code : '';
        if (!code) throw new ApiError('VALIDATION', '登录状态过期，请重试。');
        const sessionKey = await xpay.sessionKey(code, openid);
        const outTradeNo = newOutTradeNo(now());
        // 价格、商品 ID 都以云端为准，客户端传来的只有套餐 ID。
        const signData = JSON.stringify({
          offerId: xpay.offerId,
          buyQuantity: 1,
          env: xpay.env,
          currencyType: 'CNY',
          productId: plan.id,
          goodsPrice: plan.price,
          outTradeNo,
          // 透传数据，发货推送里原样带回；这里放小家 ID 方便对账。
          attach: household._id,
        });
        await orders.insert({
          outTradeNo,
          openid,
          householdId: household._id,
          productId: plan.id,
          price: plan.price,
          days: plan.days,
          env: xpay.env,
          status: 'pending',
          ts: now(),
        });
        return {
          mode: 'short_series_goods',
          signData,
          ...xpay.sign(signData, sessionKey),
        };
      },
      /**
       * 小程序付款成功后主动查单：沙箱不发发货推送，现网推送也可能丢，
       * 所以不只等推送。是否到账以微信查单为准，客户端只给订单号。
       */
      async 'vip.confirm'(openid, payload) {
        const household = await requireMembership(openid);
        if (!xpay) throw new ApiError('UNAVAILABLE', '会员购买还没开通。');
        const outTradeNo =
          typeof payload?.outTradeNo === 'string' ? payload.outTradeNo : '';
        const order = outTradeNo ? await orders.get(outTradeNo) : null;
        if (!order || order.householdId !== household._id)
          throw new ApiError('NOT_FOUND', '找不到这笔订单。');
        const delivered = await settle(order);
        const fresh = (await households.findById(household._id)) || household;
        return { delivered, ...vipView(fresh, now()) };
      },
    },
    /**
     * 微信的发货推送入口（不经过 openid 身份）。推送本身不带签名，任何人都能伪造，
     * 所以订单对上之后还要向微信查单，确认已支付、金额对得上才加会员；
     * 重复推送是正常的，所以整个过程要幂等。返回 ErrCode 0 微信才不再重试。
     */
    async deliver(event) {
      const fail = (message) => ({ ErrCode: 1, ErrMsg: message });
      const done = { ErrCode: 0, ErrMsg: 'Success' };
      if (event?.Event !== DELIVER_EVENT) return fail('unsupported event');
      if (!xpay) return fail('xpay not configured');
      const push = parseDeliver(event);
      if (!push) return fail('bad payload');
      const order = await orders.get(push.outTradeNo);
      if (
        !order ||
        order.openid !== push.openid ||
        order.productId !== push.productId
      )
        return fail('order mismatch');
      try {
        if (!(await settle(order))) return fail('not paid');
      } catch {
        return fail('deliver failed');
      }
      return done;
    },
    /**
     * 微信的退款推送入口：在后台或接口退款成功后推过来，收回对应的会员天数。
     * 同样不信推送内容，查单确认退了多少钱；重复推送只扣一次。
     */
    async refund(event) {
      const fail = (message) => ({ ErrCode: 1, ErrMsg: message });
      const done = { ErrCode: 0, ErrMsg: 'Success' };
      if (event?.Event !== REFUND_EVENT) return fail('unsupported event');
      if (!xpay) return fail('xpay not configured');
      const push = parseRefund(event);
      if (!push) return fail('bad payload');
      // 退款失败时钱还在，会员照旧。
      if (!push.success) return done;
      const order = await orders.get(push.outTradeNo);
      if (!order || order.openid !== push.openid) return fail('order mismatch');
      try {
        await reclaim(order);
      } catch {
        return fail('refund failed');
      }
      return done;
    },
  };
}

module.exports = {
  createVipHandler,
  isVip,
  freeUntilOf,
  vipView,
};
