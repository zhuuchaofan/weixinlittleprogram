import { callApi } from './cloud';
import { readSnapshot, saveSnapshot } from './snapshot';

/**
 * 云函数 `${prefix}.list/get/add/update/remove` 的通用封装。
 * 最近一次列表按 id 缓存，编辑页先取缓存，没有时再向云端取；列表另存一份本机快照。
 */
export function createCollectionService<
  T extends { id: string },
  Input extends object,
>(prefix: string) {
  const recent = new Map<string, T>();
  /** 读到一份新列表：更新按 id 的缓存和本机快照。 */
  function seed(items: T[]): T[] {
    recent.clear();
    for (const item of items) recent.set(item.id, item);
    saveSnapshot(prefix, items);
    return items;
  }
  return {
    async list(): Promise<T[]> {
      return seed(await callApi<T[]>(`${prefix}.list`));
    },
    /** 别的请求（如主页汇总）顺带读到的列表，当作刚读过。 */
    seed,
    /** 上次读到的列表（存在本机），没有时返回 undefined。 */
    peek(): T[] | undefined {
      return readSnapshot<T[]>(prefix);
    },
    async get(id: string): Promise<T> {
      const hit = recent.get(id);
      if (hit) return hit;
      const item = await callApi<T>(`${prefix}.get`, { id });
      recent.set(item.id, item);
      return item;
    },
    add(input: Input): Promise<T> {
      return callApi<T>(`${prefix}.add`, { ...input } as Record<
        string,
        unknown
      >);
    },
    update(id: string, fields: Partial<Input>): Promise<T> {
      return callApi<T>(`${prefix}.update`, { id, ...fields });
    },
    async remove(id: string): Promise<void> {
      await callApi<null>(`${prefix}.remove`, { id });
      recent.delete(id);
    },
  };
}
