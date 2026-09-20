import type { EventProgram } from '../models';
import { defaultEventProgram } from '../config/content';
import { localConfig } from '../config/local';
import { callCloud } from './cloud';

function cloneDefault(): EventProgram {
  return JSON.parse(JSON.stringify(defaultEventProgram)) as EventProgram;
}

function normalizeProgram(value: unknown): EventProgram {
  const program = value as Partial<EventProgram> | null;
  if (!program || !Array.isArray(program.items) || !program.photoBooth)
    return cloneDefault();
  return program as EventProgram;
}

export const eventProgramService = {
  defaultProgram: cloneDefault,
  async published(): Promise<EventProgram> {
    if (String(localConfig.mode) === 'mock')
      return normalizeProgram(wx.getStorageSync('event-program:published'));
    return normalizeProgram(
      await callCloud<EventProgram | null>('getEventProgram'),
    );
  },
  async draft(): Promise<EventProgram> {
    if (String(localConfig.mode) === 'mock')
      return normalizeProgram(wx.getStorageSync('event-program:draft'));
    return normalizeProgram(
      await callCloud<EventProgram | null>('getEventProgramDraft'),
    );
  },
  async save(program: EventProgram): Promise<void> {
    if (String(localConfig.mode) === 'mock') {
      wx.setStorageSync('event-program:draft', program);
      return;
    }
    await callCloud('saveEventProgramDraft', { program });
  },
  async publish(program: EventProgram): Promise<void> {
    if (String(localConfig.mode) === 'mock') {
      wx.setStorageSync('event-program:draft', program);
      wx.setStorageSync('event-program:published', program);
      return;
    }
    await callCloud('publishEventProgram', { program });
  },
};
