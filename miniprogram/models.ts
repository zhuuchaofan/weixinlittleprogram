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
