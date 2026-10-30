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
    throw new ApiError('VALIDATION', '这条记录找不到了，下拉刷新一下再试。');
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
    '选一下是收入还是支出吧。',
  );
  if (value === 'in' && payload.split !== 'self')
    throw new ApiError('VALIDATION', '收入只能记为「自己的」。');
  return value;
}

/** 金额只接受正整数（单位：分）；收入、支出由 flow 区分。 */
function expense(payload) {
  const amount = payload?.amount;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT)
    throw new ApiError('VALIDATION', '金额要大于 0，最多写到分哦。');
  if (!isDate(payload.date))
    throw new ApiError('VALIDATION', '这个日期好像不对，重新选一下吧。');
  return {
    amount,
    note: text(payload.note, { field: '备注', max: LENGTHS.expenseNote }),
    cat: oneOf(normalizeCategory(payload.cat), CATEGORIES, '选一个分类吧。'),
    date: payload.date,
    payer: oneOf(payload.payer, CONTRACT.payers, '选一下是谁付的吧。'),
    split: oneOf(payload.split, CONTRACT.splits, '选一下怎么分吧。'),
    ratio: ratio(payload),
    flow: flow(payload),
  };
}

const TODO_KINDS = CONTRACT.todoKinds;

function todoKind(value) {
  return oneOf(value, TODO_KINDS, '选一下是待办还是购物吧。');
}

function todo(payload) {
  const kind = todoKind(payload.kind);
  const repeat =
    payload.repeat === undefined || payload.repeat === ''
      ? ''
      : oneOf(payload.repeat, CONTRACT.todoRepeat, '选一下多久重复一次吧。');
  return {
    text: text(payload?.text, {
      field: '内容',
      min: 1,
      max: LENGTHS.todoText,
    }),
    kind,
    who: oneOf(payload.who, CONTRACT.todoWho, '选一下谁来做吧。'),
    done: payload.done === true,
    // 重复只给待办用；购物每次买完再点加回去。
    repeat: kind === 'shop' ? '' : repeat,
    // 重复任务下一次要做的那天：还没到时清单里先折起来。
    dueOn: optionalDate(payload.dueOn),
  };
}

/** 可不填的日期：空字符串表示没有。 */
function optionalDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (!isDate(value)) throw new ApiError('VALIDATION', '这个日期好像不对，重新选一下吧。');
  return value;
}

const DISH_TAGS = CONTRACT.dishTags;
const DISH_KINDS = CONTRACT.dishKinds;

/**
 * 菜单里的一条：菜品（dish）或店家（shop）；没有 kind 的旧记录当作菜品。店家没有「在家做」。
 * 界面已不再区分菜品和店家，新记录都是 dish。ateOn：最近一次「就吃这个」的日期。
 */
function dish(payload) {
  const kind = oneOf(payload.kind ?? 'dish', DISH_KINDS, '选一下是菜还是店吧。');
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
      shop ? '店家要选外食或外卖哦。' : '选一下在家做、外食还是外卖吧。',
    ),
    ateOn: optionalDate(payload.ateOn),
  };
}

/** 想去的照片：云存储 fileID 的列表，最多会员的张数；是不是自己小家的、有几张额度由接口判断。 */
function photos(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > CONTRACT.photos.vip)
    throw new ApiError('VALIDATION', '照片数量不对。');
  for (const id of value)
    if (typeof id !== 'string' || !id.startsWith('cloud://') || id.length > 300)
      throw new ApiError('VALIDATION', '这张照片没传好，重新选一张吧。');
  return [...new Set(value)];
}

/** 想去的一条。界面上只有「备注」一栏（存在 plan），why 是旧数据。 */
function wish(payload) {
  const done = payload?.done === true;
  return {
    title: text(payload?.title, {
      field: '地点或活动',
      min: 1,
      max: LENGTHS.wishTitle,
    }),
    why: text(payload.why, { field: '想去的理由', max: LENGTHS.wishWhy }),
    plan: text(payload.plan, { field: '备注', max: LENGTHS.wishPlan }),
    // 去过之后留的一句话和照片。
    memo: text(payload.memo, { field: '回忆', max: LENGTHS.wishMemo }),
    photos: photos(payload.photos),
    done,
    // 去过的日期；取消「去过了」时清空。
    doneOn: done ? optionalDate(payload.doneOn) : '',
  };
}

function anniversary(payload) {
  if (!isDate(payload?.date))
    throw new ApiError('VALIDATION', '这个日期好像不对，重新选一下吧。');
  return {
    title: text(payload.title, {
      field: '名称',
      min: 1,
      max: LENGTHS.dateTitle,
    }),
    date: payload.date,
    yearly: payload.yearly === true,
    together: payload.together === true,
  };
}

function amount(value, message) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_AMOUNT)
    throw new ApiError('VALIDATION', message);
  return value;
}

/** 攒钱目标：金额单位为分；deadline 是最后一个月（YYYY-MM）；saved 是已存的，编辑时可以改正。 */
function goal(payload) {
  const saved = payload?.saved ?? 0;
  if (!Number.isInteger(saved) || saved < 0 || saved > MAX_AMOUNT)
    throw new ApiError('VALIDATION', '已存金额不对，最多两位小数。');
  return {
    title: text(payload?.title, {
      field: '目标名称',
      min: 1,
      max: LENGTHS.goalTitle,
    }),
    target: amount(payload.target, '写一下要攒多少吧，写到分就好。'),
    deadline: month(payload.deadline),
    saved,
  };
}

module.exports = {
  CATEGORIES,
  amount,
  goal,
  DISH_TAGS,
  expense,
  todo,
  todoKind,
  dish,
  wish,
  anniversary,
  photos,
  oneOf,
  text,
  month,
  id,
  isDate,
};
