/**
 * 少读云端：
 * - 快照：每类列表最近一次读到的内容存在本机，冷启动时先显示它，再到云端取最新的。
 * - 回到页面时，只有本机改过数据（任何写操作）或距上次读取超过 60 秒才重新读；下拉刷新总是重新读。
 *   对方的改动最多晚 60 秒出现。
 */
const MAX_AGE_MS = 60 * 1000;
const PREFIX = 'snapshot:';

let writes = 0;
const loaded = new Map<string, { writes: number; at: number }>();

/** callApi 每次成功的写操作后调用。 */
export function noteWrite(): void {
  writes++;
}

export function needsReload(key: string): boolean {
  const last = loaded.get(key);
  return !last || last.writes !== writes || Date.now() - last.at > MAX_AGE_MS;
}

export function markLoaded(key: string): void {
  loaded.set(key, { writes, at: Date.now() });
}

export function saveSnapshot(key: string, data: unknown): void {
  try {
    wx.setStorageSync(PREFIX + key, data);
  } catch {
    /* 存不下就算了，下次照常从云端读。 */
  }
}

export function readSnapshot<T>(key: string): T | undefined {
  try {
    const data = wx.getStorageSync(PREFIX + key) as T | '';
    return data === '' ? undefined : data;
  } catch {
    return undefined;
  }
}
