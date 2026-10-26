import type { InsightSummary, MonthInsight } from '../models';
import { callApi } from './cloud';

export function getInsight(month: string): Promise<MonthInsight> {
  return callApi<MonthInsight>('insight.get', { month });
}

/** 让千问写这个月的小结（只发汇总），每个小家每天有次数上限。 */
export function writeSummary(month: string): Promise<InsightSummary> {
  return callApi<InsightSummary>('insight.write', { month });
}
