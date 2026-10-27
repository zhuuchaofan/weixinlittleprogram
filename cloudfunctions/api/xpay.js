const { createHmac, timingSafeEqual } = require('node:crypto');
const { ApiError } = require('./errors');

// 微信小程序虚拟支付（道具直购 short_series_goods）。
// 下单参数由云端生成双签名，小程序用 wx.requestVirtualPayment 拉起收银台；
// 到账只以微信的发货推送 xpay_goods_deliver_notify 为准，不信任客户端回调。
const PAY_URI = 'requestVirtualPayment';
const DELIVER_EVENT = 'xpay_goods_deliver_notify';
const TIMEOUT_MS = 8 * 1000;

function hmacHex(key, text) {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 用 node:https 发 GET，读完整个回复；不依赖 fetch（云函数的 Node 版本可能没有）。 */
function httpsGet(url) {
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: TIMEOUT_MS }, (response) => {
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
  });
}

/**
 * 虚拟支付：配置全部来自环境变量（密钥不进 git）。
 * XPAY_OFFER_ID（OfferID）、XPAY_APP_KEY（现网 AppKey）、XPAY_SANDBOX_APP_KEY（沙箱 AppKey）、
 * WX_APPID、WX_APPSECRET（换用户的 session_key）；XPAY_ENV=1 时走沙箱，默认现网。
 * 缺任何一项返回 null，会员购买提示未开通。
 * get 可替换（测试用）：get(url) → { status, text }。
 */
function createXpay(env = process.env, get = httpsGet) {
  const offerId = env.XPAY_OFFER_ID;
  const appId = env.WX_APPID;
  const appSecret = env.WX_APPSECRET;
  const sandbox = env.XPAY_ENV === '1';
  const keys = { 0: env.XPAY_APP_KEY, 1: env.XPAY_SANDBOX_APP_KEY };
  const currentEnv = sandbox ? 1 : 0;
  if (!offerId || !appId || !appSecret || !keys[currentEnv]) return null;

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
      let reply;
      try {
        const response = await get(
          `https://api.weixin.qq.com/sns/jscode2session?${query}`,
        );
        reply = JSON.parse(response.text);
      } catch {
        throw new ApiError('UNAVAILABLE', '连不上微信服务，请稍后重试。');
      }
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
     * 验发货推送：PayEventSig = HMAC-SHA256(该环境的 AppKey, `${Event}&${Payload}`)，
     * Payload 是推送里没有解析过的原始字符串。按 Payload 里的 Env 选现网 / 沙箱的 AppKey。
     */
    verifyDeliver(event) {
      const parsed = parseDeliver(event);
      if (!parsed) return false;
      const key = keys[parsed.env];
      if (!key) return false;
      return sameHex(
        hmacHex(key, `${event.Event}&${event.Payload}`),
        event.PayEventSig,
      );
    },
  };
}

/** 从发货推送里取出需要的字段；格式不对返回 null。 */
function parseDeliver(event) {
  let body;
  try {
    body = JSON.parse(event?.Payload);
  } catch {
    return null;
  }
  const goods = body?.GoodsInfo;
  if (
    typeof body?.OutTradeNo !== 'string' ||
    typeof body?.OpenId !== 'string' ||
    typeof goods?.ProductId !== 'string' ||
    !Number.isInteger(goods?.ActualPrice)
  )
    return null;
  return {
    outTradeNo: body.OutTradeNo,
    openid: body.OpenId,
    productId: goods.ProductId,
    quantity: Number.isInteger(goods.Quantity) ? goods.Quantity : 1,
    paid: goods.ActualPrice,
    env: body.Env === 1 ? 1 : 0,
  };
}

module.exports = { createXpay, parseDeliver, DELIVER_EVENT, PAY_URI };
