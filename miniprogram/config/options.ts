import type { DishTag, Payer, Split, TodoKind, TodoWho } from '../models';
import { CONTRACT } from './contract';

// 取值来自 shared/contract.json（npm run contract 生成 contract.ts）。
// 下面的类型标注保证契约里新增的取值必须先加进 models.ts，否则编译失败。
export const CATEGORIES: string[] = [...CONTRACT.categories];
export const SETTLEMENT: string = CONTRACT.settlement;
export const LENGTHS = CONTRACT.lengths;
export const RATIO_RANGE = CONTRACT.ratio;

const SPLIT_TEXT: Record<Split, { label: string; hint: string }> = {
  half: { label: '两人平摊', hint: '对方承担一半' },
  other: { label: '全算对方', hint: '替对方付的，对方承担全部' },
  self: { label: '自己的', hint: '不分摊，不计入共同支出' },
  ratio: { label: '按比例', hint: '自己定付款人承担几成，例如 6:4' },
};
export const SPLITS: Array<{ value: Split; label: string; hint: string }> =
  CONTRACT.splits.map((value: Split) => ({ value, ...SPLIT_TEXT[value] }));

const TODO_KIND_LABELS: Record<TodoKind, string> = {
  shop: '购物',
  todo: '待办',
  chore: '家务',
};
export const TODO_KINDS: Array<{ value: TodoKind; label: string }> =
  CONTRACT.todoKinds.map((value: TodoKind) => ({
    value,
    label: TODO_KIND_LABELS[value],
  }));

export const DISH_TAGS: DishTag[] = [...CONTRACT.dishTags];
// 只用于编译期核对契约取值与 models.ts 一致。
export const PAYERS: Payer[] = [...CONTRACT.payers];
export const TODO_WHO: TodoWho[] = [...CONTRACT.todoWho];
