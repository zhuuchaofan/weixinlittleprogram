const { ApiError } = require('./errors');

// 千问 AI 平台（原阿里云百炼）的 OpenAI 兼容接口（北京地域）；模型和地址可以用环境变量换。
const DEFAULT_BASE_URL =
  'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3.8-omni-flash';
// 要比云函数超时（60 秒）短，留出查重和返回的时间。
const TIMEOUT_MS = 50 * 1000;

/**
 * 流式回复（SSE）拼回完整文本：每行 `data: {...}`，以 `data: [DONE]` 结束。
 * 最后一块带 usage（请求里开了 include_usage），用来记用量；没有时 token 数记 0。
 */
function joinStream(body) {
  let text = '';
  const usage = { input: 0, output: 0 };
  for (const line of body.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    try {
      const chunk = JSON.parse(data);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
      if (chunk.usage) {
        usage.input = Number(chunk.usage.prompt_tokens) || 0;
        usage.output = Number(chunk.usage.completion_tokens) || 0;
      }
    } catch {
      // 跳过不完整的行
    }
  }
  return { text, usage };
}

/** 接口返回的错误说明（error.code / error.message），只取前 80 字，不含账单内容。 */
function errorDetail(text) {
  try {
    const error = JSON.parse(text).error || {};
    return [error.code, error.message].filter(Boolean).join(' ').slice(0, 80);
  } catch {
    return '';
  }
}

/** HTTP 状态 → 给人看的原因，方便排查是 Key、模型还是额度的问题。 */
function failureFor(status, text) {
  const detail = errorDetail(text);
  const message =
    status === 401 || status === 403
      ? 'API Key 无效或没有开通这个模型，请检查云函数 api 的 DASHSCOPE_API_KEY'
      : status === 404
        ? '模型名或接口地址不对，请检查 BILL_MODEL / BILL_BASE_URL'
        : status === 429
          ? '调用太频繁或额度用完了'
          : `识别服务出错（HTTP ${status}）`;
  return new ApiError(
    'UNAVAILABLE',
    detail ? `${message}：${detail}` : `${message}。`,
  );
}

/** 用 node:https 发 POST，读完整个回复；不依赖 fetch（云函数的 Node 版本可能没有）。 */
function httpsPost(url, { headers, body, timeout }) {
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { method: 'POST', headers, timeout },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

/**
 * 千问模型的底层调用：chat(content, { model, temperature, maxTokens }) → { text, usage }。
 * 用哪个模型、记用量、费用上限都在 ai.js；这里只管发请求和把错误翻译成人话。
 * Omni 系列只支持流式输出，所以一律用 stream 调用，读完整个回复再拼接。
 * 没有配置 DASHSCOPE_API_KEY 时返回 null，AI 功能提示未开通。密钥只从环境变量读取。
 * post 可替换（测试用）：post(url, { headers, body, timeout }) → { status, text }。
 */
function createVision(env = process.env, post = httpsPost) {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (env.BILL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  async function chat(content, options) {
    let response;
    try {
      response = await post(`${baseUrl}/chat/completions`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          temperature: options.temperature || 0,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          // 不要思考过程：只拼正文，思考只会让人多等。
          enable_thinking: false,
          stream: true,
          stream_options: { include_usage: true },
          modalities: ['text'],
          messages: [{ role: 'user', content }],
        }),
        timeout: TIMEOUT_MS,
      });
    } catch {
      throw new ApiError('UNAVAILABLE', '识别服务暂时连不上，稍后再试一次吧。');
    }
    // 不记录回复内容：里面是账单明细。
    if (response.status !== 200)
      throw failureFor(response.status, response.text);
    const reply = joinStream(response.text);
    if (!reply.text) throw failureFor(response.status, response.text);
    return reply;
  }
  return { chat };
}

module.exports = { createVision, DEFAULT_MODEL };
