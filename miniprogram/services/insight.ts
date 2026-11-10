import type { InsightSummary, MonthInsight } from '../models';
import { callApi } from './cloud';

export function getInsight(month: string): Promise<MonthInsight> {
  return callApi<MonthInsight>('insight.get', { month });
}

/** 让千问写这个月的喵喵小结（只发汇总和一起做的事），花销分析页和小报页共用；每个小家有次数上限。 */
export function writeSummary(month: string): Promise<InsightSummary> {
  return callApi<InsightSummary>('insight.write', { month });
}
