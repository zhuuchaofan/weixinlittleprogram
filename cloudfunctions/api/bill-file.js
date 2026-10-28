/**
 * 账单文件导入：微信「下载账单 → 用于个人对账」的 Excel。
 * 文件在手机上读（miniprogram/utils/bill-file.ts），只把每笔要用的几列送来：
 * 交易时间、交易类型、交易对方、收/支、金额、当前状态、交易单号。昵称、银行卡、商品明细不出手机。
 * 这里决定每一行记不记、记多少、怎么写备注；交易单号只用来算指纹，不保存。
 */
const crypto = require('node:crypto');
const { ApiError } = require('./errors');
const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { MERCHANT_MAX, DAY_MS, str } = require('./bill-parse');

// 一次请求最多带多少行（本批 + 用来配对退款的前后行）；整份文件可以更长，由小程序分批发来。
const { maxFileChunk: MAX_ROWS } = CONTRACT.billImport;
// 生成的备注里商户名最多几个字；完整名字留在 src.merchant 里查重用。
const NOTE_NAME_MAX = 12;
const BAD_FILE =
  '没能读懂这份账单，请选微信「下载账单 → 用于个人对账」发来的 Excel。';

/** 交易单号 → 指纹，同一笔账无论导几次都一样；也作为 src.key。 */
function refKey(app, tx) {
  return crypto
    .createHash('sha256')
    .update(`${app}\n${tx}`)
    .digest('hex')
    .slice(0, 24);
}

/** "15.4"、"¥15.40"、"15.400000000000002" → 分；读不出来返回 0。 */
function fileAmount(raw) {
  const text = str(raw).replace(/[,，\s¥￥元]/g, '');
  if (!/^\d{1,8}(\.\d+)?$/.test(text)) return 0;
  const fen = Math.round(Number(text) * 100);
  return fen >= 1 && fen <= CONTRACT.maxAmount ? fen : 0;
}

/**
 * 交易时间：Excel 里是日期数字（1899-12-30 起的天数，已是北京时间），
 * 转成文本的也认 "2026-10-21 22:07:01"。返回 { date, time, at }，at 用来排先后。
 */
function fileTime(raw) {
  const text = str(raw);
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const ms = Math.round((Number(text) - 25569) * DAY_MS);
    const iso = new Date(ms).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16), at: ms };
  }
  const match =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      text,
    );
  if (!match) return null;
  const [y, m, d, h = '0', min = '0', s = '0'] = match.slice(1);
  const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  if (!validate.isDate(date) || Number(h) > 23 || Number(min) > 59) return null;
  return {
    date,
    time: match[4] ? `${h.padStart(2, '0')}:${min}` : '',
    at: Date.UTC(+y, +m - 1, +d, +h, +min, +s),
  };
}

/** 交易对方：「/」当没有；去掉公司后缀，方便查重时比相似。 */
function cleanName(raw) {
  const text = str(raw);
  if (!text || text === '/') return '';
  return text
    .replace(/[（(]个体工商户[)）]?$/, '')
    .replace(/(股份)?有限(责任)?公司$/, '')
    .trim()
    .slice(0, MERCHANT_MAX);
}

/** 交易类型 + 收支 → 截图记账同一套 kind。亲属卡交易按消费算，备注另加前缀。 */
function kindOf(type, flow) {
  if (type.includes('退款')) return '退款';
  if (type.startsWith('微信红包')) return '红包';
  if (type.startsWith('转账')) return '转账';
  return flow === 'in' ? '收入' : '消费';
}

/** 备注：消费只写商户（最多 12 字），其他加前缀，如「退款·美团」；部分退款注明退了多少。 */
function fileNote(prefix, name, refunded) {
  const short = name.slice(0, NOTE_NAME_MAX);
  let note = prefix ? (short ? `${prefix}·${short}` : prefix) : short || '消费';
  if (refunded) note += ` 已退¥${(refunded / 100).toFixed(2)}`;
  return note.slice(0, CONTRACT.lengths.expenseNote);
}

// 没有 AI，先按商户名里的关键词猜分类，按顺序取第一个对上的；猜不到的归「其他」，在确认列表里改。
const CATEGORY_WORDS = [
  ['猫咪', /猫|宠物|波奇/],
  [
    '交通',
    /滴滴|出行|打车|地铁|公交|铁路|12306|航空|机场|加油|石油|石化|充电|特来电|停车|租车|高速|哈啰|单车|曹操|花小猪/,
  ],
  ['水电网', /电费|水费|燃气|电力|水务|物业|宽带|移动|联通|电信|话费/],
  ['房租', /房租|公寓|自如|租房/],
  ['旅行', /酒店|宾馆|民宿|携程|飞猪|去哪儿|同程|景区|旅游|门票/],
  [
    '娱乐',
    /电影|影城|影院|KTV|游戏|腾讯视频|爱奇艺|优酷|哔哩|Apple|音乐|演出|剧场/i,
  ],
  [
    '吃饭',
    /餐|饭|面|饺|包子|粉|火锅|烧烤|咖啡|coffee|luckin|星巴克|瑞幸|茶|奶|蜜雪|肯德基|麦当劳|汉堡|披萨|美团|饿了么|海底捞|小吃|食|烤|串|蛋糕|甜品/i,
  ],
  [
    '日用',
    /超市|便利|小卖|京东|淘宝|天猫|拼多多|盒马|永辉|沃尔玛|山姆|药|商行|百货|商城/,
  ],
];

function guessCategory(name) {
  return CATEGORY_WORDS.find(([, words]) => words.test(name))?.[0] || '其他';
}

/** 原支出「当前状态」里写的已退金额：「已全额退款」「对方已退还」→ 全额；「已退款(¥14.53)」→ 1453。 */
function refundedOf(status, amount) {
  if (/全额退款|已退还/.test(status)) return amount;
  const match = /已退款[（(]?[¥￥]?(\d+(?:\.\d{1,2})?)/.exec(status);
  return match ? Math.min(amount, Math.round(Number(match[1]) * 100)) : 0;
}

/** 前端送来的一行：每个字段都是字符串，多余的不要。 */
function rowOf(raw) {
  const pick = (field) => str(raw?.[field]).slice(0, 80);
  return {
    time: pick('time'),
    type: pick('type'),
    peer: pick('peer'),
    io: pick('io'),
    amount: pick('amount'),
    status: pick('status'),
    tx: pick('tx'),
  };
}

/**
 * 先过一遍：读不全的、中性交易、没付成的跳过，同一单号只留一行。
 * skipped 为 null 时不计数（配对用的前后行不算本批的）。
 */
function readLines(rows, skipped, seen) {
  const count = skipped || { neutral: 0, closed: 0, refunded: 0, broken: 0 };
  const lines = [];
  for (const raw of rows) {
    const row = rowOf(raw);
    const when = fileTime(row.time);
    const amount = fileAmount(row.amount);
    if (!when || !amount || !row.tx) {
      count.broken++;
      continue;
    }
    if (seen.has(row.tx)) continue;
    seen.add(row.tx);
    if (row.io !== '支出' && row.io !== '收入') {
      count.neutral++;
      continue;
    }
    if (/失败|关闭|撤销/.test(row.status)) {
      count.closed++;
      continue;
    }
    const flow = row.io === '收入' ? 'in' : 'out';
    lines.push({ ...row, ...when, amount, flow, kind: kindOf(row.type, flow) });
  }
  return lines;
}

/**
 * 退款行认领原支出：原支出状态里写的已退金额和退款行金额一样、原支出在退款之前，取离得最近的。
 * 认领到的退款行不单独记（已经从原支出里扣掉了）。
 */
function absorbRefunds(lines) {
  const originals = lines
    .filter((line) => line.flow === 'out')
    .map((line) => ({ line, refunded: refundedOf(line.status, line.amount) }))
    .filter((entry) => entry.refunded);
  const absorbed = new Set();
  const refunds = lines
    .filter((line) => line.flow === 'in' && line.kind === '退款')
    .sort((a, b) => a.at - b.at);
  for (const refund of refunds) {
    const original = originals
      .filter(
        (entry) =>
          entry.refunded === refund.amount && entry.line.at <= refund.at,
      )
      .sort((a, b) => b.line.at - a.line.at)[0];
    if (!original) continue;
    originals.splice(originals.indexOf(original), 1);
    absorbed.add(refund);
  }
  return absorbed;
}

/**
 * 一份微信账单的行 → { items, skipped }。文件很长时小程序分批发来：rows 是本批，
 * context 是前后日期里的退款和被退款的行，只用来给本批配对，不出结果、不计数。
 * - 收/支为「/」的中性交易（提现、零钱通、信用卡还款）跳过；支付失败、已关闭的跳过。
 * - 退款：原支出按净额记（全额退了就不记）；对应的「××-退款」行不再单独记。
 *   原支出不在这份文件里（更早导入过）的退款行，记一笔收入「退款·商户」。
 * - 收到后又退还给对方的转账不记。
 * - 亲属卡交易：钱从导入的人这里扣，记在导入的人名下，备注「亲属卡·昵称」。
 */
function parseWechatRows(rows, context = []) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(context))
    throw new ApiError('VALIDATION', BAD_FILE);
  if (rows.length + context.length > MAX_ROWS)
    throw new ApiError('VALIDATION', '一次发来的账目太多了，请重试。');
  const skipped = { neutral: 0, closed: 0, refunded: 0, broken: 0 };
  const seen = new Set();
  const own = readLines(rows, skipped, seen);
  const around = readLines(context, null, seen).map((line) => ({
    ...line,
    context: true,
  }));
  const lines = [...own, ...around];
  const absorbed = absorbRefunds(lines);
  const items = [];
  for (const line of own) {
    const refunded =
      line.flow === 'out'
        ? refundedOf(line.status, line.amount)
        : /已退还/.test(line.status)
          ? line.amount
          : 0;
    const amount = line.amount - refunded;
    if (absorbed.has(line) || amount <= 0) {
      skipped.refunded++;
      continue;
    }
    const name = cleanName(line.peer);
    const family = line.type === '亲属卡交易';
    const prefix = family ? '亲属卡' : line.kind === '消费' ? '' : line.kind;
    const key = refKey('wechat', line.tx);
    items.push({
      amount,
      flow: line.flow,
      date: line.date,
      dateGuessed: false,
      time: line.time,
      kind: line.kind,
      merchant: name,
      note: fileNote(prefix, name, refunded),
      cat: line.kind === '消费' && !family ? guessCategory(name) : '其他',
      src: {
        app: 'wechat',
        merchant: name,
        time: line.time,
        date: line.date,
        amount,
        flow: line.flow,
        ref: key,
      },
      key,
      problem: '',
    });
  }
  return { items, skipped };
}

module.exports = {
  MAX_ROWS,
  refKey,
  fileAmount,
  fileTime,
  cleanName,
  guessCategory,
  fileNote,
  refundedOf,
  parseWechatRows,
};
