/**
 * 一句话类的 AI 小帮手（提示词在 prompts.js，额度在 contract.json 的 ai）。
 * - todo.split：一句话拆成清单条目，只返回给小程序确认，不直接保存。
 * 先 ai.ensure → 再占小家次数 → 再调模型，失败也算一次。
 * ai：createAi() 的返回值，没有配置模型时为 null。
 */
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { takeQuota } = require('./quota');
const { extractJson } = require('./bill-parse');
const prompts = require('./prompts');

const { lengths: LENGTHS } = CONTRACT;
const MAX_TODO_ITEMS = 10;
const TODO_ITEM_MAX = 40;

const UNAVAILABLE =
  '这个功能还没开通：需要在云函数 api 里配置 DASHSCOPE_API_KEY。';

/** 模型有时会带 Markdown 符号和多余空白：去掉，限长。 */
function clean(value, max) {
  return String(value ?? '')
    .replace(/[*#`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 模型回复 → 清单条目：kind 只认 shop / todo，空的和重复的丢掉，最多 MAX_TODO_ITEMS 条。 */
function parseTodoItems(reply) {
  const rows = extractJson(reply)?.items;
  const seen = new Set();
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = clean(row?.text, Math.min(TODO_ITEM_MAX, LENGTHS.todoText));
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push({ text, kind: row?.kind === 'shop' ? 'shop' : 'todo' });
    if (items.length >= MAX_TODO_ITEMS) break;
  }
  return items;
}

function createAssistHandler({ households, requireMembership, now, ai }) {
  async function start(openid) {
    const household = await requireMembership(openid);
    if (!ai) throw new ApiError('UNAVAILABLE', UNAVAILABLE);
    return household;
  }
  /** 检查全站开关和费用上限，再占小家今天的次数。 */
  async function spend(household, feature) {
    await ai.ensure(feature);
    await takeQuota(households, household, feature, now());
  }
  const failed = (message) => new ApiError('UNAVAILABLE', message);

  return {
    async 'todo.split'(openid, payload) {
      const household = await start(openid);
      const text = validate.text(payload?.text, {
        field: '内容',
        min: 2,
        max: LENGTHS.todoSplitText,
      });
      await spend(household, 'todoSplit');
      const items = parseTodoItems(
        await ai.write('todoSplit', prompts.todoSplit(text)),
      );
      if (!items.length)
        throw failed('没拆出来，换个说法再试试，或者直接一条一条加。');
      return { items };
    },
  };
}

module.exports = {
  createAssistHandler,
  parseTodoItems,
};
