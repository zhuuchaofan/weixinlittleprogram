import { uiCopy } from '../config/ui-copy';
import { localConfig } from '../config/local';
let initialized = false;
export function initializeCloud(): void {
  if (!localConfig.cloudEnvId.trim()) throw new Error(uiCopy.cloud.text01);
  if (!wx.cloud) throw new Error(uiCopy.cloud.text02);
  if (!initialized) {
    wx.cloud.init({ env: localConfig.cloudEnvId, traceUser: false });
    initialized = true;
  }
}
export async function callCloud<T>(
  action: string,
  data: unknown = {},
): Promise<T> {
  initializeCloud();
  let raw: unknown;
  try {
    const response = await wx.cloud.callFunction({
      name: 'weddingApi',
      data: { action, payload: data },
    });
    raw = response.result;
  } catch {
    throw new Error(uiCopy.cloud.text03);
  }
  const result = raw as {
    ok: boolean;
    data: T;
    code?: string;
    message?: string;
  };
  if (!result || result.ok !== true)
    throw new Error(result?.message || uiCopy.cloud.text04);
  return result.data;
}
