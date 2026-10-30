import type { MonthRecap, RecapNote } from '../models';
import { callApi } from './cloud';

export function getRecap(month: string): Promise<MonthRecap> {
  return callApi<MonthRecap>('recap.get', { month });
}

export function writeRecapNote(month: string): Promise<RecapNote> {
  return callApi<RecapNote>('recap.write', { month });
}
