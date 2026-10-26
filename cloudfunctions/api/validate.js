const { ApiError } = require('./errors');

// 分类、标签、字段长度来自 shared/contract.json（npm run contract 同步到这里）。
const CONTRACT = require('./contract.json');
const { normalizeCategory } = require('./ledger');

const { categories: CATEGORIES, lengths: LENGTHS } = CONTRACT;
// 金额以「分」为单位的整数存储，避免浮点误差；上限 1000 万元。
const MAX_AMOUNT = CONTRACT.maxAmount;

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

/** 付款人承担的百分比：整数，范围来自契约；只有按比例分摊时才有值。 */
function ratio(payload) {
  const { min, max } = CONTRACT.ratio;
  if (payload.split !== 'ratio') return null;
  if (
    !Number.isInteger(payload.ratio) ||
    payload.ratio < min ||
    payload.ratio > max
  )
    throw new ApiError(
      'VALIDATION',
      `请填写 ${min}–${max} 的整数，表示付款人承担的百分比。`,
    );
  return payload.ratio;
}

/** 收入还是支出；没有 flow 的旧记录和旧版小程序提交的都算支出。收入只能是「自己的」，不参与分摊。 */
function flow(payload) {
  const value = oneOf(
    payload.flow ?? 'out',
    CONTRACT.flows,
    '请选择收入或支出。',
  );
  if (value === 'in' && payload.split !== 'self')
    throw new ApiError('VALIDATION', '收入只能记为「自己的」。');
  return value;
}

/** 金额只接受正整数（单位：分）；收入、支出由 flow 区分。 */
function expense(payload) {
  const amount = payload?.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT)
    throw new ApiError('VALIDATION', '请填写大于 0 的金额，最多两位小数。');
  if (!isDate(payload.date))
    throw new ApiError('VALIDATION', '请选择有效的日期。');
  return {
    amount,
    note: text(payload.note, { field: '备注', max: LENGTHS.expenseNote }),
    cat: oneOf(normalizeCategory(payload.cat), CATEGORIES, '请选择分类。'),
    date: payload.date,
    payer: oneOf(payload.payer, CONTRACT.payers, '请选择付款人。'),
    split: oneOf(payload.split, CONTRACT.splits, '请选择分摊方式。'),
    ratio: ratio(payload),
    flow: flow(payload),
  };
}

const TODO_KINDS = CONTRACT.todoKinds;

function todoKind(value) {
  return oneOf(value, TODO_KINDS, '请选择清单类型。');
}

function todo(payload) {
  return {
    text: text(payload?.text, {
      field: '内容',
      min: 1,
      max: LENGTHS.todoText,
    }),
    kind: todoKind(payload.kind),
    who: oneOf(payload.who, CONTRACT.todoWho, '请选择负责人。'),
    done: payload.done === true,
  };
}

/** 可不填的日期：空字符串表示没有。 */
function optionalDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (!isDate(value)) throw new ApiError('VALIDATION', '请选择有效的日期。');
  return value;
}

const DISH_TAGS = CONTRACT.dishTags;
const DISH_KINDS = CONTRACT.dishKinds;

/**
 * 菜单里的一条：菜品（dish）或店家（shop）；没有 kind 的旧记录当作菜品。店家没有「在家做」。
 * 界面已不再区分菜品和店家，新记录都是 dish。ateOn：最近一次「就吃这个」的日期。
 */
function dish(payload) {
  const kind = oneOf(payload.kind ?? 'dish', DISH_KINDS, '请选择菜品或店家。');
  const shop = kind === 'shop';
  return {
    name: text(payload?.name, {
      field: '名称',
      min: 1,
      max: LENGTHS.dishName,
    }),
    kind,
    tag: oneOf(
      payload.tag,
      shop ? CONTRACT.shopTags : DISH_TAGS,
      shop ? '店家请选择外食或外卖。' : '请选择在家做、外食或外卖。',
    ),
    ateOn: optionalDate(payload.ateOn),
  };
}

function wish(payload) {
  return {
    title: text(payload?.title, {
      field: '地点或活动',
      min: 1,
      max: LENGTHS.wishTitle,
    }),
    why: text(payload.why, { field: '想去的理由', max: LENGTHS.wishWhy }),
    plan: text(payload.plan, { field: '计划', max: LENGTHS.wishPlan }),
  };
}

function anniversary(payload) {
  if (!isDate(payload?.date))
    throw new ApiError('VALIDATION', '请选择有效的日期。');
  return {
    title: text(payload.title, {
      field: '名称',
      min: 1,
      max: LENGTHS.dateTitle,
    }),
    date: payload.date,
    yearly: payload.yearly === true,
  };
}

module.exports = {
  CATEGORIES,
  DISH_TAGS,
  expense,
  todo,
  todoKind,
  dish,
  wish,
  anniversary,
  oneOf,
  text,
  month,
  id,
  isDate,
};
