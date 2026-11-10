import type { MonthRecap } from '../models';
import { callApi } from './cloud';

export function getRecap(month: string): Promise<MonthRecap> {
  return callApi<MonthRecap>('recap.get', { month });
}
