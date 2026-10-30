/**
 * 所有 AI 功能的统一入口（docs/PLAN.md「AI 功能」）。每个功能在 FEATURES 里登记一次：
 * - tier：organize 是「AI 整理」（识别、拆分，结果要用户确认才保存），write 是「AI 写文字」（小结、祝福等，标「AI 生成」）。
 * - 用哪个模型、温度、最长输出。模型可以用环境变量换，不用改代码。
 * 每次调用记下功能名、token 数和估算费用到 ai_usage（每天一条），不记内容。
 * 全站每天的费用到 AI_DAILY_BUDGET 元的 WRITE_SHARE 时先停「写文字」，到 100% 再停「整理」。
 * 环境变量 AI_WRITE_OFF=1 时所有「写文字」功能关闭（审核要求下架时用，不用发版）。
 * 每个小家每天 / 每月的次数在 quota.js，和这里分开：先 ensure → 再占小家额度 → 再 read / write。
 */
const { ApiError } = require('./errors');
const { todayKey } = require('./dates');
const { DEFAULT_MODEL } = require('./vision');

const DEFAULT_BUDGET = 20;
const WRITE_SHARE = 0.8;

/** 清单、吃啥、纪念日这几个纯文字功能的模型：ASSIST_MODEL，没填用小结的，再没填用截图识别的。 */
const assistModel = (env) =>
  env.ASSIST_MODEL || env.SUMMARY_MODEL || env.BILL_MODEL || DEFAULT_MODEL;

/** 每个功能的模型和参数；env 是云函数的环境变量。键必须和 contract.json 的 ai 一一对应。 */
const FEATURES = {
  billImage: {
    tier: 'organize',
    model: (env) => env.BILL_MODEL || DEFAULT_MODEL,
    temperature: 0,
  },
  summary: {
    tier: 'write',
    // 小结只有文字，可以单独换一个更快的纯文本模型（例如 qwen-flash），不填就和截图识别用同一个。
    model: (env) => env.SUMMARY_MODEL || env.BILL_MODEL || DEFAULT_MODEL,
    temperature: 0.3,
    // 小结 150 字以内，中文大约 1 字 1 token；封顶防止模型写长了拖时间。
    maxTokens: 300,
  },
  // 一句话拆成清单条目：结果先让用户确认，才加进清单。
  todoSplit: {
    tier: 'organize',
    model: assistModel,
    temperature: 0,
    maxTokens: 400,
  },
  // 从自己的菜单里挑：编号过一遍校验，只能挑菜单里有的；理由是模型写的短句。
  dishPick: {
    tier: 'write',
    model: assistModel,
    temperature: 0.5,
    maxTokens: 300,
  },
  // 每月小报的寄语：只给汇总数字，生成式文字，界面标「AI 生成」。
  recapNote: {
    tier: 'write',
    model: assistModel,
    temperature: 0.6,
    maxTokens: 400,
  },
  // 纪念日祝福和点子：生成式文字，界面标「AI 生成」。
  dateWish: {
    tier: 'write',
    model: assistModel,
    temperature: 0.8,
    maxTokens: 600,
  },
};

/**
 * 估算单价（元 / 百万 token，输入 / 输出），只用来算费用上限，宁可偏高。
 * 以千问 AI 平台控制台的价格为准；没列出的模型按 OTHER_PRICE。
 */
const PRICES = {
  'qwen-flash': [1, 3],
  'qwen-plus': [3, 9],
  'qwen3.8-omni-flash': [2, 8],
};
const OTHER_PRICE = [3, 9];

function costOf(model, usage) {
  const [input, output] = PRICES[model] || OTHER_PRICE;
  return (usage.input * input + usage.output * output) / 1e6;
}

function budgetOf(env) {
  const value = Number(env.AI_DAILY_BUDGET);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BUDGET;
}

/**
 * client：createVision() 的返回值（chat）；没有配置密钥时为 null，这时 createAi 也返回 null。
 * usage：get(day) -> { cost } | null、add(day, feature, { calls, failed, input, output, cost })。
 *   读写 ai_usage 出错不挡功能，只打日志（集合还没建时也能用）。
 * log：一行一条的日志（云开发控制台能看到），只有功能名、模型、耗时、token 数和错误码。
 */
function createAi({
  client,
  usage = null,
  env = process.env,
  now = () => Date.now(),
  log = (line) => console.log(line),
}) {
  if (!client) return null;
  const budget = budgetOf(env);
  const writeOff = env.AI_WRITE_OFF === '1';

  function featureOf(name) {
    const feature = FEATURES[name];
    if (!feature) throw new Error(`AI 功能 ${name} 没有登记`);
    return feature;
  }

  async function spentToday() {
    if (!usage) return 0;
    try {
      return Number((await usage.get(todayKey(now())))?.cost) || 0;
    } catch (error) {
      log(
        JSON.stringify({
          event: 'ai.usage',
          ok: false,
          error: error.code || error.message,
        }),
      );
      return 0;
    }
  }

  async function record(name, entry) {
    if (!usage) return;
    try {
      await usage.add(todayKey(now()), name, entry);
    } catch (error) {
      log(
        JSON.stringify({
          event: 'ai.usage',
          ok: false,
          error: error.code || error.message,
        }),
      );
    }
  }

  async function run(name, content) {
    const feature = featureOf(name);
    const model = feature.model(env);
    const started = now();
    try {
      const reply = await client.chat(content, {
        model,
        temperature: feature.temperature,
        maxTokens: feature.maxTokens,
      });
      const cost = costOf(model, reply.usage);
      log(
        JSON.stringify({
          event: 'ai',
          feature: name,
          model,
          ok: true,
          ms: now() - started,
          input: reply.usage.input,
          output: reply.usage.output,
        }),
      );
      await record(name, { calls: 1, failed: 0, ...reply.usage, cost });
      return reply.text;
    } catch (error) {
      log(
        JSON.stringify({
          event: 'ai',
          feature: name,
          model,
          ok: false,
          ms: now() - started,
          code: error.code || 'INTERNAL',
        }),
      );
      await record(name, { calls: 1, failed: 1, input: 0, output: 0, cost: 0 });
      throw error;
    }
  }

  return {
    /** 调模型之前先问：这个功能现在能不能用（总开关、全站费用上限）。不能用时抛 UNAVAILABLE。 */
    async ensure(name) {
      const { tier } = featureOf(name);
      if (tier === 'write' && writeOff)
        throw new ApiError(
          'UNAVAILABLE',
          '喵喵写文字的功能暂时关闭了，记账和截图识别不受影响。',
        );
      const limit = tier === 'write' ? budget * WRITE_SHARE : budget;
      if ((await spentToday()) >= limit)
        throw new ApiError(
          'UNAVAILABLE',
          '今天找喵喵帮忙的人太多了，明天再来吧。',
        );
    },
    /** 读图：图片加提示词。 */
    read(name, imageUrl, prompt) {
      return run(name, [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: prompt },
      ]);
    },
    /** 只有文字。 */
    write(name, prompt) {
      return run(name, [{ type: 'text', text: prompt }]);
    },
  };
}

module.exports = { createAi, FEATURES, PRICES, costOf };
