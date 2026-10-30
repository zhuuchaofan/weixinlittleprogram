const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createRouter } = require('../cloudfunctions/api/router');
const { createXpay } = require('../cloudfunctions/api/xpay');
const { isVip } = require('../cloudfunctions/api/vip');
const { limitOf, limitMessage } = require('../cloudfunctions/api/quota');
const { vip: VIP, ai: QUOTAS } = require('../cloudfunctions/api/contract.json');

// 限时免费期间所有小家都算会员；这里测的是免费 / 会员各自的行为，所以先关掉。
process.env.VIP_FREE_UNTIL = 'off';

const NOW = Date.parse('2026-10-25T04:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ENV = {
  XPAY_OFFER_ID: '1450000001',
  XPAY_APP_KEY: 'live-key',
  XPAY_SANDBOX_APP_KEY: 'sandbox-key',
  WX_APPID: 'wxapp',
  WX_APPSECRET: 'secret',
};
const hmac = (key, text) =>
  createHmac('sha256', key).update(text, 'utf8').digest('hex');

function memoryHouseholds() {
  const docs = new Map();
  let seq = 0;
  return {
    docs,
    async findByMember(openid) {
      return (
        [...docs.values()].find((d) =>
          d.members.some((m) => m.openid === openid),
        ) || null
      );
    },
    async findByCode() {
      return null;
    },
    async insert(doc) {
      const id = 'h' + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async findById(id) {
      return docs.get(id) || null;
    },
    async setVip(id, expectedUntil, vip) {
      const doc = docs.get(id);
      if (doc.vip?.until !== expectedUntil) return false;
      docs.set(id, { ...doc, vip });
      return true;
    },
    async update(id, fields) {
      docs.set(id, { ...docs.get(id), ...fields });
    },
  };
}

function memoryOrders() {
  const docs = new Map();
  return {
    docs,
    async insert(doc) {
      docs.set(doc.outTradeNo, { ...doc });
    },
    async get(outTradeNo) {
      return docs.get(outTradeNo) || null;
    },
    async markDelivered(outTradeNo) {
      docs.set(outTradeNo, { ...docs.get(outTradeNo), status: 'delivered' });
    },
    async markRefunded(outTradeNo, refunded) {
      docs.set(outTradeNo, { ...docs.get(outTradeNo), refunded });
    },
  };
}

/**
 * 假的微信服务端：
 * - jscode2session：code 形如 `code-<openid>`；
 * - stable_token：发一个固定的 access_token；
 * - query_order：校验 access_token 和 pay_sig，返回 `paid` 里登记过的订单。
 */
function fakeWechat(sessionKey = 'user-session-key') {
  const paid = new Map();
  const calls = { token: 0, query: 0 };
  async function request(url, body) {
    const { pathname, searchParams } = new URL(url);
    const reply = (data) => ({ status: 200, text: JSON.stringify(data) });
    if (pathname === '/sns/jscode2session')
      return reply({
        session_key: sessionKey,
        openid: searchParams.get('js_code').replace('code-', ''),
      });
    if (pathname === '/cgi-bin/stable_token') {
      calls.token++;
      return reply({ access_token: 'token-1', expires_in: 7200 });
    }
    if (pathname === '/xpay/query_order') {
      calls.query++;
      const request = JSON.parse(body);
      const key =
        request.env === 1 ? ENV.XPAY_SANDBOX_APP_KEY : ENV.XPAY_APP_KEY;
      if (
        searchParams.get('access_token') !== 'token-1' ||
        searchParams.get('pay_sig') !== hmac(key, `/xpay/query_order&${body}`)
      )
        return reply({ errcode: 268490003, errmsg: 'sign error' });
      const order = paid.get(request.order_id);
      return reply(
        order && order.openid === request.openid
          ? { errcode: 0, order }
          : { errcode: 0 },
      );
    }
    throw new Error(`unexpected request ${url}`);
  }
  return { request, paid, calls };
}

async function setup({ env = ENV, clock = { now: NOW } } = {}) {
  const households = memoryHouseholds();
  const orders = memoryOrders();
  const wechat = fakeWechat();
  const xpay = createXpay(env, wechat.request);
  const route = createRouter({
    households,
    orders,
    xpay,
    now: () => clock.now,
  });
  await route({ action: 'household.create', payload: { name: '小橘' } }, 'oA');
  return { households, orders, route, xpay, clock, wechat };
}

/** 微信推到云函数的发货推送：平铺字段，不带签名。 */
function deliverEvent(order, override = {}) {
  return {
    ToUserName: 'gh_xxx',
    FromUserName: order.openid,
    CreateTime: 1761364800,
    MsgType: 'event',
    Event: 'xpay_goods_deliver_notify',
    OpenId: order.openid,
    OutTradeNo: order.outTradeNo,
    Env: order.env,
    WeChatPayInfo: { MchOrderNo: 'M1', TransactionId: 'T1', PaidTime: 1 },
    GoodsInfo: {
      ProductId: order.productId,
      Quantity: 1,
      OrigPrice: order.price,
      ActualPrice: order.price,
      Attach: order.householdId,
    },
    ...override,
  };
}

/** 微信推到云函数的退款推送。 */
function refundEvent(order, override = {}) {
  return {
    ToUserName: 'gh_xxx',
    FromUserName: order.openid,
    CreateTime: 1761364800,
    MsgType: 'event',
    Event: 'xpay_refund_notify',
    OpenId: order.openid,
    WxRefundId: 'WR1',
    MchRefundId: 'MR1',
    WxOrderId: 'WO1',
    MchOrderId: order.outTradeNo,
    RefundFee: order.price,
    RetCode: 0,
    RetMsg: '',
    ...override,
  };
}

/** 在假微信那边把这笔订单标成已支付。 */
function pay(ctx, order, fields = {}) {
  ctx.wechat.paid.set(order.outTradeNo, {
    order_id: order.outTradeNo,
    openid: order.openid,
    status: 2,
    order_fee: order.price,
    paid_fee: order.price,
    env_type: order.env === 1 ? 2 : 1,
    ...fields,
  });
}

async function buy(ctx, plan = 'vip_month') {
  const result = await ctx.route(
    { action: 'vip.order', payload: { plan, code: 'code-oA' } },
    'oA',
  );
  assert.equal(result.ok, true);
  const outTradeNo = JSON.parse(result.data.signData).outTradeNo;
  return { result: result.data, order: ctx.orders.docs.get(outTradeNo) };
}

test('虚拟支付配置不全时视为未开通', () => {
  assert.equal(createXpay({}), null);
  assert.equal(createXpay({ ...ENV, XPAY_OFFER_ID: '' }), null);
  // 沙箱模式需要沙箱 AppKey
  assert.equal(
    createXpay({ ...ENV, XPAY_ENV: '1', XPAY_SANDBOX_APP_KEY: '' }),
    null,
  );
});

test('vip.get：套餐来自契约，未开通时 active 为 false', async () => {
  const { route } = await setup();
  const result = await route({ action: 'vip.get' }, 'oA');
  assert.equal(result.ok, true);
  assert.equal(result.data.active, false);
  assert.equal(result.data.available, true);
  assert.deepEqual(result.data.plans, VIP.plans);
  // 会员页照着列每项 AI 功能的次数；1.6.0 读的两个字段留着
  assert.deepEqual(
    result.data.quotas.map((row) => [row.id, row.free, row.vip]),
    Object.entries(QUOTAS).map(([id, row]) => [id, row.free, row.vip]),
  );
  assert.equal(result.data.dailyImages, QUOTAS.billImage.vip);
  assert.equal(result.data.dailySummaries, QUOTAS.summary.vip);
});

test('vip.order：价格和商品以云端为准，双签名按文档计算', async () => {
  const ctx = await setup();
  const { result, order } = await buy(ctx);
  const plan = VIP.plans[0];
  const signData = JSON.parse(result.signData);
  assert.equal(result.mode, 'short_series_goods');
  assert.equal(signData.offerId, ENV.XPAY_OFFER_ID);
  assert.equal(signData.env, 0);
  assert.equal(signData.currencyType, 'CNY');
  assert.equal(signData.productId, plan.id);
  assert.equal(signData.goodsPrice, plan.price);
  assert.equal(signData.buyQuantity, 1);
  assert.match(signData.outTradeNo, /^[A-Za-z0-9]{8,32}$/);
  assert.equal(
    result.paySig,
    hmac(ENV.XPAY_APP_KEY, `requestVirtualPayment&${result.signData}`),
  );
  assert.equal(result.signature, hmac('user-session-key', result.signData));
  assert.equal(order.status, 'pending');
  assert.equal(order.openid, 'oA');
  assert.equal(order.price, plan.price);
});

test('vip.order：沙箱模式用沙箱 AppKey 且 env 为 1', async () => {
  const ctx = await setup({ env: { ...ENV, XPAY_ENV: '1' } });
  const { result } = await buy(ctx);
  assert.equal(JSON.parse(result.signData).env, 1);
  assert.equal(
    result.paySig,
    hmac(ENV.XPAY_SANDBOX_APP_KEY, `requestVirtualPayment&${result.signData}`),
  );
});

test('vip.order：套餐不存在、没有 code、code 不是本人的都被拒绝', async () => {
  const { route } = await setup();
  const order = (payload, openid = 'oA') =>
    route({ action: 'vip.order', payload }, openid);
  assert.equal(
    (await order({ plan: 'vip_forever', code: 'code-oA' })).code,
    'VALIDATION',
  );
  assert.equal((await order({ plan: 'vip_month' })).code, 'VALIDATION');
  // 别人的 code 换出来的 openid 对不上
  assert.equal(
    (await order({ plan: 'vip_month', code: 'code-oB' })).code,
    'UNAUTHENTICATED',
  );
});

test('vip.order：没配置虚拟支付时提示未开通', async () => {
  const { route } = await setup({ env: {} });
  const result = await route(
    { action: 'vip.order', payload: { plan: 'vip_month', code: 'code-oA' } },
    'oA',
  );
  assert.equal(result.code, 'UNAVAILABLE');
  assert.equal(
    (await route({ action: 'vip.get' }, 'oA')).data.available,
    false,
  );
});

test('发货推送：向微信查单确认已支付后开通会员，household.get 能看到', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  pay(ctx, order);
  const reply = await ctx.route.deliver(deliverEvent(order));
  assert.deepEqual(reply, { ErrCode: 0, ErrMsg: 'Success' });
  const household = (await ctx.route({ action: 'household.get' }, 'oA')).data;
  assert.deepEqual(household.vip, {
    active: true,
    until: NOW + VIP.plans[0].days * DAY,
    free: 0,
    member: true,
  });
  assert.equal(ctx.orders.docs.get(order.outTradeNo).status, 'delivered');
});

test('发货推送：重复推送不会重复加天数，也不再查单', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  pay(ctx, order);
  await ctx.route.deliver(deliverEvent(order));
  const first = (await ctx.route({ action: 'vip.get' }, 'oA')).data.until;
  const again = await ctx.route.deliver(deliverEvent(order));
  assert.equal(again.ErrCode, 0);
  assert.equal(ctx.wechat.calls.query, 1);
  assert.equal(ctx.wechat.calls.token, 1);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    first,
  );
});

test('发货推送：订单已标记发货但小家没加上时，重推会补上且只加一次', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  pay(ctx, order);
  // 模拟第一次加天数成功、标记发货失败：微信会重推
  const markDelivered = ctx.orders.markDelivered;
  ctx.orders.markDelivered = async () => {
    throw new Error('db down');
  };
  assert.equal((await ctx.route.deliver(deliverEvent(order))).ErrCode, 1);
  ctx.orders.markDelivered = markDelivered;
  assert.equal((await ctx.route.deliver(deliverEvent(order))).ErrCode, 0);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + VIP.plans[0].days * DAY,
  );
});

test('发货推送：续费从原到期日往后加；过期后从现在算', async () => {
  const ctx = await setup();
  const month = VIP.plans[0].days * DAY;
  const paidOrder = async () => {
    const { order } = await buy(ctx);
    pay(ctx, order);
    return order;
  };
  await ctx.route.deliver(deliverEvent(await paidOrder()));
  await ctx.route.deliver(deliverEvent(await paidOrder()));
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + 2 * month,
  );
  ctx.clock.now = NOW + 3 * month; // 已经过期
  await ctx.route.deliver(deliverEvent(await paidOrder()));
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + 4 * month,
  );
});

test('发货推送：伪造的推送（没付款）不开通', async () => {
  const ctx = await setup();
  // 先下单不付款，再自己调 api 发一条字段全对的推送
  const { order } = await buy(ctx);
  assert.notEqual((await ctx.route.deliver(deliverEvent(order))).ErrCode, 0);
  // 微信那边订单只是创建成功、已关闭、已退款，都不算付过钱
  for (const status of [1, 5, 6, 8]) {
    pay(ctx, order, { status });
    assert.notEqual((await ctx.route.deliver(deliverEvent(order))).ErrCode, 0);
  }
  // 金额对不上
  pay(ctx, order, { order_fee: 1 });
  assert.notEqual((await ctx.route.deliver(deliverEvent(order))).ErrCode, 0);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.active,
    false,
  );
  assert.equal(ctx.orders.docs.get(order.outTradeNo).status, 'pending');
});

test('发货推送：事件不对、字段缺失、订单对不上都不开通', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  pay(ctx, order);
  const rejected = [
    { ...deliverEvent(order), Event: 'other_event' },
    deliverEvent(order, { OpenId: 'oB' }),
    deliverEvent(order, { OutTradeNo: 'V-not-ours-0001' }),
    deliverEvent(order, { GoodsInfo: { ProductId: 'vip_year' } }),
    deliverEvent(order, { GoodsInfo: undefined }),
    { Event: 'xpay_goods_deliver_notify' },
  ];
  for (const event of rejected)
    assert.notEqual((await ctx.route.deliver(event)).ErrCode, 0);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.active,
    false,
  );
});

test('发货推送：沙箱订单用沙箱 AppKey 查单', async () => {
  const ctx = await setup({ env: { ...ENV, XPAY_ENV: '1' } });
  const { order } = await buy(ctx);
  assert.equal(order.env, 1);
  pay(ctx, order);
  assert.equal((await ctx.route.deliver(deliverEvent(order))).ErrCode, 0);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.active,
    true,
  );
});

test('发货推送：查单失败时让微信重试', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  pay(ctx, order);
  const broken = createXpay(ENV, async () => {
    throw new Error('network');
  });
  const route = createRouter({
    households: ctx.households,
    orders: ctx.orders,
    xpay: broken,
    now: () => NOW,
  });
  assert.equal((await route.deliver(deliverEvent(order))).ErrCode, 1);
  assert.equal(ctx.orders.docs.get(order.outTradeNo).status, 'pending');
});

test('发货推送：没配置虚拟支付时一律拒绝', async () => {
  const ctx = await setup({ env: {} });
  const reply = await ctx.route.deliver(
    deliverEvent({
      openid: 'oA',
      outTradeNo: 'V12345678',
      env: 0,
      productId: 'vip_month',
      price: 900,
    }),
  );
  assert.notEqual(reply.ErrCode, 0);
});

test('会员的每日次数更多，过期后恢复', () => {
  const household = { vip: { until: NOW + DAY } };
  assert.equal(isVip(household, NOW), true);
  assert.equal(limitOf(household, 'billImage', NOW), QUOTAS.billImage.vip);
  assert.equal(limitOf(household, 'summary', NOW), QUOTAS.summary.vip);
  assert.equal(isVip(household, NOW + 2 * DAY), false);
  assert.equal(
    limitOf(household, 'billImage', NOW + 2 * DAY),
    QUOTAS.billImage.free,
  );
  assert.equal(limitOf({}, 'summary', NOW), QUOTAS.summary.free);
});

test('次数用完时只给非会员附开通提示', () => {
  const free = limitMessage({}, 'billImage', NOW);
  assert.equal(
    free,
    `今天已经识别了 ${QUOTAS.billImage.free} 张截图，明天再来吧。开通会员每天可以识别 ${QUOTAS.billImage.vip} 张。`,
  );
  assert.equal(
    limitMessage({ vip: { until: NOW + DAY } }, 'summary', NOW),
    `今天已经生成了 ${QUOTAS.summary.vip} 次小结，明天再来吧。`,
  );
  assert.match(
    limitMessage({ vip: { until: NOW - DAY } }, 'summary', NOW),
    /开通会员每天可以生成/,
  );
});

test('vip.confirm：付款后主动查单开通，不用等推送', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  const confirm = (outTradeNo, openid = 'oA') =>
    ctx.route({ action: 'vip.confirm', payload: { outTradeNo } }, openid);
  // 还没付款：不开通
  let result = await confirm(order.outTradeNo);
  assert.equal(result.ok, true);
  assert.equal(result.data.delivered, false);
  assert.equal(result.data.active, false);
  // 付款后：开通，重复查不会重复加天数
  pay(ctx, order);
  result = await confirm(order.outTradeNo);
  assert.equal(result.data.delivered, true);
  assert.equal(result.data.until, NOW + VIP.plans[0].days * DAY);
  await confirm(order.outTradeNo);
  assert.equal(ctx.wechat.calls.query, 2);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + VIP.plans[0].days * DAY,
  );
  // 之后再来推送也不会多加
  assert.equal((await ctx.route.deliver(deliverEvent(order))).ErrCode, 0);
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + VIP.plans[0].days * DAY,
  );
});

test('vip.confirm：别的小家的订单、不存在的订单都查不了', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  pay(ctx, order);
  await ctx.route(
    { action: 'household.create', payload: { name: '小黑' } },
    'oC',
  );
  const other = await ctx.route(
    { action: 'vip.confirm', payload: { outTradeNo: order.outTradeNo } },
    'oC',
  );
  assert.equal(other.code, 'NOT_FOUND');
  const missing = await ctx.route(
    { action: 'vip.confirm', payload: { outTradeNo: 'V-nope-0001' } },
    'oA',
  );
  assert.equal(missing.code, 'NOT_FOUND');
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.active,
    false,
  );
});

/** 买一单、到账，再在假微信那边退掉 refunded 分。 */
async function boughtAndRefunded(ctx, plan, refunded) {
  const { order } = await buy(ctx, plan);
  pay(ctx, order);
  await ctx.route.deliver(deliverEvent(order));
  pay(ctx, order, {
    status: refunded === order.price ? 5 : 4,
    left_fee: order.price - refunded,
  });
  return order;
}

const vipOf = async (ctx) =>
  (await ctx.route({ action: 'vip.get' }, 'oA')).data;

test('退款推送：全额退款收回这一单的天数，重复推送只扣一次', async () => {
  const ctx = await setup();
  const order = await boughtAndRefunded(ctx, 'vip_year', 6800);
  const reply = await ctx.route.refund(refundEvent(order));
  assert.deepEqual(reply, { ErrCode: 0, ErrMsg: 'Success' });
  const after = await vipOf(ctx);
  assert.equal(after.active, false);
  assert.equal(after.until, NOW);
  assert.equal(ctx.orders.docs.get(order.outTradeNo).refunded, 6800);
  assert.equal((await ctx.route.refund(refundEvent(order))).ErrCode, 0);
  assert.equal((await vipOf(ctx)).until, NOW);
});

test('退款推送：只扣被退那一单，另一单的天数还在', async () => {
  const ctx = await setup();
  const { order: kept } = await buy(ctx, 'vip_month');
  pay(ctx, kept);
  await ctx.route.deliver(deliverEvent(kept));
  const order = await boughtAndRefunded(ctx, 'vip_year', 6800);
  await ctx.route.refund(refundEvent(order));
  const month = VIP.plans.find((plan) => plan.id === 'vip_month').days;
  const after = await vipOf(ctx);
  assert.equal(after.active, true);
  assert.equal(after.until, NOW + month * DAY);
});

test('退款推送：部分退款按比例扣，再退剩下的只扣差额', async () => {
  const ctx = await setup();
  const order = await boughtAndRefunded(ctx, 'vip_year', 3400);
  await ctx.route.refund(refundEvent(order));
  const year = VIP.plans.find((plan) => plan.id === 'vip_year').days;
  assert.equal((await vipOf(ctx)).until, NOW + (year * DAY) / 2);
  pay(ctx, order, { status: 5, left_fee: 0 });
  await ctx.route.refund(refundEvent(order));
  assert.equal((await vipOf(ctx)).until, NOW);
});

test('退款推送：不可信，以查单为准；退款失败、伪造的推送不扣天数', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx, 'vip_year');
  pay(ctx, order);
  await ctx.route.deliver(deliverEvent(order));
  const before = (await vipOf(ctx)).until;
  // 微信那边并没有退款
  assert.equal((await ctx.route.refund(refundEvent(order))).ErrCode, 0);
  for (const event of [
    refundEvent(order, { RetCode: 1 }),
    refundEvent(order, { OpenId: 'oB' }),
    refundEvent(order, { MchOrderId: 'V-not-ours-0001' }),
    refundEvent(order, { MchOrderId: undefined }),
    { ...refundEvent(order), Event: 'other_event' },
  ])
    await ctx.route.refund(event);
  assert.equal((await vipOf(ctx)).until, before);
});

test('退款推送：没开通过的订单退款只记账，之后也不会再开通', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx, 'vip_month');
  pay(ctx, order, { status: 5, left_fee: 0 });
  assert.equal((await ctx.route.refund(refundEvent(order))).ErrCode, 0);
  assert.equal(ctx.orders.docs.get(order.outTradeNo).refunded, 900);
  await ctx.route.deliver(deliverEvent(order));
  assert.equal((await vipOf(ctx)).active, false);
});

test('限时免费：到日期那天的最后一刻所有小家都算会员，环境变量能改日期或关掉', () => {
  const { freeUntilOf, isVip } = require('../cloudfunctions/api/vip');
  const saved = process.env.VIP_FREE_UNTIL;
  try {
    delete process.env.VIP_FREE_UNTIL;
    const end = Date.parse('2026-11-30T23:59:59.999+08:00');
    assert.equal(freeUntilOf(), end);
    assert.equal(isVip({}, end - 1), true);
    assert.equal(isVip({}, end + 1), false);
    // 真开通的会员不受限免影响
    assert.equal(isVip({ vip: { until: end + 1000 } }, end + 1), true);
    process.env.VIP_FREE_UNTIL = '2027-01-15';
    assert.equal(isVip({}, end + 1), true);
    process.env.VIP_FREE_UNTIL = 'off';
    assert.equal(freeUntilOf(), 0);
    assert.equal(isVip({}, end - 1), false);
  } finally {
    if (saved === undefined) delete process.env.VIP_FREE_UNTIL;
    else process.env.VIP_FREE_UNTIL = saved;
  }
});
