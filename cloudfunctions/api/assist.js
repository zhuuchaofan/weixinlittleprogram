/**
 * 清单、吃啥、纪念日里的 AI 小帮手（提示词在 prompts.js，额度在 contract.json 的 ai）。
 * - todo.split：一句话拆成清单条目，只返回给小程序确认，不直接保存。
 * - dish.pick：从小家自己的菜单里挑 3 个。模型只回编号，这里按编号找回菜品，挑不在菜单里的丢掉。
 * - date.wish：给一个纪念日写祝福和 3 个点子（不存，不发名字）。
 * 都是先 ai.ensure → 再占小家次数 → 再调模型，失败也算一次。
 * repositories：dishes.listAll(householdId)、dates.get(householdId, id)；ai：createAi() 的返回值，没有配置模型时为 null。
 */
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { requireRecord } = require('./records');
const { todayKey } = require('./dates');
const { countdown } = require('./anniversary');
const { takeQuota } = require('./quota');
const { extractJson } = require('./bill-parse');
const prompts = require('./prompts');

const { lengths: LENGTHS } = CONTRACT;
const MAX_TODO_ITEMS = 10;
const TODO_ITEM_MAX = 40;
const MAX_MENU = 80;
const PICKS = 3;
const REASON_MAX = 20;
const WISH_MAX = 200;
const IDEA_MAX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** 距离 today 过了几天；没吃过为 -1。 */
function daysSince(ateOn, today) {
  if (!validate.isDate(ateOn)) return -1;
  const [a, b] = [ateOn, today].map((day) => Date.parse(`${day}T00:00:00Z`));
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

const ateText = (days) =>
  days < 0
    ? '没记过'
    : days === 0
      ? '今天'
      : days === 1
        ? '昨天'
        : `${days} 天前`;

/** 模型回复 → 挑中的菜：编号必须在候选里，不重复，理由限长。 */
function parsePicks(reply, candidates) {
  const rows = extractJson(reply)?.picks;
  const used = new Set();
  const picks = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const dish = candidates[Number(row?.n) - 1];
    if (!dish || used.has(dish.id)) continue;
    used.add(dish.id);
    picks.push({
      id: dish.id,
      name: dish.name,
      tag: dish.tag,
      reason: clean(row?.reason, REASON_MAX),
    });
    if (picks.length >= PICKS) break;
  }
  return picks;
}

/** 模型回复 → 祝福和点子；祝福为空算失败，点子最多 3 个。 */
function parseWish(reply) {
  const data = extractJson(reply);
  const wish = clean(data?.wish, WISH_MAX);
  const ideas = (Array.isArray(data?.ideas) ? data.ideas : [])
    .map((idea) => clean(idea, IDEA_MAX))
    .filter(Boolean)
    .slice(0, 3);
  return wish ? { wish, ideas } : null;
}

const yearsText = (item) =>
  item.yearly && item.years > 0 ? `第 ${item.years} 个周年` : '';

function createAssistHandler({
  repositories,
  households,
  requireMembership,
  now,
  ai,
}) {
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

    async 'dish.pick'(openid, payload) {
      const household = await start(openid);
      const want = validate.text(payload?.want, {
        field: '想吃的',
        max: LENGTHS.dishWant,
      });
      const tag = payload?.tag
        ? validate.oneOf(
            payload.tag,
            CONTRACT.dishTags,
            '选一下在家做、外食还是外卖吧。',
          )
        : '';
      const today = todayKey(now());
      const all = (await repositories.dishes.listAll(household._id))
        .filter((dish) => !tag || dish.tag === tag)
        .map((dish) => ({
          id: dish._id,
          name: dish.name,
          tag: dish.tag,
          days: daysSince(dish.ateOn, today),
        }));
      if (all.length < 2)
        throw new ApiError(
          'VALIDATION',
          '菜单里至少要有 2 个才好挑，先加几个吧。',
        );
      // 最近吃过的靠后，菜单太长只留前 MAX_MENU 个。
      const candidates = all
        .sort(
          (a, b) => (b.days < 0 ? 999 : b.days) - (a.days < 0 ? 999 : a.days),
        )
        .slice(0, MAX_MENU);
      await spend(household, 'dishPick');
      const picks = parsePicks(
        await ai.write(
          'dishPick',
          prompts.dishPick({
            want,
            menu: candidates.map(
              (dish, index) =>
                `${index + 1}｜${dish.name}｜${dish.tag}｜${ateText(dish.days)}`,
            ),
          }),
        ),
        candidates,
      );
      if (!picks.length)
        throw failed('没挑出来，换个说法再试试，或者用「抽一个」。');
      return { picks };
    },

    async 'date.wish'(openid, payload) {
      const household = await start(openid);
      const record = await requireRecord(
        repositories.dates,
        household,
        validate.id(payload?.id),
      );
      const budget = Object.hasOwn(prompts.BUDGETS, payload?.budget)
        ? payload.budget
        : 'mid';
      const item = countdown(
        record.date,
        Boolean(record.yearly),
        todayKey(now()),
      );
      const when = item.passed
        ? `已经过去 ${item.days} 天`
        : item.days === 0
          ? '就是今天'
          : `还有 ${item.days} 天`;
      await spend(household, 'dateWish');
      const result = parseWish(
        await ai.write(
          'dateWish',
          prompts.dateWish({
            title: clean(record.title, LENGTHS.dateTitle),
            years: yearsText(item),
            when,
            budget,
          }),
        ),
      );
      if (!result) throw failed('喵喵这次没想出来，过一会儿再试试吧。');
      return result;
    },
  };
}

module.exports = {
  createAssistHandler,
  parseTodoItems,
  parsePicks,
  parseWish,
  daysSince,
};
