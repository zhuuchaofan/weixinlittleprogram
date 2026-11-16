import type { Expense, Household } from '../models';
import { daysBetween, todayKey } from './date';

/** 主页上几句会变的提示：限时免费快结束、晚上还没记账、第一次来的引导卡片。点过「知道了」记在本机。 */

/** 限时免费快结束时主页顶部的提示。key 用来记「已经点过知道了」。 */
export interface FreeHint {
  key: string;
  text: string;
  sub: string;
}

// 晚上这个点之后，今天自己还一笔没记，就在输入框下面轻轻提一句。
const EVENING_HOUR = 18;

export function quickHintOf(records: Expense[], myRole: string): string {
  const today = todayKey();
  const mine = records.some(
    (record) =>
      record.byRole === myRole &&
      (record.date === today || todayKey(record.ts) === today),
  );
  if (mine) return '今天记过啦，还有的话接着说';
  return new Date().getHours() >= EVENING_HOUR
    ? '今天的账还没记，说一句就好'
    : '可以一句说好几笔';
}

const START_KEY = 'startDismissed';

export function startDismissed(): boolean {
  try {
    return Boolean(wx.getStorageSync(START_KEY));
  } catch {
    return false;
  }
}

const FREE_HINT_KEY = 'freeHintSeen';
// 结束前这么多天开始提示；最后两天（含当天）点过「知道了」也会再提示一次。
const FREE_HINT_DAYS = 7;
const FREE_HINT_LAST = 1;

/** 限免还剩 7 天以内、又没真正开通会员时给一句提示；不用提示返回 null。 */
export function freeHintOf(household: Household): FreeHint | null {
  const { free, active } = household.vip || { free: 0, active: false };
  if (!free || active) return null;
  const end = todayKey(free);
  const left = daysBetween(todayKey(), end);
  if (left < 0 || left > FREE_HINT_DAYS) return null;
  const key = `${end}:${left <= FREE_HINT_LAST ? 'last' : 'week'}`;
  try {
    if (wx.getStorageSync(FREE_HINT_KEY) === key) return null;
  } catch {
    // 读不到就照常提示。
  }
  const day = `${Number(end.slice(5, 7))} 月 ${Number(end.slice(8))} 日`;
  return {
    key,
    text:
      left === 0
        ? '限时免费今天结束'
        : left === 1
          ? '限时免费明天结束'
          : `限时免费还有 ${left} 天`,
    sub: `${day}之后记账照常免费，喵喵 AI 的次数和照片张数会变少`,
  };
}

/** 限免提示点了「知道了」：这一阶段不再提示。 */
export function rememberFreeHint(key: string): void {
  try {
    wx.setStorageSync(FREE_HINT_KEY, key);
  } catch {
    // 记不住就下次再提示一次，不影响别的。
  }
}

/** 引导卡片点了「先不用」或「导入账单」：以后不再显示。 */
export function dismissStartCard(): void {
  try {
    wx.setStorageSync(START_KEY, 1);
  } catch {
    // 记不住就下次再显示一次，不影响别的。
  }
}
