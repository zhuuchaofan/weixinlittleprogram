const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createRouter } = require('../cloudfunctions/api/router');
const { createXpay } = require('../cloudfunctions/api/xpay');
const { isVip, dailyLimits } = require('../cloudfunctions/api/vip');
const { vip: VIP } = require('../cloudfunctions/api/contract.json');

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
  };
}

/** wx.login 的 code 换 session_key：code 形如 `code-<openid>`。 */
function fakeGet(sessionKey = 'user-session-key') {
  return async (url) => {
    const code = new URL(url).searchParams.get('js_code');
    return {
      status: 200,
      text: JSON.stringify({
        session_key: sessionKey,
        openid: code.replace('code-', ''),
      }),
    };
  };
}

async function setup({ env = ENV, clock = { now: NOW } } = {}) {
  const households = memoryHouseholds();
  const orders = memoryOrders();
  const xpay = createXpay(env, fakeGet());
  const route = createRouter({
    households,
    orders,
    xpay,
    now: () => clock.now,
  });
  await route({ action: 'household.create', payload: { name: '小橘' } }, 'oA');
  return { households, orders, route, xpay, clock };
}

/** 微信的发货推送：Payload 是 JSON 字符串，PayEventSig 用 AppKey 签「Event&Payload」。 */
function deliverEvent(order, { key = ENV.XPAY_APP_KEY, ...override } = {}) {
  const payload = JSON.stringify({
    OpenId: order.openid,
    OutTradeNo: order.outTradeNo,
    Env: order.env,
    GoodsInfo: {
      ProductId: order.productId,
      Quantity: 1,
      OrigPrice: order.price,
      ActualPrice: order.price,
    },
    ...override,
  });
  return {
    Event: 'xpay_goods_deliver_notify',
    Payload: payload,
    PayEventSig: hmac(key, `xpay_goods_deliver_notify&${payload}`),
  };
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
  assert.equal((await route({ action: 'vip.get' }, 'oA')).data.available, false);
});

test('发货推送：验签通过后开通会员，household.get 能看到', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  const reply = await ctx.route.deliver(deliverEvent(order));
  assert.deepEqual(reply, { ErrCode: 0, ErrMsg: 'Success' });
  const household = (await ctx.route({ action: 'household.get' }, 'oA')).data;
  assert.deepEqual(household.vip, {
    active: true,
    until: NOW + VIP.plans[0].days * DAY,
  });
  assert.equal(ctx.orders.docs.get(order.outTradeNo).status, 'delivered');
});

test('发货推送：重复推送不会重复加天数', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  await ctx.route.deliver(deliverEvent(order));
  const first = (await ctx.route({ action: 'vip.get' }, 'oA')).data.until;
  const again = await ctx.route.deliver(deliverEvent(order));
  assert.equal(again.ErrCode, 0);
  assert.equal((await ctx.route({ action: 'vip.get' }, 'oA')).data.until, first);
});

test('发货推送：续费从原到期日往后加；过期后从现在算', async () => {
  const ctx = await setup();
  const month = VIP.plans[0].days * DAY;
  await ctx.route.deliver(deliverEvent((await buy(ctx)).order));
  await ctx.route.deliver(deliverEvent((await buy(ctx)).order));
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + 2 * month,
  );
  ctx.clock.now = NOW + 3 * month; // 已经过期
  await ctx.route.deliver(deliverEvent((await buy(ctx)).order));
  assert.equal(
    (await ctx.route({ action: 'vip.get' }, 'oA')).data.until,
    NOW + 4 * month,
  );
});

test('发货推送：签名不对、事件不对、订单对不上都不开通', async () => {
  const ctx = await setup();
  const { order } = await buy(ctx);
  const rejected = [
    deliverEvent(order, { key: 'wrong-key' }),
    { ...deliverEvent(order), PayEventSig: undefined },
    { ...deliverEvent(order), Event: 'other_event' },
    // 签名用现网 key，但声明成沙箱：用沙箱 key 验不过
    deliverEvent(order, { Env: 1 }),
    deliverEvent(order, { OpenId: 'oB' }),
    deliverEvent(order, { OutTradeNo: 'V-not-ours-0001' }),
    deliverEvent(order, {
      GoodsInfo: { ProductId: order.productId, ActualPrice: 1 },
    }),
    deliverEvent(order, {
      GoodsInfo: { ProductId: 'vip_year', ActualPrice: order.price },
    }),
    { Event: 'xpay_goods_deliver_notify', Payload: 'not json', PayEventSig: 'x' },
  ];
  for (const event of rejected)
    assert.notEqual((await ctx.route.deliver(event)).ErrCode, 0);
  assert.equal((await ctx.route({ action: 'vip.get' }, 'oA')).data.active, false);
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
  const base = { images: 20, summaries: 5 };
  const household = { vip: { until: NOW + DAY } };
  assert.equal(isVip(household, NOW), true);
  assert.deepEqual(dailyLimits(household, NOW, base), {
    images: VIP.dailyImages,
    summaries: VIP.dailySummaries,
  });
  assert.equal(isVip(household, NOW + 2 * DAY), false);
  assert.deepEqual(dailyLimits(household, NOW + 2 * DAY, base), base);
  assert.deepEqual(dailyLimits({}, NOW, base), base);
});
