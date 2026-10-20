const { ApiError } = require('./errors');

const CATEGORIES = [
  '食费',
  '日用',
  '房租',
  '水电网',
  '交通',
  '娱乐',
  '旅行',
  '猫咪',
  '其他',
];
const MAX_AMOUNT = 100000000;

function text(value, { field, min = 0, max }) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < min || result.length > max)
    throw new ApiError(
      'VALIDATION',
      min ? `${field}请填写 ${min}–${max} 字。` : `${field}最多 ${max} 字。`,
    );
  return result;
}

function oneOf(value, options, message) {
  if (!options.includes(value)) throw new ApiError('VALIDATION', message);
  return value;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function month(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new ApiError('VALIDATION', '月份格式应为 YYYY-MM。');
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value))
    throw new ApiError('VALIDATION', '记录编号无效，请刷新后重试。');
  return value;
}

/** 金额只接受正整数日元。 */
function expense(payload) {
  const amount = payload?.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT)
    throw new ApiError('VALIDATION', '金额请填写 1 以上的整数日元。');
  if (!isDate(payload.date))
    throw new ApiError('VALIDATION', '请选择有效的日期。');
  return {
    amount,
    note: text(payload.note, { field: '备注', max: 40 }),
    cat: oneOf(payload.cat, CATEGORIES, '请选择分类。'),
    date: payload.date,
    payer: oneOf(payload.payer, ['a', 'b'], '请选择付款人。'),
    split: oneOf(payload.split, ['half', 'self', 'other'], '请选择分摊方式。'),
  };
}

function todo(payload) {
  return {
    text: text(payload?.text, { field: '内容', min: 1, max: 60 }),
    kind: oneOf(payload.kind, ['shop', 'todo', 'chore'], '请选择清单类型。'),
    who: oneOf(payload.who, ['a', 'b', 'both'], '请选择负责人。'),
    done: payload.done === true,
  };
}

module.exports = { CATEGORIES, expense, todo, month, id, isDate };
