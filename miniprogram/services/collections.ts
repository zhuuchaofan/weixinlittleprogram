import type {
  Anniversary,
  AnniversaryInput,
  Dish,
  FootprintPage,
  DishInput,
  Goal,
  GoalInput,
  SavingTip,
  Todo,
  TodoInput,
  TodoKind,
  Wish,
  WishInput,
} from '../models';
import { callApi } from './cloud';
import { createCollectionService } from './collection';

export const dishService = createCollectionService<Dish, DishInput>('dish');
export const wishService = {
  ...createCollectionService<Wish, WishInput>('wish'),
  /** 「我也想去」：只改自己那一个。 */
  want(id: string, want: boolean): Promise<Wish> {
    return callApi<Wish>('wish.want', { id, want });
  },
};
export const footprintService = {
  list(year?: string): Promise<FootprintPage> {
    return callApi<FootprintPage>('footprint.list', year ? { year } : {});
  },
};
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

/** 攒钱目标：通用的增删改查，另加「存了一笔」和省钱建议。 */
export const goalService = {
  ...createCollectionService<Goal, GoalInput>('goal'),
  deposit(id: string, amount: number): Promise<Goal> {
    return callApi<Goal>('goal.deposit', { id, amount });
  },
  tips(): Promise<SavingTip[]> {
    return callApi<SavingTip[]>('goal.tips');
  },
};
