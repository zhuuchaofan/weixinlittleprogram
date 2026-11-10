import type { InsightSummary, YearReview } from '../models';
import { callApi } from './cloud';

export function getYear(year: string): Promise<YearReview> {
  return callApi<YearReview>('year.get', { year });
}

/** 让千问写这一年的寄语（只发汇总），只给会员。 */
export function writeYearNote(year: string): Promise<InsightSummary> {
  return callApi<InsightSummary>('year.write', { year });
}
