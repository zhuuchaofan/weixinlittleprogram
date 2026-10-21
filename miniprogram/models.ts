export type MemberRole = 'a' | 'b';

export interface HouseholdMember {
  role: MemberRole;
  name: string;
  isMe: boolean;
}

export interface Household {
  id: string;
  city: string;
  currency: string;
  /** 只有 1 人时有值；满 2 人后为空字符串。 */
  inviteCode: string;
  myRole: MemberRole;
  /** 有答谢宴归档权限时为 'wedding-2026'，否则为空字符串。 */
  archive: string;
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
export type Split = 'half' | 'self' | 'other';

export interface ExpenseInput {
  amount: number;
  note: string;
  cat: string;
  date: string;
  payer: Payer;
  split: Split;
}

export interface Expense extends ExpenseInput {
  id: string;
  ts: number;
  byRole: MemberRole | '';
}

export interface LedgerSummary {
  sharedTotal: number;
  paid: { a: number; b: number };
  /** 共同支出按分类汇总（不含结算和「自己的」），金额从大到小。 */
  byCategory: Array<{ cat: string; amount: number }>;
  net: number;
  settled: boolean;
  suggestion: { from: Payer; to: Payer; amount: number } | null;
}

export interface LedgerMonth {
  month: string;
  records: Expense[];
  summary: LedgerSummary;
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

export interface DishInput {
  name: string;
  tag: DishTag;
}

export interface WishInput {
  title: string;
  why: string;
  plan: string;
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

export type AiScene = 'food' | 'weekend';

export interface AiFoodItem {
  name: string;
  tag: DishTag;
  why: string;
}

export interface AiWeekendItem {
  title: string;
  why: string;
  plan: string;
  cost: string;
}
