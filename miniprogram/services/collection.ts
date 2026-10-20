import { callApi } from './cloud';

/**
 * 云函数 `${prefix}.list/add/update/remove` 的通用封装。
 * 最近一次列表按 id 缓存，编辑页直接取用。
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
    cached(id: string): T | undefined {
      return recent.get(id);
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
