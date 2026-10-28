import type { DishTag, TodoKind } from '../models';
import { callApi } from './cloud';

export interface SplitItem {
  text: string;
  kind: TodoKind;
}
export interface DishPick {
  id: string;
  name: string;
  tag: DishTag;
  reason: string;
}
export type WishBudget = 'none' | 'low' | 'mid' | 'high';
export interface DateWish {
  wish: string;
  ideas: string[];
}

// 第一次用这几个文字功能时说明内容交给谁、怎么用；同意过就记在这台手机上。
const NOTICE_KEY = 'aiTextNoticed';

/** 一句话加清单、吃啥帮我挑、纪念日点子：第一次用先说明，不同意就不发。 */
export async function agreedToAiText(): Promise<boolean> {
  try {
    if (wx.getStorageSync(NOTICE_KEY)) return true;
  } catch {
    /* 读不到就再问一次 */
  }
  const result = await wx.showModal({
    title: '喵喵帮忙说明',
    content:
      '你写的这句话、菜单里的菜名或纪念日的名称会发给第三方服务阿里云通义千问，由 AI 整理或生成文字。不会发送头像、昵称等个人信息，结果仅供参考，由你确认后才保存。',
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

/** 从菜单里挑 3 个，只返回结果，不保存。 */
export function pickDishes(
  want: string,
  tag: DishTag | '',
): Promise<{ picks: DishPick[] }> {
  return callApi('dish.pick', { want, tag });
}

/** 给一个纪念日写祝福和点子，不保存。 */
export function wishForDate(id: string, budget: WishBudget): Promise<DateWish> {
  return callApi('date.wish', { id, budget });
}
