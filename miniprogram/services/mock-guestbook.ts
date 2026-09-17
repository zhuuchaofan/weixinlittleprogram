import { uiCopy } from '../config/ui-copy';
import type {
  GuestMessageDashboard,
  GuestMessageInput,
  GuestMessageRecord,
  GuestMessageService,
} from '../models';
import { validateGuestMessage } from '../utils/validate';

export const MOCK_GUESTBOOK_STORAGE_KEY = 'two-cats:guestbook:mock:v1';
export interface GuestbookStorage {
  read(): unknown;
  write(value: GuestMessageRecord): void;
  remove(): void;
}

export function createMockGuestbookService(
  storage: GuestbookStorage,
  isAdmin: () => boolean,
): GuestMessageService {
  const read = (): GuestMessageRecord | null => {
    const value = storage.read();
    if (value === '' || value == null) return null;
    const record = value as GuestMessageRecord;
    if (
      typeof record.id !== 'string' ||
      typeof record.updatedAt !== 'string' ||
      validateGuestMessage(record)
    )
      throw new Error(uiCopy.mockGuestbook.text01);
    return record;
  };
  return {
    async getMine() {
      return read();
    },
    async save(input: GuestMessageInput) {
      const error = validateGuestMessage(input);
      if (error) throw new Error(error);
      const old = read();
      const record: GuestMessageRecord = {
        signature: input.signature.trim(),
        message: input.message.trim(),
        consent: true,
        id: old?.id || 'local-demo-message',
        updatedAt: new Date().toISOString(),
      };
      storage.write(record);
      return record;
    },
    async removeMine() {
      storage.remove();
    },
    async dashboard(): Promise<GuestMessageDashboard> {
      if (!isAdmin()) throw new Error(uiCopy.mockGuestbook.text02);
      const mine = read();
      return {
        records: mine ? [mine] : [],
        summary: { messages: mine ? 1 : 0 },
        nextCursor: '',
      };
    },
  };
}
