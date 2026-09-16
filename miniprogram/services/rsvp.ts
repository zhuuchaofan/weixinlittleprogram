import { uiCopy } from '../config/ui-copy';
import { localConfig } from '../config/local';
import type { RsvpService } from '../models';
import { callCloud } from './cloud';
import { createMockService, MOCK_STORAGE_KEY } from './mock-rsvp';

function isMockMode(mode: 'mock' | 'cloud'): boolean {
  return mode === 'mock';
}

const mock = createMockService(
  {
    read: () => wx.getStorageSync(MOCK_STORAGE_KEY),
    write: (value) => {
      try {
        wx.setStorageSync(MOCK_STORAGE_KEY, value);
      } catch {
        throw new Error(uiCopy.rsvpService.text01);
      }
    },
    remove: () => wx.removeStorageSync(MOCK_STORAGE_KEY),
  },
  () => isMockMode(localConfig.mode) && localConfig.mockAdminEnabled,
);
const cloud: RsvpService = {
  getMine: () => callCloud('getMine'),
  save: (input) => callCloud('save', input),
  removeMine: () => callCloud('removeMine'),
  dashboard: (cursor = '') => callCloud('dashboard', { cursor }),
};
export const isMock = isMockMode(localConfig.mode);
const provider = isMock ? mock : cloud;
let revision = 0;
export const getRsvpRevision = () => revision;
export const rsvpService: RsvpService = {
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
