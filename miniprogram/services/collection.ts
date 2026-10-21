import { callApi } from './cloud';

/**
 * 云函数 `${prefix}.list/get/add/update/remove` 的通用封装。
 * 最近一次列表按 id 缓存，编辑页先取缓存，没有时再向云端取。
 */
export function createCollectionService<
  T extends { id: string },
  Input extends object,
>(prefix: string) {
  const recent = new Map<string, T>();
  return {
    async list(): Promise<T[]> {
      const items = await callApi<T[]>(`${prefix}.list`);
      recent.clear();
      for (const item of items) recent.set(item.id, item);
      return items;
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
