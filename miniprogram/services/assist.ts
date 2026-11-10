import type { Flow, TodoKind } from '../models';
import { callApi } from './cloud';

/** 一句话记账拆出来的一笔：金额单位为分；dateGuessed 表示说了日期却没读懂，按今天记，要核对。 */
export interface QuickItem {
  amount: number;
  flow: Flow;
  cat: string;
  note: string;
  date: string;
  dateGuessed: boolean;
}
export interface SplitItem {
  text: string;
  kind: TodoKind;
}

// 第一次用这几个文字功能时说明内容交给谁、怎么用；同意过就记在这台手机上。
const NOTICE_KEY = 'aiTextNoticed';

/** 一句话类功能：第一次用先说明，不同意就不发。 */
export async function agreedToAiText(): Promise<boolean> {
  try {
    if (wx.getStorageSync(NOTICE_KEY)) return true;
  } catch {
    /* 读不到就再问一次 */
  }
  const result = await wx.showModal({
    title: '喵喵帮忙说明',
    content:
      '你写的这句话会发给第三方服务阿里云通义千问，由 AI 整理成清单条目或账目。不会发送头像、昵称等个人信息，整理结果由你确认后才保存。',
    confirmText: '知道了',
    cancelText: '不用了',
  });
  if (!result.confirm) return false;
  try {
    wx.setStorageSync(NOTICE_KEY, 1);
  } catch {
    /* 存不下次再问 */
  }
  return true;
}

/** 一句话拆成清单条目，只返回结果，不保存。 */
export function splitTodos(text: string): Promise<{ items: SplitItem[] }> {
  return callApi('todo.split', { text });
}

/** 一句话拆成几笔账，只返回结果，不保存。 */
export function quickExpenses(text: string): Promise<{ items: QuickItem[] }> {
  return callApi('expense.quick', { text });
}

/** 一句话记账确认后一起保存，都记在自己名下。 */
export function addSomeExpenses(
  items: Array<Omit<QuickItem, 'dateGuessed'>>,
): Promise<{ added: number }> {
  return callApi('expense.addSome', { items });
}
