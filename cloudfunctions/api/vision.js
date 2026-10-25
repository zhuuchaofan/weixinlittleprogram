const { ApiError } = require('./errors');

// 阿里云百炼（通义千问）的 OpenAI 兼容接口；模型和地址可以用环境变量换。
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3-vl-plus';
// 要比云函数超时（60 秒）短，留出查重和返回的时间。
const TIMEOUT_MS = 50 * 1000;

/**
 * 视觉模型：read(imageUrl, prompt) 返回模型回复的文本。
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
      const data = await response.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw unavailable();
      return content;
    },
  };
}

module.exports = { createVision, DEFAULT_MODEL };
