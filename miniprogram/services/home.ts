import type {
  ActivityItem,
  Anniversary,
  FootprintPage,
  Goal,
  LedgerMonth,
  Todo,
} from '../models';
import { ApiError, callApi } from './cloud';
import {
  activityService,
  dateService,
  footprintService,
  goalService,
  todoService,
} from './collections';
import { listMonth, seedMonth } from './ledger';

/** 主页一次要用的全部数据。goals、recent、footprints 读不到时为 null，主页其余部分照常显示。 */
export interface HomeBundle {
  month: LedgerMonth;
  todos: Todo[];
  dates: Anniversary[];
  goals: Goal[] | null;
  recent: ActivityItem[] | null;
  footprints: FootprintPage | null;
}

/** 云端还没有 home.get 时（api 没重新部署）用的老办法：分开读。 */
async function loadSeparately(month: string): Promise<HomeBundle> {
  const [ledger, todos, dates, goals, recent, footprints] = await Promise.all([
    listMonth(month),
    todoService.list(),
    dateService.list(),
    goalService.list().catch(() => null),
    activityService.recent().catch(() => null),
    footprintService.list().catch(() => null),
  ]);
  return { month: ledger, todos, dates, goals, recent, footprints };
}

/** 主页的数据：一次云函数调用读完，读到的各份再按原来的方式记下（缓存和本机快照）。 */
export async function loadHome(month: string): Promise<HomeBundle> {
  let bundle: HomeBundle;
  try {
    bundle = await callApi<HomeBundle>('home.get', { month });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND')
      return loadSeparately(month);
    throw error;
  }
  seedMonth(month, bundle.month);
  todoService.seed(bundle.todos);
  dateService.seed(bundle.dates);
  if (bundle.goals) goalService.seed(bundle.goals);
  return bundle;
}
