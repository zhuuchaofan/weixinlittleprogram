/**
 * 截图记账：模型回复 → 待确认的每一笔。模型只负责看图抽字段（PROMPT），
 * 金额、日期的换算和校验都在这里做。
 */
const crypto = require('node:crypto');
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { SETTLEMENT } = require('./ledger');
const { billScreenshot } = require('./prompts');

const { maxItems: MAX_ITEMS } = CONTRACT.billImport;
const KINDS = ['消费', '退款', '转账', '红包', '收入', '其他'];
// 这些类型没有正负号时按收入处理。
const INCOME_KINDS = ['退款', '收入'];
const MERCHANT_MAX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROMPT = billScreenshot({
  kinds: KINDS,
  categories: CONTRACT.categories,
});

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
      '这张截图喵喵没看清，换一张清楚的账单列表截图试试吧。',
    );
  const app = CONTRACT.billApps.includes(data.app) ? data.app : '';
  return {
    app,
    items: data.items
      .slice(0, MAX_ITEMS)
      .map((raw) => normalizeItem(raw, app || 'wechat', today)),
  };
}

module.exports = {
  KINDS,
  MAX_ITEMS,
  MERCHANT_MAX,
  DAY_MS,
  PROMPT,
  str,
  extractJson,
  parseAmount,
  dayKey,
  keyToMs,
  parseBillDate,
  parseTime,
  billKey,
  noteFor,
  normalizeItem,
  parseReply,
};
