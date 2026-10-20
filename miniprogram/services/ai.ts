import type { AiScene } from '../models';
import { initializeCloud } from './cloud';

interface AiResult<T> {
  disabled: boolean;
  items: T[];
}

async function invoke<T>(data: Record<string, unknown>): Promise<AiResult<T>> {
  initializeCloud();
  const response = await wx.cloud.callFunction({ name: 'ai-suggest', data });
  const result = response.result as AiResult<T> | undefined;
  if (!result || typeof result.disabled !== 'boolean')
    return { disabled: true, items: [] };
  return {
    disabled: result.disabled,
    items: Array.isArray(result.items) ? result.items : [],
  };
}

/** 只询问是否可用；任何失败都视为不可用，页面照常使用。 */
export async function aiAvailable(scene: AiScene): Promise<boolean> {
  try {
    return !(await invoke({ scene, context: {}, probe: true })).disabled;
  } catch {
    return false;
  }
}

export function aiSuggest<T>(
  scene: AiScene,
  context: Record<string, unknown>,
): Promise<AiResult<T>> {
  return invoke<T>({ scene, context });
}
