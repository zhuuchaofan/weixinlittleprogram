/**
 * 一句话类的 AI 小帮手（提示词在 prompts.js，额度在 contract.json 的 ai）。
 * - todo.split：一句话拆成清单条目，只返回给小程序确认，不直接保存。
 * - expense.quick：一句话拆成几笔账（一句话记账），只返回给小程序确认，用 expense.addSome 保存。
 * 先 ai.ensure → 再占小家次数 → 再调模型，失败也算一次。
 * ai：createAi() 的返回值，没有配置模型时为 null。
 */
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { takeQuota } = require('./quota');
const { extractJson, parseAmount, parseBillDate } = require('./bill-parse');
const { todayKey } = require('./dates');
const prompts = require('./prompts');

const { lengths: LENGTHS } = CONTRACT;
const MAX_TODO_ITEMS = 10;
const TODO_ITEM_MAX = 40;
const MAX_QUICK_ITEMS = 10;
const QUICK_NOTE_MAX = 20;
const WEEKDAYS = '日一二三四五六';

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

/**
 * 模型回复 → 几笔账：金额读不出来的丢掉；分类不认识的归「其他」；日期读不出来按今天，并标出来让人核对。
 * 金额单位为分，和 expense.add 一样。
 */
function parseQuickItems(reply, today) {
  const rows = extractJson(reply)?.items;
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = parseAmount(row?.amount);
    if (!amount) continue;
    const cat = CONTRACT.categories.includes(row?.cat) ? row.cat : '其他';
    const day = String(row?.day ?? '').trim();
    const parsed = day ? parseBillDate(day, today) : null;
    const date = parsed && parsed.date <= today ? parsed.date : today;
    items.push({
      amount: amount.fen,
      flow: row?.flow === 'in' || amount.sign === '+' ? 'in' : 'out',
      cat: cat === CONTRACT.settlement ? '其他' : cat,
      note: clean(row?.note, Math.min(QUICK_NOTE_MAX, LENGTHS.expenseNote)),
      date,
      // 没说哪天的就是今天，不用核对；说了却读不出来的按今天，要核对。
      dateGuessed: Boolean(day) && day !== '今天' && !parsed,
    });
    if (items.length >= MAX_QUICK_ITEMS) break;
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

    async 'expense.quick'(openid, payload) {
      const household = await start(openid);
      const text = validate.text(payload?.text, {
        field: '内容',
        min: 2,
        max: LENGTHS.quickText,
      });
      const today = todayKey(now());
      const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
      await spend(household, 'quickAdd');
      const items = parseQuickItems(
        await ai.write(
          'quickAdd',
          prompts.quickAdd({
            text,
            today: `${today} 周${weekday}`,
            categories: CONTRACT.categories.filter(
              (cat) => cat !== CONTRACT.settlement,
            ),
          }),
        ),
        today,
      );
      if (!items.length)
        throw failed(
          '没听出金额，说成「午饭 68，打车 23」这样再试试，或者点「记一笔」手动记。',
        );
      return { items };
    },
  };
}

module.exports = {
  createAssistHandler,
  parseTodoItems,
  parseQuickItems,
};
