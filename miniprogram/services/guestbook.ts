import { localConfig } from '../config/local';
import { uiCopy } from '../config/ui-copy';
import type { GuestMessageService } from '../models';
import { callCloud } from './cloud';
import {
  createMockGuestbookService,
  MOCK_GUESTBOOK_STORAGE_KEY,
} from './mock-guestbook';

function isMockMode(mode: 'mock' | 'cloud'): boolean {
  return mode === 'mock';
}
export const isGuestbookMock = isMockMode(localConfig.mode);
const mock = createMockGuestbookService(
  {
    read: () => wx.getStorageSync(MOCK_GUESTBOOK_STORAGE_KEY),
    write: (value) => {
      try {
        wx.setStorageSync(MOCK_GUESTBOOK_STORAGE_KEY, value);
      } catch {
        throw new Error(uiCopy.guestbook.storageError);
      }
    },
    remove: () => wx.removeStorageSync(MOCK_GUESTBOOK_STORAGE_KEY),
  },
  () => isGuestbookMock && localConfig.mockAdminEnabled,
);
const cloud: GuestMessageService = {
  getMine: () => callCloud('guestbookGetMine'),
  save: (input) => callCloud('guestbookSave', input),
  removeMine: () => callCloud('guestbookRemoveMine'),
  dashboard: (cursor = '') => callCloud('guestbookDashboard', { cursor }),
};
const provider = isGuestbookMock ? mock : cloud;
let revision = 0;
export const getGuestbookRevision = () => revision;
export const guestbookService: GuestMessageService = {
  getMine: () => provider.getMine(),
  save: async (input) => {
    const result = await provider.save(input);
    revision++;
    return result;
  },
  removeMine: async () => {
    await provider.removeMine();
    revision++;
  },
  dashboard: (cursor) => provider.dashboard(cursor),
};
