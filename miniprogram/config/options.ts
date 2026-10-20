import type { DishTag, Split, TodoKind } from '../models';

// 与云函数 cloudfunctions/api/validate.js 保持一致。
export const CATEGORIES = [
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
export const SETTLEMENT = '结算';

export const SPLITS: Array<{ value: Split; label: string; hint: string }> = [
  { value: 'half', label: '两人平摊', hint: '对方承担一半' },
  { value: 'other', label: '全算对方', hint: '替对方付的，对方承担全部' },
  { value: 'self', label: '自己的', hint: '不分摊，不计入共同支出' },
];

export const TODO_KINDS: Array<{ value: TodoKind; label: string }> = [
  { value: 'shop', label: '购物' },
  { value: 'todo', label: '待办' },
  { value: 'chore', label: '家务' },
];

export const DISH_TAGS: DishTag[] = ['在家做', '外食', '外卖'];
