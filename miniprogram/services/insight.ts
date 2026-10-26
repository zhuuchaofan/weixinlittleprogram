import type { MonthInsight } from '../models';
import { callApi } from './cloud';

export function getInsight(month: string): Promise<MonthInsight> {
  return callApi<MonthInsight>('insight.get', { month });
}
