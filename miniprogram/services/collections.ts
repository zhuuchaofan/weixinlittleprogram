import type {
  Anniversary,
  AnniversaryInput,
  Dish,
  DishInput,
  Wish,
  WishInput,
} from '../models';
import { createCollectionService } from './collection';

export const dishService = createCollectionService<Dish, DishInput>('dish');
export const wishService = createCollectionService<Wish, WishInput>('wish');
export const dateService = createCollectionService<
  Anniversary,
  AnniversaryInput
>('date');
