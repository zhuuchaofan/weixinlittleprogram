import type {
  BillApp,
  DishKind,
  Flow,
  DishTag,
  Payer,
  Split,
  TodoKind,
  TodoWho,
} from '../models';
import { CONTRACT } from './contract';

// 取值来自 shared/contract.json（npm run contract 生成 contract.ts）。
// 下面的类型标注保证契约里新增的取值必须先加进 models.ts，否则编译失败。
export const CATEGORIES: string[] = [...CONTRACT.categories];
export const SETTLEMENT: string = CONTRACT.settlement;
export const LENGTHS = CONTRACT.lengths;
export const RATIO_RANGE = CONTRACT.ratio;
export const BILL_IMPORT = CONTRACT.billImport;
export const PHOTO_LIMITS = CONTRACT.photos;

/** 每个分类的图标（images/cat-icons/*.svg）和颜色；契约里新增分类没配时用「其他」。 */
const CATEGORY_LOOKS: Record<string, { icon: string; color: string }> = {
  吃饭: { icon: 'food', color: '#ff8a3d' },
  日用: { icon: 'daily', color: '#22b573' },
  房租: { icon: 'rent', color: '#3b82f6' },
  水电网: { icon: 'utility', color: '#0ea5c6' },
  交通: { icon: 'transit', color: '#9b5cf6' },
  娱乐: { icon: 'fun', color: '#f2487a' },
  旅行: { icon: 'travel', color: '#e8a317' },
  猫咪: { icon: 'pet', color: '#c47f4f' },
  其他: { icon: 'other', color: '#94a0b4' },
  [CONTRACT.settlement]: { icon: 'settle', color: '#24a466' },
};
export function categoryLook(cat: string): {
  icon: string;
  color: string;
  tint: string;
} {
  const look = CATEGORY_LOOKS[cat] || CATEGORY_LOOKS['其他'];
  const hex = look.color.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return {
    icon: `/images/cat-icons/${look.icon}.svg`,
    color: look.color,
    tint: `rgba(${r}, ${g}, ${b}, 0.12)`,
  };
}

const FLOW_LABELS: Record<Flow, string> = { out: '支出', in: '收入' };
export const FLOWS: Array<{ value: Flow; label: string }> = CONTRACT.flows.map(
  (value: Flow) => ({ value, label: FLOW_LABELS[value] }),
);
const BILL_APP_LABELS: Record<BillApp, string> = {
  wechat: '微信',
  alipay: '支付宝',
};
export function billAppLabel(app: BillApp): string {
  return BILL_APP_LABELS[app] || '';
}

const SPLIT_TEXT: Record<Split, { label: string; hint: string }> = {
  half: { label: '两人平摊', hint: '对方承担一半' },
  other: { label: '全算对方', hint: '替对方付的，对方承担全部' },
  self: { label: '自己的', hint: '不分摊，不计入共同支出' },
  ratio: { label: '按比例', hint: '自己定付款人承担几成，例如 6:4' },
};
export const SPLITS: Array<{ value: Split; label: string; hint: string }> =
  CONTRACT.splits.map((value: Split) => ({ value, ...SPLIT_TEXT[value] }));

/** 界面上只分购物和待办；旧的「家务」条目归到待办里显示。 */
export const TODO_KINDS: Array<{ value: TodoKind; label: string }> = [
  { value: 'shop', label: '购物' },
  { value: 'todo', label: '待办' },
];
export function todoTab(kind: TodoKind): TodoKind {
  return kind === 'chore' ? 'todo' : kind;
}

export const DISH_TAGS: DishTag[] = [...CONTRACT.dishTags];

/** 吃啥只问「怎么吃」；契约里的「外食」在界面上叫「出去吃」。 */
const DISH_TAG_LABELS: Record<DishTag, string> = {
  在家做: '在家做',
  外食: '出去吃',
  外卖: '外卖',
};
export const DISH_TAG_OPTIONS: Array<{ value: DishTag; label: string }> =
  DISH_TAGS.map((value) => ({ value, label: DISH_TAG_LABELS[value] }));
export function dishTagLabel(tag: DishTag): string {
  return DISH_TAG_LABELS[tag] || tag;
}

// 只用于编译期核对契约取值与 models.ts 一致。
export const PAYERS: Payer[] = [...CONTRACT.payers];
export const TODO_WHO: TodoWho[] = [...CONTRACT.todoWho];
export const TODO_KIND_VALUES: TodoKind[] = [...CONTRACT.todoKinds];
export const DISH_KINDS: DishKind[] = [...CONTRACT.dishKinds];
