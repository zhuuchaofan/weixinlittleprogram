import type { Household } from '../models';
import { callApi } from './cloud';

// undefined = 还没读取过；null = 已确认未加入小家。
let cached: Household | null | undefined;

function remember(household: Household | null): Household | null {
  cached = household;
  return household;
}

export async function getHousehold(force = false): Promise<Household | null> {
  if (!force && cached !== undefined) return cached;
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
  city?: string;
  name?: string;
}): Promise<Household> {
  return remember(
    await callApi<Household>('household.update', fields),
  ) as Household;
}

/** tab 页进入时调用：未加入小家则跳到创建 / 加入页。 */
export async function requireHousehold(): Promise<Household | null> {
  const household = await getHousehold();
  if (!household) wx.reLaunch({ url: '/pages/welcome/index' });
  return household;
}
