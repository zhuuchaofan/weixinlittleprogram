import type {
  Anniversary,
  AnniversaryInput,
  Dish,
  DishInput,
  Todo,
  TodoInput,
  TodoKind,
  Wish,
  WishInput,
} from '../models';
import { callApi } from './cloud';
import { createCollectionService } from './collection';

export const dishService = createCollectionService<Dish, DishInput>('dish');
export const wishService = createCollectionService<Wish, WishInput>('wish');
export const dateService = createCollectionService<
  Anniversary,
  AnniversaryInput
>('date');

/** 清单：通用的 list/get/add/update/remove，另加按类清除已完成。 */
export const todoService = {
  ...createCollectionService<Todo, TodoInput>('todo'),
  async clearDone(kind: TodoKind): Promise<number> {
    const result = await callApi<{ removed: number }>('todo.clearDone', {
      kind,
    });
    return result.removed;
  },
};
