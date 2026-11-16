import type { ActivityItem, Expense, Household, Reaction } from '../models';
import { REACTION_PHRASES } from '../config/options';
import { DAY_MS, daysBetween, todayKey } from './date';
import { formatYuan } from './money';

/**
 * 主页「TA 最近」和顶部小气泡（TA 回应了我）：对方做的事（activity）和这几天记的账混在一起排。
 * 「已经看过」的气泡记在本机。
 */

export function partnerName(household: Household): string {
  return (
    household.members.find((member) => member.role !== household.myRole)
      ?.name || 'TA'
  );
}

const DONE_TEXT = { todo: '完成了', dish: '吃了', wish: '去过了' };

/** 主页顶部的小气泡：TA 回应了我做的事。key 用来记「已经看过」。 */
export interface Nudge {
  key: string;
  text: string;
  sub: string;
}

const SEEN_KEY = 'seenNudges';
// 只记最近这么多条，够覆盖两周的动态。
const SEEN_KEPT = 60;

function seenNudges(): string[] {
  try {
    const value = wx.getStorageSync(SEEN_KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function rememberSeen(keys: string[]): void {
  try {
    const all = [...new Set([...keys, ...seenNudges()])].slice(0, SEEN_KEPT);
    wx.setStorageSync(SEEN_KEY, all);
  } catch {
    // 记不住就下次再显示一次，不影响别的。
  }
}

/** 「TA 最近」和小气泡里只看这几天记的账；导入的账单一次几十笔，不算。 */
const FEED_EXPENSE_DAYS = 3;

function feedExpenses(records: Expense[]): Expense[] {
  const since = Date.now() - FEED_EXPENSE_DAYS * DAY_MS;
  return records.filter(
    (record) => record.byRole && !record.src && record.ts >= since,
  );
}

/** 一笔账在动态里的叫法：有备注用备注，没有用分类。 */
function expenseTitle(record: Expense): string {
  return record.note || record.cat;
}

/** TA 回应了我做的事或我记的账、我还没看过的，最近的在前。 */
export function nudgesOf(
  items: ActivityItem[],
  records: Expense[],
  myRole: string,
  partner: string,
): Nudge[] {
  const seen = new Set(seenNudges());
  const other = myRole === 'a' ? 'b' : 'a';
  const found: Array<Nudge & { ts: number }> = [];
  for (const item of items) {
    if (item.byRole && item.byRole !== myRole) continue;
    const theirs = item.reactions[other];
    if (!theirs) continue;
    found.push({
      ts: item.ts,
      key: `${item.id}:${theirs}`,
      text: `${partner}${REACTION_PHRASES[theirs]}`,
      sub: `因为你${DONE_TEXT[item.type]}「${item.title}」`,
    });
  }
  for (const record of feedExpenses(records)) {
    if (record.byRole !== myRole) continue;
    const theirs = record.reactions?.[other];
    if (!theirs) continue;
    found.push({
      ts: record.ts,
      key: `${record.id}:${theirs}`,
      text: `${partner}${REACTION_PHRASES[theirs]}`,
      sub: `因为你记了「${expenseTitle(record)}」`,
    });
  }
  return found
    .filter((item) => !seen.has(item.key))
    .sort((a, b) => b.ts - a.ts)
    .map(({ key, text, sub }) => ({ key, text, sub }));
}

/** 主页「TA 最近」里的一行。 */
export interface FeedRow {
  id: string;
  /** 做过的事（activity）还是一笔账（expense），回应时走不同的接口。 */
  kind: 'activity' | 'expense';
  /** 一句话：TA 做了什么。 */
  text: string;
  when: string;
  /** 对方做的事才能点回应。 */
  canReact: boolean;
  mine: Reaction | '';
}

function whenText(date: string): string {
  const days = daysBetween(date, todayKey());
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}

const FEED_SHOWN = 4;

/** 「TA 最近」：对方做的事和对方这几天记的账，混在一起按时间排，都可以回应。 */
export function feedRows(
  items: ActivityItem[],
  records: Expense[],
  myRole: string,
  partner: string,
): FeedRow[] {
  const rows: Array<FeedRow & { ts: number }> = [];
  for (const item of items) {
    if (!item.byRole || item.byRole === myRole) continue;
    rows.push({
      ts: item.ts,
      id: item.id,
      kind: 'activity',
      text: `${partner}${DONE_TEXT[item.type]}「${item.title}」`,
      when: whenText(item.date),
      canReact: true,
      mine: item.reactions[myRole as 'a' | 'b'] || '',
    });
  }
  for (const record of feedExpenses(records)) {
    if (record.byRole === myRole) continue;
    rows.push({
      ts: record.ts,
      id: record.id,
      kind: 'expense',
      text: `${partner}记了「${expenseTitle(record)}」${record.flow === 'in' ? '收入 ' : ''}${formatYuan(record.amount)}`,
      when: whenText(record.date),
      canReact: true,
      mine: record.reactions?.[myRole as 'a' | 'b'] || '',
    });
  }
  return rows
    .sort((a, b) => b.ts - a.ts)
    .slice(0, FEED_SHOWN)
    .map((row): FeedRow => {
      const { id, kind, text, when, canReact, mine } = row;
      return { id, kind, text, when, canReact, mine };
    });
}
