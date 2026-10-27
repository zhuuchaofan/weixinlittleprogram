const { randomBytes } = require('node:crypto');
const { ApiError } = require('./errors');
const { vip: VIP } = require('./contract.json');
const { DELIVER_EVENT, parseDeliver } = require('./xpay');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRANT_ATTEMPTS = 5;
// 小家文档里只留最近几个已到账的订单号，用来让重复推送不会重复加天数。
const KEEP_ORDERS = 10;
// 微信查单的订单状态：2 已支付待发货、3 发货中、4 已发货，才算付过钱。
const PAID_STATUSES = [2, 3, 4];

/** 会员属于整个小家：一人开通，两人都享受。 */
function isVip(household, at) {
  return Number(household?.vip?.until) > at;
}

/** 返回给小程序的会员状态。 */
function vipView(household, at) {
  const until = Number(household?.vip?.until) || 0;
  return { active: until > at, until };
}

/** 非会员用完当天次数时附上的开通提示；会员返回空串。 */
function upgradeHint(household, at, text) {
  return isVip(household, at) ? '' : text;
}

/** 截图识别、AI 小结的每日次数：会员更多。 */
function dailyLimits(household, at, base) {
  const vip = isVip(household, at);
  return {
    images: vip ? VIP.dailyImages : base.images,
    summaries: vip ? VIP.dailySummaries : base.summaries,
  };
}

function newOutTradeNo(at) {
  // 微信要求 8–32 位，这里 1 + 9 + 12 = 22 位。
  return `V${at.toString(36)}${randomBytes(6).toString('hex')}`;
}

/**
 * households：findById(id)、setVip(id, expectedUntil, vip) -> boolean（条件更新，until 没变才写入）。
 * orders：insert(doc)、get(outTradeNo)、markDelivered(outTradeNo)。
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
      if (!household) throw new ApiError('NOT_FOUND', '小家不存在。');
      const last = household.vip?.last || [];
      if (last.includes(order.outTradeNo)) return;
      const current = Number(household.vip?.until) || 0;
      const at = now();
      const until = Math.max(current, at) + order.days * DAY_MS;
      const vip = {
        until,
        last: [...last, order.outTradeNo].slice(-KEEP_ORDERS),
      };
      if (await households.setVip(householdId, household.vip?.until, vip))
        return;
    }
    throw new ApiError('UNAVAILABLE', '会员开通冲突，请稍后重试。');
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
          dailyImages: VIP.dailyImages,
          dailySummaries: VIP.dailySummaries,
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
  };
}

module.exports = {
  createVipHandler,
  isVip,
  vipView,
  dailyLimits,
  upgradeHint,
};
