const { ApiError } = require('./errors');

// 千问 AI 平台（原阿里云百炼）的 OpenAI 兼容接口（北京地域）；模型和地址可以用环境变量换。
const DEFAULT_BASE_URL =
  'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3.8-omni-flash';
// 要比云函数超时（60 秒）短，留出查重和返回的时间。
const TIMEOUT_MS = 50 * 1000;

/** 流式回复（SSE）拼回完整文本：每行 `data: {...}`，以 `data: [DONE]` 结束。 */
function joinStream(body) {
  let text = '';
  for (const line of body.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
    } catch {
      // 跳过不完整的行
    }
  }
  return text;
}

/**
 * 视觉模型：read(imageUrl, prompt) 返回模型回复的文本。
 * Omni 系列只支持流式输出，所以一律用 stream 调用，读完整个回复再拼接。
 * 没有配置 DASHSCOPE_API_KEY 时返回 null，截图记账提示未开通。密钥只从环境变量读取。
 */
function createVision(env = process.env, fetchImpl = globalThis.fetch) {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (env.BILL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = env.BILL_MODEL || DEFAULT_MODEL;
  const unavailable = () =>
    new ApiError('UNAVAILABLE', '识别服务暂时不可用，请稍后重试。');
  return {
    async read(imageUrl, prompt) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            stream: true,
            modalities: ['text'],
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: imageUrl } },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw unavailable();
      }
      // 不记录回复内容：里面是账单明细。
      if (!response.ok) throw unavailable();
      let content;
      try {
        content = joinStream(await response.text());
      } catch {
        throw unavailable();
      }
      if (!content) throw unavailable();
      return content;
    },
  };
}

module.exports = { createVision, DEFAULT_MODEL };
