import type { TodoKind } from '../models';
import { callApi } from './cloud';

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
      '你写的这句话会发给第三方服务阿里云通义千问，由 AI 整理成条目。不会发送头像、昵称等个人信息，整理结果由你确认后才保存。',
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
