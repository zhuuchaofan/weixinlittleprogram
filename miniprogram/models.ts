export type MemberRole = 'a' | 'b';

export interface HouseholdMember {
  role: MemberRole;
  name: string;
  isMe: boolean;
  /** 我在微信 / 支付宝里显示的名字；只有自己的会带回来。 */
  payName?: string;
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
  /** 分类预算：{ 分类: 每月上限（分） }，没设的分类不在里面。 */
  budgets: Record<string, number>;
  /** 退出小家时带走的旧账还没复制完（接着在「退出小家」页复制）。 */
  copying: boolean;
  /** 会员属于整个小家，两人共用；until 是到期时间戳（没开通过为 0）。 */
  vip: { active: boolean; until: number };
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

/** 记一笔 / 改一笔后这一类本月的预算用量；before 是保存前的用量。 */
export interface BudgetUse {
  cat: string;
  limit: number;
  used: number;
  before: number;
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
  /** 只在记一笔 / 改一笔的返回里有，且这一类设了预算。 */
  budget?: BudgetUse;
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
  /** 账单文件导入才有：交易单号的指纹。 */
  ref?: string;
}

/** 账单文件里没进确认列表的笔数：中性交易、没付成、退款抵掉的、读不全的。 */
export interface FileSkipped {
  neutral: number;
  closed: number;
  refunded: number;
  broken: number;
}

export type BillStatus = 'imported' | 'possible' | 'partner' | 'new';

/** 截图识别或账单文件读出的一笔，确认页可以改 amount、note、cat、date、flow。 */
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
  done?: boolean;
}

export interface Todo extends TodoInput {
  id: string;
  ts: number;
  done: boolean;
  /** 勾完那天，YYYY-MM-DD；没勾为空（旧记录没有）。 */
  doneOn?: string;
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

/** 花销分析（insight.get）：口径同 LedgerSummary.spending。 */
export interface MonthInsight {
  month: string;
  prevMonth: string;
  total: number;
  prevTotal: number;
  count: number;
  income: number;
  /** 本月和上月按分类，本月金额从大到小。 */
  byCategory: Array<{
    cat: string;
    amount: number;
    count: number;
    /** 上个月这一类（预算页用）。 */
    prev: number;
    /** 对比月这一类，见 compare。 */
    ref: number;
  }>;
  /**
   * 拿哪个月比：上个月有账就是上个月，上个月空着就是最近有账的月份；从没记过为 null。
   * days < fullDays：那个月是中途开始记的，只记了 days 天。
   */
  compare: InsightCompare | null;
  /** 大额单笔：本月前 3 笔，再加上 ¥500 及以上的，最多 5 笔。 */
  big: Array<{
    id: string;
    date: string;
    cat: string;
    note: string;
    amount: number;
  }>;
  /** 截至本月的近 6 个月，从早到晚。 */
  trend: Array<{ month: string; total: number }>;
  /** AI 月度小结，还没生成时为 null。 */
  summary: InsightSummary | null;
}

export interface InsightCompare {
  month: string;
  total: number;
  days: number;
  fullDays: number;
}

/** stale：生成之后这个月的账有变动，可以重新生成。 */
export interface InsightSummary {
  text: string;
  ts: number;
  stale: boolean;
}

/** 攒钱目标：金额单位为分；deadline 是最后一个月（YYYY-MM）。 */
export interface GoalInput {
  title: string;
  target: number;
  deadline: string;
  /** 已存的；新建时可填已经攒下的，编辑时可以改正。 */
  saved: number;
}

export interface GoalDeposit {
  amount: number;
  date: string;
  role: MemberRole | '';
  ts: number;
}

export interface Goal extends GoalInput, RecordMeta {
  /** 最近 10 笔「存了一笔」，最近的在前。 */
  log: GoalDeposit[];
  done: boolean;
  percent: number;
  remaining: number;
  /** 从本月到截止月（含）还有几个月；已过截止月为 0。 */
  monthsLeft: number;
  perMonth: number;
  thisMonth: number;
  /** 本月还差多少才够「每月要存」。 */
  behind: number;
}

/** 前 3 个整月某类的月均支出，少花 10% / 20% 每月能省多少。 */
export interface SavingTip {
  cat: string;
  average: number;
  save10: number;
  save20: number;
}
