/**
 * 截图记账：微信 / 支付宝账单列表截图 → 视觉模型读出每一笔 → 查重 → 用户确认后批量保存。
 * - 模型只负责看图抽字段（PROMPT），金额、日期的换算和校验都在这里做。
 * - 导入的账一律记为上传者付款、split === 'self'（不参与分摊）。
 * - 每笔导入的账有 src.key（App + 原始日期、时刻、金额、商户、收支）；
 *   _id 由小家和 key 算出，同一笔账两人同时导入也只落一次。
 * - 查重：金额相同才算重复；src.key 一致 → 已导入过；同一天且商户与备注相似 → 很可能重复；
 *   日期相差不超过 1 天 → 可能重复。一条已有账目只能对上一笔。
 */
const crypto = require('node:crypto');
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { SETTLEMENT } = require('./ledger');
const { todayKey } = require('./dates');

const { maxItems: MAX_ITEMS } = CONTRACT.billImport;
const KINDS = ['消费', '退款', '转账', '红包', '收入', '其他'];
// 这些类型没有正负号时按收入处理。
const INCOME_KINDS = ['退款', '收入'];
const MERCHANT_MAX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROMPT = `这是一张微信或支付宝的账单列表截图。把列表里的每一笔交易读出来，只输出 JSON，不要任何解释：
{"app":"wechat 或 alipay","items":[{"date":"10-24","time":"12:31","merchant":"美团外卖","amount":"-23.50","kind":"消费","cat":"吃饭"}]}
规则：
- date 按截图原样：能看到年份写 YYYY-MM-DD，看不到年份写 MM-DD；显示「今天」「昨天」「前天」「周三」就照写。列表分组标题（如「2026年10月」）里的年月要用上。
- time 写 HH:mm，没有就留空字符串。
- amount 保留截图里的正负号和小数，不要货币符号。有划线的原价时只取实际付的金额（没划线的那个）。
- kind 只能是：${KINDS.join('、')}。
- merchant 写商户名或对方名称；转账、红包写对方的名字。
- cat 从这些里选一个最合适的：${CONTRACT.categories.join('、')}。
- 跳过标着「交易关闭」「已关闭」「支付失败」的交易（没有实际付款）。
- 跳过月度合计、筛选栏、广告、按钮等不是交易的内容；看不清的字段留空字符串。
- 截图里没有交易时输出 {"app":"","items":[]}。`;

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 模型回复里取出 JSON：可能包在 ```json 代码块里。 */
function extractJson(reply) {
  const text = str(reply);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** "-23.50" → { fen: 2350, sign: '-' }；读不出来返回 null。 */
function parseAmount(raw) {
  const text = str(raw).replace(/[,，\s¥￥元]/g, '');
  const match = /^([+-])?(\d{1,8})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const fen = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (fen < 1 || fen > CONTRACT.maxAmount) return null;
  return { fen, sign: match[1] || '' };
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function keyToMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

const WEEKDAYS = '日一二三四五六';

/**
 * 截图上的日期 → YYYY-MM-DD。today 为上传当天（UTC+8）。
 * 「今天 / 昨天 / 周三」按上传当天推算，guessed 为 true，确认页会提醒核对；
 * 没有年份的按今年，晚于今天的算去年。读不出来返回 null。
 */
function parseBillDate(raw, today) {
  const text = str(raw).replace(/\s/g, '');
  const base = keyToMs(today);
  const relative = { 今天: 0, 昨天: 1, 前天: 2 }[text];
  if (relative !== undefined)
    return { date: dayKey(base - relative * DAY_MS), guessed: true };
  const weekday = /^(?:周|星期)([日天一二三四五六])$/.exec(text);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1] === '天' ? '日' : weekday[1]);
    const back = (new Date(base).getUTCDay() - target + 7) % 7;
    return { date: dayKey(base - back * DAY_MS), guessed: true };
  }
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  const short = /^(\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  let y, m, d;
  if (full) [y, m, d] = full.slice(1).map(Number);
  else if (short) {
    [m, d] = short.slice(1).map(Number);
    y = Number(today.slice(0, 4));
  } else return null;
  let date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!validate.isDate(date)) return null;
  if (short && date > today) date = `${y - 1}${date.slice(4)}`;
  return validate.isDate(date) ? { date, guessed: false } : null;
}

function parseTime(raw) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(str(raw));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** 截图上原始的一笔：查重和防止重复导入都靠它。 */
function billKey(src) {
  return crypto
    .createHash('sha256')
    .update(
      [src.app, src.date, src.time, src.amount, src.merchant, src.flow].join(
        '\n',
      ),
    )
    .digest('hex')
    .slice(0, 24);
}

/** 备注：消费只写商户，其他类型加前缀，如「退款·美团外卖」。 */
function noteFor(kind, merchant) {
  const note = kind === '消费' || !merchant ? merchant : `${kind}·${merchant}`;
  return (note || kind).slice(0, CONTRACT.lengths.expenseNote);
}

/** 模型读出的一行 → 待确认的一笔。读不全的字段留空并写明 problem，交给确认页补。 */
function normalizeItem(raw, app, today) {
  const kind = KINDS.includes(str(raw?.kind)) ? str(raw.kind) : '其他';
  const merchant = str(raw?.merchant).slice(0, MERCHANT_MAX);
  const amount = parseAmount(raw?.amount);
  const date = parseBillDate(raw?.date, today);
  const flow =
    amount?.sign === '+' ||
    (amount?.sign !== '-' && INCOME_KINDS.includes(kind))
      ? 'in'
      : 'out';
  const cat = str(raw?.cat);
  const src = {
    app,
    merchant,
    time: parseTime(raw?.time),
    date: date ? date.date : '',
    amount: amount ? amount.fen : 0,
    flow,
  };
  const problems = [];
  if (!amount) problems.push('金额没读出来');
  if (!date) problems.push('日期没读出来');
  return {
    amount: src.amount,
    flow,
    date: src.date,
    dateGuessed: date ? date.guessed : false,
    time: src.time,
    kind,
    merchant,
    note: noteFor(kind, merchant),
    cat: CONTRACT.categories.includes(cat) && cat !== SETTLEMENT ? cat : '其他',
    src,
    key: billKey(src),
    problem: problems.join('，'),
  };
}

/** 模型回复 → { app, items }。 */
function parseReply(reply, today) {
  const data = extractJson(reply);
  if (!data || !Array.isArray(data.items))
    throw new ApiError(
      'VALIDATION',
      '没能读懂这张截图，请换一张清楚的账单列表截图。',
    );
  const app = CONTRACT.billApps.includes(data.app) ? data.app : '';
  return {
    app,
    items: data.items
      .slice(0, MAX_ITEMS)
      .map((raw) => normalizeItem(raw, app || 'wechat', today)),
  };
}

function plain(text) {
  return str(text)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(text) {
  const result = [];
  for (let i = 0; i < text.length - 1; i++) result.push(text.slice(i, i + 2));
  return result;
}

/** 商户名与备注是否相似：一方包含另一方，或两字组重合度（Dice）≥ 0.4。 */
function similar(a, b) {
  const x = plain(a);
  const y = plain(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const xs = bigrams(x);
  const ys = bigrams(y);
  if (!xs.length || !ys.length) return false;
  const pool = [...ys];
  let common = 0;
  for (const gram of xs) {
    const index = pool.indexOf(gram);
    if (index >= 0) {
      common++;
      pool.splice(index, 1);
    }
  }
  return (2 * common) / (xs.length + ys.length) >= 0.4;
}

function daysApart(a, b) {
  return Math.abs(keyToMs(a) - keyToMs(b)) / DAY_MS;
}

/** 转给对方、对方转来的钱：两人之间的转账不记。 */
function isPartnerTransfer(item, household) {
  if (item.kind !== '转账' && item.kind !== '红包') return false;
  return household.members.some(
    (member) => member.name && item.merchant.includes(member.name),
  );
}

/**
 * 给每一笔打上 status：imported / likely / possible / partner / new，
 * 撞上的已有账目放在 match。同一批里 key 相同的（连续截图的重叠部分）只留一笔。
 */
function matchItems(items, records, household) {
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  const candidates = records.filter((record) => record.cat !== SETTLEMENT);
  const used = new Set();
  const roleOf = (openid) =>
    household.members.find((member) => member.openid === openid)?.role || '';
  const describe = (record) => ({
    id: record._id,
    date: record.date,
    note: record.note,
    amount: record.amount,
    byRole: roleOf(record.by),
  });
  const take = (record) => {
    used.add(record._id);
    return describe(record);
  };
  const free = (record) => !used.has(record._id);
  // 先认领「已导入过」，再按相似程度认领，避免一条已有账目被松的规则先占掉。
  const result = unique.map((item) => {
    const exact = candidates.find(
      (record) => free(record) && record.src?.key === item.key,
    );
    return exact ? { ...item, status: 'imported', match: take(exact) } : item;
  });
  return result.map((item) => {
    if (item.status) return item;
    if (isPartnerTransfer(item, household))
      return { ...item, status: 'partner', match: null };
    if (!item.amount || !item.date)
      return { ...item, status: 'new', match: null };
    const same = candidates.filter(
      (record) =>
        free(record) &&
        record.amount === item.amount &&
        (record.flow || 'out') === item.flow &&
        daysApart(record.date, item.date) <= 1,
    );
    const likely = same.find(
      (record) =>
        record.date === item.date &&
        (similar(item.merchant, record.note) ||
          similar(item.merchant, record.src?.merchant)),
    );
    if (likely) return { ...item, status: 'likely', match: take(likely) };
    const possible = same.sort(
      (a, b) => daysApart(a.date, item.date) - daysApart(b.date, item.date),
    )[0];
    if (possible) return { ...item, status: 'possible', match: take(possible) };
    return { ...item, status: 'new', match: null };
  });
}

const BAD_SOURCE = '截图信息无效，请重新识别。';

/** 前端送回来的截图原始字段（bill.parse 给出的 src）：逐项校验后重新算 key，不相信前端的 key。 */
function sourceOf(raw) {
  const src = raw?.src;
  if (
    !src ||
    !Number.isInteger(src.amount) ||
    src.amount < 0 ||
    src.amount > CONTRACT.maxAmount ||
    (src.date !== '' && !validate.isDate(src.date))
  )
    throw new ApiError('VALIDATION', BAD_SOURCE);
  const result = {
    app: validate.oneOf(src.app, CONTRACT.billApps, BAD_SOURCE),
    merchant: validate.text(src.merchant, { field: '商户', max: MERCHANT_MAX }),
    time: parseTime(src.time),
    date: src.date,
    amount: src.amount,
    flow: validate.oneOf(src.flow, CONTRACT.flows, BAD_SOURCE),
  };
  return { ...result, key: billKey(result) };
}

/** bill.parse 的一笔原样送回来查重：按原始字段重建，status 由服务端判断。 */
function checkedItem(raw) {
  const { key, ...src } = sourceOf(raw);
  const kind = KINDS.includes(raw.kind) ? raw.kind : '其他';
  return {
    amount: src.amount,
    flow: src.flow,
    date: src.date,
    dateGuessed: raw.dateGuessed === true,
    time: src.time,
    kind,
    merchant: src.merchant,
    note: noteFor(kind, src.merchant),
    cat:
      CONTRACT.categories.includes(raw.cat) && raw.cat !== SETTLEMENT
        ? raw.cat
        : '其他',
    src,
    key,
    problem: [!src.amount && '金额没读出来', !src.date && '日期没读出来']
      .filter(Boolean)
      .join('，'),
  };
}

function monthsAround(dates) {
  const months = new Set();
  for (const date of dates) {
    const ms = keyToMs(date);
    for (const delta of [-1, 0, 1])
      months.add(dayKey(ms + delta * DAY_MS).slice(0, 7));
  }
  return [...months];
}

function itemList(payload) {
  const items = payload?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS)
    throw new ApiError('VALIDATION', `一次最多导入 ${MAX_ITEMS} 笔。`);
  return items;
}

/**
 * repository：expenses 集合（listMonth、insertWithId）。
 * vision：{ read(imageUrl, prompt) -> 模型回复文本 }；没有配置模型时为 null。
 */
function createBillHandler({ repository, requireMembership, now, vision }) {
  return {
    async 'bill.parse'(openid, payload) {
      await requireMembership(openid);
      if (!vision)
        throw new ApiError(
          'UNAVAILABLE',
          '截图记账还没开通：需要在云函数 api 里配置 DASHSCOPE_API_KEY。',
        );
      const url = str(payload?.url);
      if (!/^https:\/\/\S{1,1000}$/.test(url))
        throw new ApiError('VALIDATION', '截图上传失败，请重试。');
      return parseReply(await vision.read(url, PROMPT), todayKey(now()));
    },
    async 'bill.match'(openid, payload) {
      const household = await requireMembership(openid);
      const items = itemList(payload).map(checkedItem);
      const dates = items.map((item) => item.date).filter(Boolean);
      const records = (
        await Promise.all(
          monthsAround(dates).map((month) =>
            repository.listMonth(household._id, month),
          ),
        )
      ).flat();
      return { items: matchItems(items, records, household) };
    },
    async 'expense.addMany'(openid, payload) {
      const household = await requireMembership(openid);
      const payer = household.members.find(
        (member) => member.openid === openid,
      ).role;
      const docs = itemList(payload).map((item) => {
        const { app, merchant, time, key } = sourceOf(item);
        return {
          ...validate.expense({ ...item, payer, split: 'self' }),
          src: { app, merchant, time, key },
          householdId: household._id,
          ts: now(),
          by: openid,
        };
      });
      let added = 0;
      // 逐批写入；_id 由小家和 key 决定，已存在的（导入过或对方刚导入）跳过。
      for (let i = 0; i < docs.length; i += 10) {
        const results = await Promise.all(
          docs
            .slice(i, i + 10)
            .map((doc) =>
              repository.insertWithId(
                'bill_' +
                  crypto
                    .createHash('sha256')
                    .update(`${household._id}\n${doc.src.key}`)
                    .digest('hex')
                    .slice(0, 24),
                doc,
              ),
            ),
        );
        added += results.filter(Boolean).length;
      }
      return { added, skipped: docs.length - added };
    },
  };
}

module.exports = {
  PROMPT,
  createBillHandler,
  extractJson,
  parseAmount,
  parseBillDate,
  normalizeItem,
  parseReply,
  similar,
  matchItems,
  billKey,
};
