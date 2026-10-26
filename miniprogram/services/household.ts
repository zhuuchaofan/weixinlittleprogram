import type { Household } from '../models';
import { callApi } from './cloud';

// undefined = 还没读取过；null = 已确认未加入小家。
let cached: Household | null | undefined;
let cachedAt = 0;

// 对方改名、加入等变化最多延迟这么久出现；下拉刷新会立即重新读取。
const MAX_AGE_MS = 60 * 1000;

function remember(household: Household | null): Household | null {
  cached = household;
  cachedAt = Date.now();
  return household;
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
  splitting?: boolean;
}): Promise<Household> {
  return remember(
    await callApi<Household>('household.update', fields),
  ) as Household;
}

/** tab 页进入时调用：未加入小家则跳到创建 / 加入页。 */
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
