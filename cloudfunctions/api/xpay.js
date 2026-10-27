const { createHmac } = require('node:crypto');
const { ApiError } = require('./errors');

// 微信小程序虚拟支付（道具直购 short_series_goods）。
// 下单参数由云端生成双签名，小程序用 wx.requestVirtualPayment 拉起收银台；
// 到账只以微信的发货推送 xpay_goods_deliver_notify 为准，不信任客户端回调。
// 推到云函数的推送不带签名，小程序也能伪造同样的 event 调 api，
// 所以发货前一律用 query_order 向微信查单，确认这笔真的付了钱。
const PAY_URI = 'requestVirtualPayment';
const QUERY_URI = '/xpay/query_order';
const DELIVER_EVENT = 'xpay_goods_deliver_notify';
const API = 'https://api.weixin.qq.com';
const TIMEOUT_MS = 8 * 1000;
// access_token 提前这么久换新的。
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

function hmacHex(key, text) {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

/**
 * 用 node:https 发请求，读完整个回复；不依赖 fetch（云函数的 Node 版本可能没有）。
 * 没有 body 时发 GET，有 body 时把这段字符串原样 POST 出去（签名要和发出的字节一致）。
 */
function httpsRequest(url, body) {
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    const options =
      body === undefined
        ? { method: 'GET', timeout: TIMEOUT_MS }
        : {
            method: 'POST',
            timeout: TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          };
    const request = https.request(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

/**
 * 虚拟支付：配置全部来自环境变量（密钥不进 git）。
 * XPAY_OFFER_ID（OfferID）、XPAY_APP_KEY（现网 AppKey）、XPAY_SANDBOX_APP_KEY（沙箱 AppKey）、
 * WX_APPID、WX_APPSECRET（换用户的 session_key 和查单用的 access_token）；
 * XPAY_ENV=1 时走沙箱，默认现网。缺任何一项返回 null，会员购买提示未开通。
 * request 可替换（测试用）：request(url, body?) → { status, text }。
 */
function createXpay(env = process.env, request = httpsRequest) {
  const offerId = env.XPAY_OFFER_ID;
  const appId = env.WX_APPID;
  const appSecret = env.WX_APPSECRET;
  const sandbox = env.XPAY_ENV === '1';
  const keys = { 0: env.XPAY_APP_KEY, 1: env.XPAY_SANDBOX_APP_KEY };
  const currentEnv = sandbox ? 1 : 0;
  if (!offerId || !appId || !appSecret || !keys[currentEnv]) return null;

  async function callJson(url, body) {
    let reply;
    try {
      reply = JSON.parse((await request(url, body)).text);
    } catch {
      throw new ApiError('UNAVAILABLE', '连不上微信服务，请稍后重试。');
    }
    return reply;
  }

  // 稳定版 access_token：重复获取不会让旧的失效，云函数多个实例各自缓存也没问题。
  let token = null;
  async function accessToken() {
    if (token && token.expiresAt > Date.now()) return token.value;
    const reply = await callJson(
      `${API}/cgi-bin/stable_token`,
      JSON.stringify({
        grant_type: 'client_credential',
        appid: appId,
        secret: appSecret,
      }),
    );
    if (!reply.access_token)
      throw new ApiError(
        'UNAVAILABLE',
        `换 access_token 失败：${reply.errcode}`,
      );
    token = {
      value: reply.access_token,
      expiresAt:
        Date.now() + Number(reply.expires_in || 0) * 1000 - TOKEN_MARGIN_MS,
    };
    return token.value;
  }

  return {
    env: currentEnv,
    offerId,
    /** 用 wx.login 的 code 换 session_key，并确认这个 code 就是当前调用者的。 */
    async sessionKey(code, openid) {
      const query = new URLSearchParams({
        appid: appId,
        secret: appSecret,
        js_code: code,
        grant_type: 'authorization_code',
      });
      const reply = await callJson(`${API}/sns/jscode2session?${query}`);
      if (!reply.session_key || reply.openid !== openid)
        throw new ApiError('UNAUTHENTICATED', '登录状态过期，请重试。');
      return reply.session_key;
    },
    /** 双签名：paySig 用 AppKey 签「uri&signData」，signature 用 session_key 签 signData。 */
    sign(signData, sessionKey) {
      return {
        paySig: hmacHex(keys[currentEnv], `${PAY_URI}&${signData}`),
        signature: hmacHex(sessionKey, signData),
      };
    },
    /**
     * 向微信查一笔订单（按下单时的 outTradeNo）。pay_sig 用下单时那个环境的 AppKey
     * 签「/xpay/query_order&请求体」。返回微信的 order 对象，查不到为 null。
     */
    async queryOrder({ openid, env: orderEnv, outTradeNo }) {
      const key = keys[orderEnv];
      if (!key) throw new ApiError('UNAVAILABLE', '缺少这个环境的 AppKey。');
      const body = JSON.stringify({
        openid,
        env: orderEnv,
        order_id: outTradeNo,
      });
      const query = new URLSearchParams({
        access_token: await accessToken(),
        pay_sig: hmacHex(key, `${QUERY_URI}&${body}`),
      });
      const reply = await callJson(`${API}${QUERY_URI}?${query}`, body);
      if (reply.errcode)
        throw new ApiError('UNAVAILABLE', `查单失败：${reply.errcode}`);
      return reply.order || null;
    },
  };
}

/** 从发货推送里取出需要的字段（推到云函数的是平铺字段）；格式不对返回 null。 */
function parseDeliver(event) {
  if (
    typeof event?.OutTradeNo !== 'string' ||
    typeof event?.OpenId !== 'string' ||
    typeof event?.GoodsInfo?.ProductId !== 'string'
  )
    return null;
  return {
    outTradeNo: event.OutTradeNo,
    openid: event.OpenId,
    productId: event.GoodsInfo.ProductId,
  };
}

module.exports = {
  createXpay,
  parseDeliver,
  DELIVER_EVENT,
  PAY_URI,
  QUERY_URI,
};
