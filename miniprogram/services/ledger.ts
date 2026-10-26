import type { Expense, ExpenseInput, LedgerMonth } from '../models';
import { callApi } from './cloud';
import { readSnapshot, saveSnapshot } from './snapshot';
import { todayKey } from '../utils/date';

// 最近一次读取的记录，编辑页按 id 取用；没有缓存时（如跨页跳转进入）再向云端取。
const recent = new Map<string, Expense>();

function remember(month: LedgerMonth): LedgerMonth {
  for (const record of month.records) recent.set(record.id, record);
  return month;
}

export async function listMonth(month: string): Promise<LedgerMonth> {
  const result = remember(
    await callApi<LedgerMonth>('expense.list', { month }),
  );
  // 只给本月存快照：打开小程序时看到的是本月。
  if (month === todayKey().slice(0, 7))
    saveSnapshot('ledger', { month, result });
  return result;
}

/** 本月上次读到的账目（存在本机），没有时返回 undefined。 */
export function peekMonth(month: string): LedgerMonth | undefined {
  const saved = readSnapshot<{ month: string; result: LedgerMonth }>('ledger');
  return saved?.month === month ? saved.result : undefined;
}

export async function getExpense(id: string): Promise<Expense> {
  const hit = recent.get(id);
  if (hit) return hit;
  const record = await callApi<Expense>('expense.get', { id });
  recent.set(record.id, record);
  return record;
}

export function addExpense(input: ExpenseInput): Promise<Expense> {
  return callApi<Expense>('expense.add', { ...input });
}

export function updateExpense(
  id: string,
  input: ExpenseInput,
): Promise<Expense> {
  return callApi<Expense>('expense.update', { id, ...input });
}

export async function removeExpense(id: string): Promise<void> {
  await callApi<null>('expense.remove', { id });
  recent.delete(id);
}

export async function settleMonth(month: string): Promise<LedgerMonth> {
  return remember(await callApi<LedgerMonth>('expense.settle', { month }));
}
