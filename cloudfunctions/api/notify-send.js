const { httpsRequest } = require('./xpay');

// 发订阅消息（服务通知）：POST /cgi-bin/message/subscribe/send。
// 用和会员一样的 WX_APPID、WX_APPSECRET 换稳定版 access_token；缺任何一项返回 null（不发）。
// 可选环境变量 WEEKLY_STATE：点消息打开哪个版本，developer / trial / formal，默认 formal（正式版）。
const API = 'https://api.weixin.qq.com';
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const STATES = new Set(['developer', 'trial', 'formal']);

function createSender(env = process.env, request = httpsRequest) {
  const appId = env.WX_APPID;
  const appSecret = env.WX_APPSECRET;
  if (!appId || !appSecret) return null;
  const state = STATES.has(env.WEEKLY_STATE) ? env.WEEKLY_STATE : 'formal';

  async function callJson(url, body) {
    return JSON.parse((await request(url, body)).text);
  }

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
      throw new Error(`stable_token ${reply.errcode || ''}`);
    token = {
      value: reply.access_token,
      expiresAt:
        Date.now() + Number(reply.expires_in || 0) * 1000 - TOKEN_MARGIN_MS,
    };
    return token.value;
  }

  return {
    state,
    /** 发一条，返回微信的 errcode（0 是成功）。 */
    async send({ openid, templateId, page, data }) {
      const body = JSON.stringify({
        touser: openid,
        template_id: templateId,
        page,
        data,
        miniprogram_state: state,
        lang: 'zh_CN',
      });
      const post = async () =>
        callJson(
          `${API}/cgi-bin/message/subscribe/send?${new URLSearchParams({ access_token: await accessToken() })}`,
          body,
        );
      let reply = await post();
      // access_token 过期（40001 / 42001）：换一个再发一次。
      if (reply.errcode === 40001 || reply.errcode === 42001) {
        token = null;
        reply = await post();
      }
      return Number(reply.errcode) || 0;
    },
  };
}

module.exports = { createSender };
