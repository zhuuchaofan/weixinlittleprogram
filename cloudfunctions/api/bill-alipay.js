/**
 * 账单文件导入：支付宝「开具交易流水证明 → 用于个人对账」的 CSV。
 * 文件在手机上读（miniprogram/utils/bill-file.ts），文件是 GBK 编码，手机上不解码，
 * 只把每笔要用的几列按原始字节（每个字节一个字符）送来，这里按 enc 解成文字。
 * 银行卡、对方账号、商家订单号、备注不出手机；交易订单号只用来算指纹，不保存。
 */
const { ApiError } = require('./errors');
const { MERCHANT_MAX, str } = require('./bill-parse');
const {
  MAX_ROWS,
  refKey,
  fileAmount,
  fileTime,
  cleanName,
  guessCategory,
  fileNote,
} = require('./bill-file');

const BAD_FILE =
  '没能读懂这份账单，请选支付宝「开具交易流水证明 → 用于个人对账」发来的 CSV。';
const ENCODINGS = ['gbk', 'utf-8'];

// 支付宝自己的分类 → 这里的分类；没写的（医疗、保险、教育…）按关键词猜，猜不到归「其他」。
const CATEGORY_OF = {
  餐饮美食: '吃饭',
  交通出行: '交通',
  日用百货: '日用',
  商业服务: '日用',
  数码电器: '日用',
  家居家装: '日用',
  服饰装扮: '日用',
  美容美发: '日用',
  母婴亲子: '日用',
  宠物: '猫咪',
  充值缴费: '水电网',
  酒店旅游: '旅行',
  文化休闲: '娱乐',
  运动户外: '娱乐',
};
// 交易对方是这些平台时，真正的商户名在商品说明里。
const PLATFORM = /^(淘宝闪购|饿了么|美团|美团外卖|淘宝|天猫|京东|拼多多)$/;
const FAILED = /失败|关闭|撤销/;

function decode(text, enc) {
  const bytes = Buffer.from(str(text), 'latin1');
  return new TextDecoder(enc, { fatal: false })
    .decode(bytes)
    .replace(/�/g, '')
    .trim();
}

/** 前端送来的一行：时间、金额、单号是纯 ASCII；文字列要按 enc 解码。 */
function rowOf(raw, enc) {
  const pick = (field, max) => str(raw?.[field]).slice(0, max);
  return {
    time: pick('time', 30),
    cls: decode(pick('cls', 40), enc),
    peer: decode(pick('peer', 90), enc),
    goods: decode(pick('goods', 90), enc),
    io: decode(pick('io', 20), enc),
    amount: pick('amount', 30),
    status: decode(pick('status', 40), enc),
    tx: pick('tx', 60).trim(),
  };
}

/** 商户名：平台和被遮住的店名（「tb**9」）改用商品说明，外卖订单去掉后缀。 */
function labelOf(row, transfer) {
  const peer = cleanName(row.peer);
  if (transfer) return peer.replace(/^\*+/, '');
  if (peer && !/\*/.test(peer) && !PLATFORM.test(peer)) return peer;
  const goods = row.goods
    .replace(/外卖订单$|外卖$|订单$/, '')
    .replace(/[（(][^）)]*店[）)]/, '')
    .trim();
  return (goods || peer).slice(0, MERCHANT_MAX);
}

function kindOf(row, flow) {
  if (row.cls === '转账红包' || /收钱码收款/.test(row.goods))
    return /红包/.test(row.goods) ? '红包' : '转账';
  return flow === 'in' ? '收入' : '消费';
}

/** 退款行「退款-xxx」认领原支出：同一个商户、商品对得上、金额够退、在退款之前，取离得最近的。 */
function absorbRefunds(lines, refunds) {
  const refundedOf = new Map();
  for (const refund of [...refunds].sort((a, b) => a.at - b.at)) {
    const goods = refund.goods.replace(/^退款-/, '').slice(0, 15);
    const original = lines
      .filter(
        (line) =>
          line.flow === 'out' &&
          line.peer === refund.peer &&
          line.goods.slice(0, 15) === goods &&
          line.at <= refund.at &&
          line.amount - (refundedOf.get(line) || 0) >= refund.amount,
      )
      .sort((a, b) => b.at - a.at)[0];
    if (original)
      refundedOf.set(original, (refundedOf.get(original) || 0) + refund.amount);
  }
  return refundedOf;
}

/**
 * 一份支付宝账单的行 → { items, skipped }。文件很长时小程序分批发来：rows 是本批，
 * context 是前后日期里的退款和被退款的行，只用来给本批配对，不出结果、不计数。
 * - 收/支为「不计收支」的（提现、余额宝、预授权冻结 / 解冻、退款行）、金额 0 的跳过；交易关闭的跳过。
 * - 退款：支付宝的退款行是「不计收支」，从同一商户、同一商品的原支出里扣掉；全额退了就不记。
 *   找不到原支出（原支出没付成或不在这份文件里）的退款不记。
 * - 对方遮成「*蓉」的转账、收钱码收款，记成转账，和小家成员对得上的在查重时标成「你们俩之间」。
 */
function parseAlipayRows(rows, context = [], enc = 'gbk') {
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    !Array.isArray(context) ||
    !ENCODINGS.includes(enc)
  )
    throw new ApiError('VALIDATION', BAD_FILE);
  if (rows.length + context.length > MAX_ROWS)
    throw new ApiError('VALIDATION', '一次发来的账目太多了，请重试。');
  const skipped = { neutral: 0, closed: 0, refunded: 0, broken: 0 };
  const seen = new Set();
  const read = (list, count) => {
    const lines = [];
    const refunds = [];
    for (const raw of list) {
      const row = rowOf(raw, enc);
      const when = fileTime(row.time);
      const amount = fileAmount(row.amount);
      const zero = /^0+(\.0+)?$/.test(row.amount);
      if (!when || !row.tx || (!amount && !zero)) {
        if (count) count.broken++;
        continue;
      }
      if (seen.has(row.tx)) continue;
      seen.add(row.tx);
      if (row.cls === '退款' && amount && !FAILED.test(row.status)) {
        refunds.push({ ...row, ...when, amount });
        if (count) count.neutral++;
        continue;
      }
      if ((row.io !== '支出' && row.io !== '收入') || !amount) {
        if (count) count.neutral++;
        continue;
      }
      if (FAILED.test(row.status)) {
        if (count) count.closed++;
        continue;
      }
      lines.push({
        ...row,
        ...when,
        amount,
        flow: row.io === '收入' ? 'in' : 'out',
      });
    }
    return { lines, refunds };
  };
  const own = read(rows, skipped);
  if (skipped.broken === rows.length)
    throw new ApiError('VALIDATION', BAD_FILE);
  const around = read(context, null);
  const refundedOf = absorbRefunds(
    [...own.lines, ...around.lines],
    [...own.refunds, ...around.refunds],
  );
  const items = [];
  for (const line of own.lines) {
    const refunded = refundedOf.get(line) || 0;
    const amount = line.amount - refunded;
    if (amount <= 0) {
      skipped.refunded++;
      continue;
    }
    const kind = kindOf(line, line.flow);
    const transfer = kind === '转账' || kind === '红包';
    const name = labelOf(line, transfer);
    const key = refKey('alipay', line.tx);
    items.push({
      amount,
      flow: line.flow,
      date: line.date,
      dateGuessed: false,
      time: line.time,
      kind,
      merchant: name,
      note: fileNote(kind === '消费' ? '' : kind, name, refunded),
      cat:
        kind === '消费'
          ? CATEGORY_OF[line.cls] || guessCategory(`${name}${line.goods}`)
          : '其他',
      src: {
        app: 'alipay',
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

module.exports = { parseAlipayRows };
