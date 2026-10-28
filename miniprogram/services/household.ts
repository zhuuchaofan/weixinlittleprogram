import type { Household } from '../models';
import { callApi } from './cloud';
import { clearSnapshots, readSnapshot, saveSnapshot } from './snapshot';

// undefined = 还没读取过；null = 已确认未加入小家。
let cached: Household | null | undefined;
let cachedAt = 0;

// 对方改名、加入等变化最多延迟这么久出现；下拉刷新会立即重新读取。
const MAX_AGE_MS = 60 * 1000;

function remember(household: Household | null): Household | null {
  cached = household;
  cachedAt = Date.now();
  if (household) saveSnapshot('household', household);
  return household;
}

/** 不读云端，立即返回手头的小家信息（冷启动时是上次存在本机的），用来先把页面画出来。 */
export function peekHousehold(): Household | null {
  return cached || readSnapshot<Household>('household') || null;
}

function fresh(): boolean {
  if (cached === undefined || Date.now() - cachedAt > MAX_AGE_MS) return false;
  // 还在等对方加入时，每次都重新读取，让邀请码和成员及时更新。
  return !cached || cached.members.length > 1;
}

export async function getHousehold(force = false): Promise<Household | null> {
  if (force !== true && fresh()) return cached as Household | null;
  return remember(await callApi<Household | null>('household.get'));
}

export async function createHousehold(name: string): Promise<Household> {
  return remember(
    await callApi<Household>('household.create', { name }),
  ) as Household;
}

export async function joinHousehold(
  name: string,
  code: string,
): Promise<Household> {
  return remember(
    await callApi<Household>('household.join', { name, code }),
  ) as Household;
}

export async function updateHousehold(fields: {
  name?: string;
  payName?: string;
  splitting?: boolean;
  budgets?: Record<string, number>;
}): Promise<Household> {
  return remember(
    await callApi<Household>('household.update', fields),
  ) as Household;
}

/** 换了小家：丢掉手头的小家信息和各页快照。 */
function forget(): void {
  cached = undefined;
  clearSnapshots();
}

/**
 * 退出小家。copy=false 时新小家从空开始。
 * 只剩自己时云端可能先替先走的人复制副本（waiting），这里一直调到真正退出为止，onWait 报告进度。
 */
export async function leaveHousehold(
  copy: boolean,
  onWait: () => void = () => {},
): Promise<void> {
  for (;;) {
    const result = await callApi<{ waiting?: boolean }>('household.leave', {
      copy,
    });
    if (!result.waiting) break;
    onWait();
  }
  forget();
}

/** 复制一批旧账，返回 { done, copied }；没完时接着调用。 */
export async function copyStep(): Promise<{ done: boolean; copied: number }> {
  const result = await callApi<{ done: boolean; copied: number }>(
    'household.copy',
  );
  if (result.done) forget();
  return result;
}

/** 清空前的条数：all 全部，others 不是我记的。 */
export function clearCount(): Promise<{ all: number; others: number }> {
  return callApi('household.clearCount');
}

/** 清空：others 只清对方记的，all 全部清空。返回删了多少条。 */
export async function clearRecords(
  scope: 'others' | 'all',
  onWait: () => void = () => {},
): Promise<number> {
  for (;;) {
    const result = await callApi<{ removed: number; waiting?: boolean }>(
      'household.clear',
      { scope },
    );
    if (!result.waiting) {
      forget();
      return result.removed;
    }
    onWait();
  }
}

/** 主页和各功能页进入时调用：未加入小家则跳到创建 / 加入页。 */
export async function requireHousehold(
  force = false,
): Promise<Household | null> {
  const household = await getHousehold(force);
  if (!household) wx.reLaunch({ url: '/pages/welcome/index' });
  return household;
}

/** 角色 → 显示名。 */
export function memberNames(household: Household): { a: string; b: string } {
  const name = (role: 'a' | 'b') =>
    household.members.find((member) => member.role === role)?.name || '对方';
  return { a: name('a'), b: name('b') };
}

/** 由对方记录时返回「名字 + 动作」，自己记录时返回空字符串。 */
export function byPartner(
  byRole: string,
  household: Household,
  action: string,
): string {
  if (!byRole || byRole === household.myRole) return '';
  const names = memberNames(household);
  return (byRole === 'a' ? names.a : names.b) + action;
}
