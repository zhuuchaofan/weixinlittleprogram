import { uiCopy } from '../config/ui-copy';
import type { Dashboard, RsvpInput, RsvpRecord, RsvpService } from '../models';
import { validateRsvp } from '../utils/validate';
export const MOCK_STORAGE_KEY = 'two-cats:rsvp:mock:v1';
export interface Storage {
  read(): unknown;
  write(value: RsvpRecord): void;
  remove(): void;
}
export function createMockService(
  storage: Storage,
  isAdmin: () => boolean,
): RsvpService {
  const read = (): RsvpRecord | null => {
    const value = storage.read();
    if (value === '' || value == null) return null;
    const record = value as RsvpRecord;
    if (
      validateRsvp(record) ||
      typeof record.id !== 'string' ||
      typeof record.updatedAt !== 'string'
    )
      throw new Error(uiCopy.mockRsvp.text01);
    return record;
  };
  return {
    async getMine() {
      return read();
    },
    async save(input: RsvpInput) {
      const error = validateRsvp(input);
      if (error) throw new Error(error);
      const old = read();
      const record = {
        ...input,
        guestName: input.guestName.trim(),
        note: input.note.trim(),
        id: old?.id || 'local-demo-guest',
        updatedAt: new Date().toISOString(),
      };
      storage.write(record);
      return record;
    },
    async removeMine() {
      storage.remove();
    },
    async dashboard(): Promise<Dashboard> {
      if (!isAdmin()) throw new Error(uiCopy.mockRsvp.text02);
      const mine = read();
      const records = mine ? [mine] : [];
      return {
        records,
        summary: {
          responses: records.length,
          attending: mine?.attending ? 1 : 0,
          guests: mine?.attending ? mine.partySize : 0,
          declined: mine && !mine.attending ? 1 : 0,
        },
        nextCursor: '',
      };
    },
  };
}
