import type { Archive } from '../models';
import { callApi } from './cloud';

export function getArchive(): Promise<Archive> {
  return callApi<Archive>('archive.get');
}
