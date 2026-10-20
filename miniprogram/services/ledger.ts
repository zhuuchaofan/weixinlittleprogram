import type { Expense, ExpenseInput, LedgerMonth } from '../models';
import { callApi } from './cloud';

// 最近一次读取的记录，编辑页按 id 取用，避免再请求一次。
const recent = new Map<string, Expense>();

function remember(month: LedgerMonth): LedgerMonth {
  for (const record of month.records) recent.set(record.id, record);
  return month;
}

export async function listMonth(month: string): Promise<LedgerMonth> {
  return remember(await callApi<LedgerMonth>('expense.list', { month }));
}

export function cachedExpense(id: string): Expense | undefined {
  return recent.get(id);
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
