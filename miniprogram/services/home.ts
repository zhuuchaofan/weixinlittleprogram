import type {
  ActivityItem,
  Anniversary,
  FootprintPage,
  Goal,
  LedgerMonth,
  Todo,
} from '../models';
import { callApi } from './cloud';
import { dateService, goalService, todoService } from './collections';
import { seedMonth } from './ledger';

/** 主页一次要用的全部数据。goals、recent、footprints 读不到时为 null，主页其余部分照常显示。 */
export interface HomeBundle {
  month: LedgerMonth;
  todos: Todo[];
  dates: Anniversary[];
  goals: Goal[] | null;
  recent: ActivityItem[] | null;
  footprints: FootprintPage | null;
}

/** 主页的数据：一次云函数调用读完，读到的各份再按原来的方式记下（缓存和本机快照）。 */
export async function loadHome(month: string): Promise<HomeBundle> {
  const bundle = await callApi<HomeBundle>('home.get', { month });
  seedMonth(month, bundle.month);
  todoService.seed(bundle.todos);
  dateService.seed(bundle.dates);
  if (bundle.goals) goalService.seed(bundle.goals);
  return bundle;
}
