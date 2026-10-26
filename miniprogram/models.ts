export type MemberRole = 'a' | 'b';

export interface HouseholdMember {
  role: MemberRole;
  name: string;
  isMe: boolean;
}

export interface Household {
  id: string;
  currency: string;
  /** 只有 1 人时有值；满 2 人后为空字符串。 */
  inviteCode: string;
  myRole: MemberRole;
  /** 有答谢宴归档权限时为 'wedding-2026'，否则为空字符串。 */
  archive: string;
  /** 两人分摊与结算；默认关闭，只记账。 */
  splitting: boolean;
  members: HouseholdMember[];
}

export interface ArchiveRsvp {
  guestName: string;
  attending: boolean;
  partySize: number;
  note: string;
  updatedAt: string;
}

export interface ArchiveMessage {
  signature: string;
  message: string;
  updatedAt: string;
}

export interface Archive {
  rsvps: ArchiveRsvp[];
  messages: ArchiveMessage[];
  summary: {
    responses: number;
    attending: number;
    declined: number;
    guests: number;
  };
}

export type Payer = 'a' | 'b';
export type Split = 'half' | 'self' | 'other' | 'ratio';
/** 支出 out、收入 in；收入只能是「自己的」。 */
export type Flow = 'out' | 'in';
export type BillApp = 'wechat' | 'alipay';

export interface ExpenseInput {
  amount: number;
  note: string;
  cat: string;
  date: string;
  payer: Payer;
  split: Split;
  /** 付款人承担的百分比（整数 0–100），只在 split 为 ratio 时有。 */
  ratio?: number;
  flow: Flow;
}

export interface Expense extends ExpenseInput {
  id: string;
  ts: number;
  /** 截图导入的账目才有：来自哪个 App、原始商户名。 */
  src?: { app: BillApp; merchant: string; time: string; key: string };
  byRole: MemberRole | '';
  /** 被修改过才有：最后一次修改的时间和人。 */
  editedAt?: number;
  editedByRole?: MemberRole | '';
}

export interface LedgerSummary {
  sharedTotal: number;
  paid: { a: number; b: number };
  /** 共同支出按分类汇总（不含结算和「自己的」），金额从大到小。 */
  byCategory: Array<{ cat: string; amount: number }>;
  /** 所有支出（不含结算和收入），不开两人分摊时用。 */
  spending: {
    total: number;
    paid: { a: number; b: number };
    byCategory: Array<{ cat: string; amount: number }>;
  };
  net: number;
  settled: boolean;
  suggestion: { from: Payer; to: Payer; amount: number } | null;
}

export interface LedgerMonth {
  month: string;
  records: Expense[];
  summary: LedgerSummary;
}

/** 截图上原始的一笔，查重和防止重复导入都靠它，确认页不改。 */
export interface BillSource {
  app: BillApp;
  merchant: string;
  time: string;
  date: string;
  amount: number;
  flow: Flow;
}

export type BillStatus = 'imported' | 'possible' | 'partner' | 'new';

/** 截图识别出的一笔，确认页可以改 amount、note、cat、date、flow。 */
export interface BillItem {
  amount: number;
  flow: Flow;
  date: string;
  /** 日期由「今天 / 昨天 / 周三」推算，要核对。 */
  dateGuessed: boolean;
  time: string;
  kind: string;
  merchant: string;
  note: string;
  cat: string;
  src: BillSource;
  key: string;
  /** 读不全时的说明，例如「金额没读出来」。 */
  problem: string;
  /** bill.match 之后才有。 */
  status?: BillStatus;
  match?: {
    id: string;
    date: string;
    note: string;
    amount: number;
    byRole: MemberRole | '';
  } | null;
}

export type TodoKind = 'shop' | 'todo' | 'chore';
export type TodoWho = 'a' | 'b' | 'both';

export interface TodoInput {
  text: string;
  kind: TodoKind;
  who: TodoWho;
}

export interface Todo extends TodoInput {
  id: string;
  ts: number;
  done: boolean;
  byRole: MemberRole | '';
}

export type DishTag = '在家做' | '外食' | '外卖';
/** 菜单里的一条是菜品还是店家。 */
export type DishKind = 'dish' | 'shop';

export interface DishInput {
  name: string;
  kind: DishKind;
  tag: DishTag;
  /** 最近一次「就吃这个」，YYYY-MM-DD；没有时为空。 */
  ateOn?: string;
}

export interface WishInput {
  title: string;
  /** 旧版的「为什么想去」；现在只用 plan（界面上叫备注），编辑保存时合并进去。 */
  why: string;
  plan: string;
  done?: boolean;
  /** 去过的日期，YYYY-MM-DD；没去过为空。 */
  doneOn?: string;
}

export interface AnniversaryInput {
  title: string;
  date: string;
  yearly: boolean;
}

interface RecordMeta {
  id: string;
  ts: number;
  byRole: MemberRole | '';
}

export type Dish = DishInput & RecordMeta;
export type Wish = WishInput & RecordMeta;

export interface Anniversary extends AnniversaryInput, RecordMeta {
  /** 下一次（每年重复）或原日期（不重复），YYYY-MM-DD。 */
  nextDate: string;
  /** 未到：剩余天数；已过（不重复）：已经过去的天数。 */
  days: number;
  passed: boolean;
  /** 每年重复时，下一次是第几周年。 */
  years: number;
}
