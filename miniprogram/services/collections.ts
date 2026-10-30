import type {
  Anniversary,
  AnniversaryInput,
  Dish,
  DishInput,
  DishRating,
  DishVote,
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

export const dishService = {
  ...createCollectionService<Dish, DishInput>('dish'),
  /** 今天想吃 / 不想吃；vote 为空表示收回自己的那一票。 */
  vote(id: string, vote: DishVote | ''): Promise<Dish> {
    return callApi<Dish>('dish.vote', { id, vote });
  },
  /** 吃过之后的评价；rating 为空表示收回。 */
  rate(id: string, rating: DishRating | ''): Promise<Dish> {
    return callApi<Dish>('dish.rate', { id, rating });
  },
};
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
